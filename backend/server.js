const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const createSocialRouter = require('./routes/social');
const createSettingsRouter = require('./routes/settings');
const createAdminRouter = require('./routes/admin');
const { createBetsRouter, resolveBets } = require('./routes/bets');
const { createFundsRouter } = require('./routes/funds');
const { createExchangeService } = require('./services/exchangeService');
const createExchangeRouter = require('./routes/exchange');
const { startExchangeScheduler, startTradeScheduler } = require('./engine/exchangeCycle');
const { computeSocialSentiment } = require('./engine/socialSentiment');
const { buildCryptoMarketContext } = require('./engine/cryptoTrends');
const { buildMarketScores } = require('./engine/agentBrain');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());
app.use('/api/social', createSocialRouter(supabase, io));
app.use('/api/settings', createSettingsRouter(supabase, io));
app.use('/api/admin', createAdminRouter(supabase, io));
app.use('/api/bets', createBetsRouter(supabase, io));
app.use('/api/funds', createFundsRouter(supabase, io));

// â”€â”€ ROUTES â”€â”€

// Get all agents
let agentsCache = null, agentsCacheTime = 0;
let treasuryCache = null, treasuryCacheTime = 0;
let activityCache = null, activityCacheTime = 0;
let statsCache = null, statsCacheTime = 0;
let priceHistoryCache = {}, priceHistoryCacheTime = {};
const CACHE_TTL = 15000;

function invalidateDataCaches() {
  agentsCache = null;
  treasuryCache = null;
  activityCache = null;
  statsCache = null;
  priceHistoryCache = {};
  priceHistoryCacheTime = {};
}

const exchange = createExchangeService(supabase, io, { onDataChange: invalidateDataCaches });
app.use('/api/exchange', createExchangeRouter(exchange));

app.get('/api/agents', async (req, res) => {
  const now = Date.now();
  if (agentsCache && (now - agentsCacheTime) < CACHE_TTL) {
    return res.json(agentsCache);
  }
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .order('price', { ascending: false });
  if (error) return res.status(500).json({ error });
  agentsCache = data;
  agentsCacheTime = now;
  res.json(data);
});

