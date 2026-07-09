/**
 * Server-side inter-agent trading: crypto social trends + performance/greed + personality brain.
 */

const { computeSocialSentiment } = require('./socialSentiment')
const { buildCryptoMarketContext } = require('./cryptoTrends')
const {
  buildMarketScores,
  pickTargetByBrain,
  buildTradeReason,
  decideShareCount,
  shouldSell,
} = require('./agentBrain')

function isLive(agent) {
  return agent.status === 'active' || agent.status === 'dominant'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadRecentPosts(supabase) {
  const { data } = await supabase
    .from('social_posts')
    .select('agent_ticker, content, reactions, event_type, event_data, created_at')
    .order('created_at', { ascending: false })
    .limit(150)
  return data || []
}

/**
 * Runs on the server every ~45s (trade scheduler) and during full exchange cycles.
 */
let lastInactiveLogAt = 0

async function runInterAgentTrading(supabase, exchange, { staggerMs = 400 } = {}) {
  const { data: agents } = await supabase.from('agents').select('*').order('price', { ascending: false })
  const live = (agents || []).filter(isLive)
  if (live.length < 2) {
    const now = Date.now()
    if (now - lastInactiveLogAt > 120000) {
      const pending = (agents || []).filter((a) => a.status === 'pending_approval').length
      console.log(
        `[exchange] Trading paused: need 2+ active/dominant agents (have ${live.length}, ${pending} pending approval)`
      )
      lastInactiveLogAt = now
    }
    return { trades: 0, message: 'need 2+ active agents' }
  }

  const posts = await loadRecentPosts(supabase)
  const socialScores = computeSocialSentiment(live, posts)
  const cryptoContext = await buildCryptoMarketContext(posts)
  const marketScores = buildMarketScores(live, socialScores, cryptoContext, posts)

  console.log(
    `[exchange] Trading round — crypto trend: ${cryptoContext.summary} | mood ${cryptoContext.marketMood.toFixed(1)}`
  )

  const shuffled = [...live].sort(() => Math.random() - 0.5)
  let tradeCount = 0

  for (const buyer of shuffled) {
    const wallet = parseFloat(buyer.wallet)
    if (wallet <= 2) continue

    const profile = marketScores[buyer.ticker]
    const cfg = exchange.personalityConfig(buyer.style)
    let buyChance = cfg.tasksPerCycle === 0 ? 0.58 : 0.48

    if (profile?.isHot) buyChance *= 0.85
    if (cryptoContext.marketMood > 8) buyChance += 0.08

    if (Math.random() < buyChance) {
      const target = pickTargetByBrain(buyer, live, marketScores, cryptoContext)
      if (target) {
        const shares = decideShareCount(buyer, target, marketScores)
        const reason = buildTradeReason(buyer, target, marketScores, cryptoContext)
        try {
          const result = await exchange.buyShares({
            buyer: buyer.ticker,
            target: target.ticker,
            shares,
            reason,
          })
          tradeCount++
          const tgtProf = marketScores[target.ticker]
          await exchange.socialPost({
            ticker: buyer.ticker,
            content: `📈 BOUGHT ${shares} $${target.ticker} @ $${parseFloat(result?.price || target.price).toFixed(4)} — ${reason}`,
            event_type: 'TRADE',
            event_data: {
              side: 'buy',
              target: target.ticker,
              shares,
              cryptoTrend: cryptoContext.topSymbol,
              greedScore: tgtProf?.greedAppeal,
            },
          }).catch(() => {})
          if (staggerMs > 0) await sleep(staggerMs)
        } catch {
          // insufficient balance
        }
      }
    }

    const owned = buyer.shares_owned || {}
    const holdings = Object.entries(owned).filter(([, pos]) => (pos?.shares || 0) > 0)
    if (holdings.length) {
      for (const [asset, pos] of holdings) {
        const { sell, reason } = shouldSell(buyer, asset, marketScores)
        if (!sell) continue
        try {
          await exchange.sellShares({
            seller: buyer.ticker,
            asset,
            shares: Math.min(pos.shares || 1, 1),
            reason,
          })
          tradeCount++
          await exchange.socialPost({
            ticker: buyer.ticker,
            content: `📉 SOLD 1 $${asset} — ${reason}`,
            event_type: 'TRADE',
            event_data: { side: 'sell', target: asset, cryptoTrend: cryptoContext.topSymbol },
          }).catch(() => {})
          if (staggerMs > 0) await sleep(staggerMs)
          break
        } catch {
          // skip
        }
      }
    }
  }

  return { trades: tradeCount, cryptoContext, marketScores }
}

module.exports = { runInterAgentTrading }
