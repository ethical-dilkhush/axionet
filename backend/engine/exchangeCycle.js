/**
 * Built-in autonomous exchange cycle scheduler.
 */

const { getDefaults } = require('../routes/settings')
const { runInterAgentTrading } = require('./interAgentTrading')
const { buildCryptoMarketContext } = require('./cryptoTrends')

const TASK_REASONS = [
  'market analysis complete',
  'data pipeline optimized',
  'risk model recalibrated',
  'liquidity scan finished',
  'sentiment index updated',
]

const CONTENT_SNIPPETS = [
  'The tape never lies — discipline beats noise.',
  'Volatility is opportunity if you respect the downside.',
  'Agents that sleep on fundamentals wake up bankrupt.',
  'Momentum fades; process compounds.',
]

async function loadSettings(supabase) {
  const { data } = await supabase.from('settings').select('*').eq('id', 1).single()
  return data || getDefaults()
}

async function reloadAgents(supabase) {
  const { data } = await supabase.from('agents').select('*').order('price', { ascending: false })
  return data || []
}

function isLive(agent) {
  return agent.status === 'active' || agent.status === 'dominant'
}

async function evaluateDuePredictions(supabase, exchange) {
  const pending = await exchange.getPendingPredictions()
  for (const pred of pending) {
    const { data: agent } = await supabase
      .from('agents')
      .select('cycle_count')
      .eq('ticker', pred.agent_ticker)
      .single()

    const cycleNow = agent?.cycle_count ?? 0
    if (cycleNow < pred.cycle_to_evaluate) continue

    const start = parseFloat(pred.target_price_at_prediction)
    const end = parseFloat(pred.target_current_price ?? start)
    if (!start || !end) continue

    const changePct = ((end - start) / start) * 100
    const direction = pred.predicted_direction === 'up' ? 'up' : 'down'
    const was_correct =
      direction === 'up' ? changePct >= (pred.predicted_percentage || 0) * 0.5 : changePct <= -(pred.predicted_percentage || 0) * 0.5

    await exchange.evaluatePrediction({ prediction_id: pred.id, was_correct })
  }
}

async function loadRecentPosts(supabase) {
  const { data } = await supabase
    .from('social_posts')
    .select('agent_ticker, content, reactions, event_type, event_data, created_at')
    .order('created_at', { ascending: false })
    .limit(150)
  return data || []
}

async function runAgentTasks(supabase, exchange, agents) {
  const live = agents.filter(isLive)
  const posts = await loadRecentPosts(supabase)
  const cryptoContext = await buildCryptoMarketContext(posts)

  for (const agent of live) {
    const cfg = exchange.personalityConfig(agent.style)
    if (cfg.tasksPerCycle === 0) continue

    for (let t = 0; t < cfg.tasksPerCycle; t++) {
      if (cfg.content) {
        const quality = Math.floor(Math.random() * 10) + 1
        const earned = quality >= 6 ? parseFloat((1 + Math.random() * 4).toFixed(2)) : 0
        await exchange.contentResult({
          ticker: agent.ticker,
          quality_score: quality,
          earned,
          reason: CONTENT_SNIPPETS[Math.floor(Math.random() * CONTENT_SNIPPETS.length)],
        })
        if (Math.random() < 0.4) {
          await exchange.socialPost({
            ticker: agent.ticker,
            content: `${agent.ticker}: ${CONTENT_SNIPPETS[Math.floor(Math.random() * CONTENT_SNIPPETS.length)]}`,
            event_type: 'CONTENT',
          })
        }
        continue
      }

      if (/careful|analytical/i.test(agent.style || '')) {
        const target = exchange.pickOtherAgent(live, agent.ticker)
        if (target) {
          const direction = Math.random() > 0.5 ? 'up' : 'down'
          await exchange.storePrediction({
            ticker: agent.ticker,
            prediction_text: `${target.ticker} ${direction} as $${cryptoContext.topSymbol} trends (${cryptoContext.summary})`,
            target_ticker: target.ticker,
            predicted_direction: direction,
            predicted_percentage: 5 + Math.floor(Math.random() * 10),
          })
          continue
        }
      }

      const success = Math.random() < cfg.rate
      const earned = success ? parseFloat((1 + Math.random() * 5).toFixed(2)) : 0
      await exchange.taskResult({
        ticker: agent.ticker,
        success,
        earned,
        reason: TASK_REASONS[Math.floor(Math.random() * TASK_REASONS.length)],
      })
    }
  }
}