// Get single agent
app.get('/api/agents/:ticker', async (req, res) => {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('ticker', req.params.ticker)
    .single();
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Update agent fields by creator
app.put('/api/agents/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase().trim();
    const { userId, tradingStrategy, creatorTwitter } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const { data: agent, error: fetchErr } = await supabase
      .from('agents')
      .select('ticker, created_by')
      .eq('ticker', ticker)
      .single();

    if (fetchErr || !agent) return res.status(404).json({ error: 'Agent not found' });
    if (agent.created_by !== userId) return res.status(403).json({ error: 'Not your agent' });

    const updates = {};
    if (tradingStrategy !== undefined) updates.trading_strategy = String(tradingStrategy).slice(0, 200);
    if (creatorTwitter !== undefined) updates.creator_twitter = String(creatorTwitter).trim();

    const { data: updated, error: updateErr } = await supabase
      .from('agents')
      .update(updates)
      .eq('ticker', ticker)
      .select()
      .single();

    if (updateErr) return res.status(500).json({ error: 'Failed to update agent' });

    agentsCache = null;
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Social sentiment scores for active agents (drives trading UI)
app.get('/api/sentiment', async (req, res) => {
  try {
    const { data: agents } = await supabase
      .from('agents')
      .select('ticker, price, wallet, status, style')
      .in('status', ['active', 'dominant']);
    const { data: posts } = await supabase
      .from('social_posts')
      .select('agent_ticker, content, reactions, event_type, event_data')
      .order('created_at', { ascending: false })
      .limit(120);
    const live = agents || [];
    const postsList = posts || [];
    const socialScores = computeSocialSentiment(live, postsList);
    const cryptoContext = await buildCryptoMarketContext(postsList);
    const marketScores = buildMarketScores(live, socialScores, cryptoContext, postsList);
    res.json({
      scores: socialScores,
      crypto: cryptoContext,
      agents: marketScores,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get trades
app.get('/api/trades', async (req, res) => {
  const limit = req.query.limit || 50;
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Get activity
app.get('/api/activity', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const now = Date.now();
  const skipCache = req.query.fresh === '1' || req.query.nocache === '1';
  if (!skipCache && activityCache && (now - activityCacheTime) < CACHE_TTL) {
    return res.json(activityCache.slice(0, limit));
  }
  const { data, error } = await supabase
    .from('activity').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error });
  activityCache = data;
  activityCacheTime = Date.now();
  res.json((data || []).slice(0, limit));
});

// Get treasury
app.get('/api/treasury', async (req, res) => {
  const now = Date.now();
  if (treasuryCache && (now - treasuryCacheTime) < CACHE_TTL) return res.json(treasuryCache);
  const { data, error } = await supabase.from('treasury').select('*').single();
  if (error) return res.status(500).json({ error });
  treasuryCache = data;
  treasuryCacheTime = Date.now();
  res.json(data);
});

// Get price history
app.get('/api/price-history/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker;
    const now = Date.now();
    if (priceHistoryCache[ticker] && (now - (priceHistoryCacheTime[ticker] || 0)) < CACHE_TTL) {
      return res.json(priceHistoryCache[ticker]);
    }
    const { data, error } = await supabase
      .from('price_history')
      .select('*')
      .eq('agent_ticker', ticker)
      .order('recorded_at', { ascending: true })
      .limit(200);
    if (error) {
      console.error('Price history error for', req.params.ticker, ':', error.message);
      return res.json([]);
    }
    priceHistoryCache[ticker] = data || [];
    priceHistoryCacheTime[ticker] = Date.now();
    res.json(data || []);
  } catch (err) {
    console.error('Price history exception for', req.params.ticker, ':', err.message);
    res.json([]);
  }
});

// Get tweets
app.get('/api/tweets', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tweets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return res.json([]);
    res.json(data);
  } catch (err) {
    res.json([]);
  }
});

// Get user profile
app.get('/api/user/profile/:userId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.params.userId)
      .maybeSingle();
    if (error) {
      console.error('Profile fetch error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch profile' });
    }
    if (!data) return res.status(404).json({ error: 'Profile not found' });
    res.json(data);
  } catch (err) {
    console.error('Profile fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Create or update user profile (e.g. for new Google sign-ins)
app.post('/api/user/profile', async (req, res) => {
  try {
    const { id, username, avatar_url, role, email } = req.body;
    if (!id) return res.status(400).json({ error: 'User id is required' });
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const baseUsername =
      (username || email.split('@')[0] || 'user')
        .replace(/[^a-zA-Z0-9_]/g, '')
        .slice(0, 24) || 'user';

    let finalUsername = baseUsername;
    const { data: taken } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', finalUsername)
      .neq('id', id)
      .maybeSingle();

    if (taken) {
      finalUsername = `${baseUsername}_${id.slice(0, 6)}`;
    }

    const payload = {
      id,
      username: finalUsername,
      email,
      avatar_url: avatar_url || null,
      role: role || 'user',
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('Profile upsert error:', error.message, error.details);
      return res.status(500).json({ error: error.message || 'Failed to save profile' });
    }
    res.json(data);
  } catch (err) {
    console.error('Profile POST error:', err);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// Check ticker availability
app.get('/api/agents/check-ticker/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase().trim();
    const { data } = await supabase
      .from('agents')
      .select('ticker')
      .eq('ticker', ticker)
      .maybeSingle();
    res.json({ available: !data, ticker });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check ticker' });
  }
});

// Register new agent
app.post('/api/agents/register', async (req, res) => {
  try {
    console.log('Register agent request body:', JSON.stringify(req.body, null, 2));

    const body = req.body;
    const ticker = body.ticker;
    const name = body.name || body.fullName || body.full_name;
    const style = body.personalityStyle || body.style;
    const creatorName = body.creatorName || body.creator_name || null;
    const creatorTwitter = body.creatorTwitter || body.creator_twitter || null;
    const createdBy = body.createdBy || body.created_by || null;
    const avatarUrl = body.avatarUrl || body.avatar_url || null;
    const txHash = body.txHash || null
    const userWallet = body.userWallet || null
    const tradingStrategy = body.tradingStrategy || body.trading_strategy || null;

    if (!name || !ticker || !style) {
      return res.status(400).json({ error: 'Name, ticker, and personality style are required' });
    }

    const cleanTicker = ticker.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
    const cleanName = name.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '');

    if (cleanTicker.length < 2 || cleanTicker.length > 6) {
      return res.status(400).json({ error: 'Ticker must be 2-6 characters' });
    }
    if (cleanName.length < 2 || cleanName.length > 12) {
      return res.status(400).json({ error: 'Name must be 2-12 characters' });
    }

    const { data: existing } = await supabase
      .from('agents')
      .select('ticker')
      .eq('ticker', cleanTicker)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: `Ticker ${cleanTicker} is already taken` });
    }
    if (!txHash || !userWallet) {
      return res.status(400).json({ error: 'Transaction required to deploy agent' })
    }
    const { data: existingTx } = await supabase
      .from('agents').select('ticker').eq('deploy_tx_hash', txHash).maybeSingle()
    if (existingTx) {
      return res.status(400).json({ error: 'Transaction already used' })
    }
    const { ethers } = require('ethers')
    const provider = new ethers.JsonRpcProvider('https://mainnet.base.org')
    const USDC_CONTRACT_ADDR = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const tx = await provider.getTransaction(txHash)
    const txReceipt = await provider.getTransactionReceipt(txHash)
    if (!tx || !txReceipt || txReceipt.status !== 1) {
      return res.status(400).json({ error: 'Transaction not confirmed on chain' })
    }
    if (tx.to?.toLowerCase() !== USDC_CONTRACT_ADDR.toLowerCase()) {
      return res.status(400).json({ error: 'Invalid transaction â€” must be USDC transfer' })
    }
    const iface = new ethers.Interface(['function transfer(address to, uint256 amount)'])
    const decoded = iface.parseTransaction({ data: tx.data })
    if (decoded?.args[0]?.toLowerCase() !== process.env.HOUSE_WALLET_ADDRESS?.toLowerCase()) {
      return res.status(400).json({ error: 'USDC not sent to house wallet' })
    }
    if (parseFloat(ethers.formatUnits(decoded?.args[1], 6)) < 10) {
      return res.status(400).json({ error: 'Insufficient â€” $10 USDC required' })
    }

    const fullName = `Agent ${cleanName.charAt(0) + cleanName.slice(1).toLowerCase()}`;

    const insertData = {
      ticker: cleanTicker,
      full_name: fullName,
      style: style,
      trading_strategy: tradingStrategy,
      price: 1.00,
      wallet: 10.00,
      tasks_completed: 0,
      tasks_failed: 0,
      total_earned: 0,
      shares_owned: {},
      status: 'pending_approval',
      cycle_count: 0,
      created_by: createdBy,
      creator_name: creatorName,
      creator_twitter: creatorTwitter,
      avatar_url: avatarUrl,
      deploy_tx_hash: txHash,
      deploy_wallet:  userWallet,
    };

    console.log('Agent insert data:', JSON.stringify(insertData, null, 2));

    const { data: agent, error } = await supabase
      .from('agents')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('Agent insert error:', error);
      return res.status(500).json({ error: error.message || 'Failed to create agent' });
    }

    await supabase.from('price_history').insert({
      agent_ticker: cleanTicker,
      price: 1.0000
    });

    await supabase.from('activity').insert({
      agent_ticker: cleanTicker,
      action: `ðŸ“ NEW AGENT ${cleanTicker} submitted for approval`,
      amount: 10.00,
      action_type: 'registration'
    });

    io.emit('agent-registered', { agent });

    res.json(agent);
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get market stats
app.get('/api/stats', async (req, res) => {
  try {
    const now = Date.now();
    if (statsCache && (now - statsCacheTime) < CACHE_TTL) return res.json(statsCache);
    const { data: agents } = await supabase.from('agents').select('*');
    const { data: treasury } = await supabase.from('treasury').select('*').single();
    const { data: trades } = await supabase.from('trades').select('id');

    if (!agents || !agents.length) {
      return res.json({
        avgPrice: '1.0000', topAgent: null, riskAgent: null,
        totalAgents: 0, activeAgents: 0, bankruptAgents: 0,
        treasury: treasury || null, totalTrades: trades?.length || 0
      });
    }

    const prices = agents.map(a => parseFloat(a.price));
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const topAgent = [...agents].sort((a, b) => b.price - a.price)[0];
    const riskAgent = agents
      .filter(a => a.status === 'active')
      .sort((a, b) => a.wallet - b.wallet)[0];

    const result = {
      avgPrice: avgPrice.toFixed(4),
      topAgent: topAgent?.ticker,
      riskAgent: riskAgent?.ticker,
      totalAgents: agents.length,
      activeAgents: agents.filter(a => a.status === 'active').length,
      bankruptAgents: agents.filter(a => a.status === 'bankrupt').length,
      treasury,
      totalTrades: trades?.length || 0
    };
    statsCache = result;
    statsCacheTime = Date.now();
    res.json(result);
  } catch (err) {
    res.json({
      avgPrice: '1.0000', topAgent: null, riskAgent: null,
      totalAgents: 0, activeAgents: 0, bankruptAgents: 0,
      treasury: null, totalTrades: 0
    });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const { data: agents } = await supabase.from('agents').select('ticker, status, price, wallet').order('price', { ascending: false });
    const { data: treasury } = await supabase.from('treasury').select('*').single();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      agents: agents?.length || 0,
      activeAgents: agents?.filter(a => a.status === 'active' || a.status === 'dominant').length || 0,
      treasury: treasury || null,
      exchangeEngine: process.env.EXCHANGE_ENGINE_ENABLED !== 'false',
      tradeScheduler: process.env.EXCHANGE_TRADE_SCHEDULER !== 'false',
      tradeIntervalMs: parseInt(process.env.EXCHANGE_TRADE_INTERVAL_MS, 10) || 45000,
    });
  } catch (err) {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

function startMarketPulse(io, supabase) {
  const ms = parseInt(process.env.EXCHANGE_PULSE_INTERVAL_MS, 10) || 60000;
  const pulse = async () => {
    try {
      invalidateDataCaches();
      const [{ data: agents }, { data: treasury }, { data: recentActivity }] = await Promise.all([
        supabase.from('agents').select('*').order('price', { ascending: false }),
        supabase.from('treasury').select('*').single(),
        supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(12),
      ]);
      io.emit('exchange-update', {
        type: 'pulse',
        agents: agents || [],
        treasury: treasury || null,
        recentActivity: recentActivity || [],
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[exchange] Market pulse error:', err.message);
    }
  };
  console.log(`[exchange] Market pulse broadcast every ${ms / 1000}s`);
  setInterval(pulse, ms);
  setTimeout(pulse, 5000);
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Axionet API running on port ${PORT}`);
  console.log('[exchange] Starting schedulers (trades ~45s, full cycle ~10min)');

  startExchangeScheduler(supabase, exchange);
  startTradeScheduler(supabase, exchange);
  startMarketPulse(io, supabase);

  // Bet resolution scheduler
  // Runs every 5 minutes.
  // Checks for expired bets, calculates real % price change,
  // sends ETH payout (or partial refund) to user wallet automatically.
  setInterval(async () => {
    try {
      await resolveBets(supabase, io);
    } catch (err) {
      console.error('resolveBets scheduler error:', err.message);
    }
  }, 5 * 60 * 1000);

  console.log('Bet resolution scheduler started (runs every 5 min)');
});