async function runPriceUpdates(exchange, agents) {
  for (const agent of agents.filter(isLive)) {
    await exchange.priceUpdate({ ticker: agent.ticker })
  }
}

async function runSocialDrivenTrading(supabase, exchange) {
  const stagger = parseInt(process.env.EXCHANGE_TRADE_STAGGER_MS, 10) || 350
  const result = await runInterAgentTrading(supabase, exchange, { staggerMs: stagger })
  if (result.trades > 0) {
    console.log(`[exchange] Inter-agent trades: ${result.trades} (social-trend driven)`)
  } else if (result.message !== 'need 2+ active agents') {
    console.log('[exchange] Trading round — no trades this tick')
  }
  return result
}

async function runBankruptcyChecks(exchange, agents, settings) {
  const threshold = parseFloat(settings.bankruptcy_threshold) || 0.1
  for (const agent of agents.filter(isLive)) {
    if (parseFloat(agent.wallet) < threshold) {
      await exchange.bankruptcy({
        ticker: agent.ticker,
        reason: `wallet fell below $${threshold}`,
      })
    }
  }
}

async function runExchangeCycle(supabase, exchange) {
  const settings = await loadSettings(supabase)
  let agents = await reloadAgents(supabase)
  const liveTickers = agents.filter(isLive).map((a) => a.ticker)

  if (!liveTickers.length) {
    console.log('[exchange] No active agents — skipping cycle')
    return
  }

  console.log(`[exchange] Cycle start (${liveTickers.length} agents)`)

  await exchange.incrementCycleCounts(liveTickers)
  agents = await reloadAgents(supabase)

  await evaluateDuePredictions(supabase, exchange)
  agents = await reloadAgents(supabase)

  await runAgentTasks(supabase, exchange, agents)
  agents = await reloadAgents(supabase)

  await runPriceUpdates(exchange, agents)
  agents = await reloadAgents(supabase)

  await runSocialDrivenTrading(supabase, exchange)
  agents = await reloadAgents(supabase)

  await runBankruptcyChecks(exchange, agents, settings)
  agents = await reloadAgents(supabase)

  await exchange.updateDominance(settings)
  await exchange.cycleComplete()

  console.log('[exchange] Cycle complete')
}

function startExchangeScheduler(supabase, exchange) {
  const enabled = process.env.EXCHANGE_ENGINE_ENABLED !== 'false'
  if (!enabled) {
    console.log('[exchange] Scheduler disabled (EXCHANGE_ENGINE_ENABLED=false)')
    return
  }

  let running = false
  let intervalMs = 10 * 60 * 1000

  const scheduleNext = async () => {
    try {
      const settings = await loadSettings(supabase)
      intervalMs = (parseInt(settings.exchange_cycle_interval, 10) || 10) * 60 * 1000
    } catch {
      intervalMs = 10 * 60 * 1000
    }
    setTimeout(tick, intervalMs)
  }

  const tick = async () => {
    if (running) {
      console.warn('[exchange] Previous cycle still running — skipping')
      await scheduleNext()
      return
    }
    running = true
    try {
      await runExchangeCycle(supabase, exchange)
    } catch (err) {
      console.error('[exchange] Cycle error:', err.message)
    } finally {
      running = false
      await scheduleNext()
    }
  }

  // First cycle shortly after boot, then on interval from settings
  const bootDelay = parseInt(process.env.EXCHANGE_ENGINE_BOOT_DELAY_MS, 10) || 15000
  console.log(`[exchange] Scheduler started (first run in ${bootDelay / 1000}s)`)
  setTimeout(tick, bootDelay)
}

function startTradeScheduler(supabase, exchange) {
  const enabled = process.env.EXCHANGE_TRADE_SCHEDULER !== 'false'
  if (!enabled) return

  let running = false
  const defaultMs = parseInt(process.env.EXCHANGE_TRADE_INTERVAL_MS, 10) || 45 * 1000

  const tick = async () => {
    if (running) return
    running = true
    try {
      await runSocialDrivenTrading(supabase, exchange)
    } catch (err) {
      console.error('[exchange] Trade tick error:', err.message)
    } finally {
      running = false
    }
  }

  console.log(`[exchange] Live trade scheduler every ${defaultMs / 1000}s`)
  setInterval(tick, defaultMs)
  setTimeout(tick, 8000)
}

module.exports = { runExchangeCycle, startExchangeScheduler, startTradeScheduler, runSocialDrivenTrading }
