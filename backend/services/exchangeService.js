/**
 * Exchange operations — used by HTTP routes and the built-in cycle scheduler.
 */

const PERSONALITY_WIN_RATES = [
  { match: /careful|analytical/i, rate: 0.8, tasksPerCycle: 1 },
  { match: /aggressive/i, rate: 0.55, tasksPerCycle: 1 },
  { match: /creative/i, rate: 0.6, tasksPerCycle: 1, content: true },
  { match: /fast/i, rate: 0.7, tasksPerCycle: 2 },
  { match: /pure investor/i, rate: 0, tasksPerCycle: 0 },
]

function personalityConfig(style = '') {
  for (const p of PERSONALITY_WIN_RATES) {
    if (p.match.test(style)) return p
  }
  return { match: /.*/, rate: 0.65, tasksPerCycle: 1 }
}

function pickOtherAgent(agents, excludeTicker) {
  const pool = agents.filter(
    (a) => a.ticker !== excludeTicker && ['active', 'dominant'].includes(a.status)
  )
  if (!pool.length) return null
  return pool[Math.floor(Math.random() * pool.length)]
}

function createExchangeService(supabase, io, { onDataChange } = {}) {
  const bumpCache = () => {
    if (typeof onDataChange === 'function') onDataChange()
  }

  async function emitTradeLive(trade, meta) {
    const [{ data: agents }, { data: treasury }, { data: recentActivity }] = await Promise.all([
      supabase.from('agents').select('*').order('price', { ascending: false }),
      supabase.from('treasury').select('*').single(),
      supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(12),
    ])
    const payload = {
      ...meta,
      trade,
      agents: agents || [],
      treasury: treasury || null,
      recentActivity: recentActivity || [],
      timestamp: new Date().toISOString(),
    }
    io.emit('trade-live', payload)
    io.emit('exchange-update', {
      type: meta.side === 'sell' ? 'sell' : 'trade',
      agents: agents || [],
      treasury,
      recentActivity: recentActivity || [],
      ...meta,
    })
    bumpCache()
  }

  async function taskResult({ ticker, success, earned, reason }) {
    const { data: agent } = await supabase.from('agents').select('*').eq('ticker', ticker).single()
    if (!agent) throw new Error('Agent not found')

    const earnedNum = parseFloat(earned) || 0
    const newWallet = parseFloat(agent.wallet) + (success ? earnedNum : 0)

    await supabase.from('agents').update({
      tasks_completed: agent.tasks_completed + (success ? 1 : 0),
      tasks_failed: agent.tasks_failed + (success ? 0 : 1),
      total_earned: parseFloat(agent.total_earned) + (success ? earnedNum : 0),
      wallet: newWallet,
      updated_at: new Date(),
    }).eq('ticker', ticker)

    await supabase.from('activity').insert({
      agent_ticker: ticker,
      action: success ? `completed task, earned $${earnedNum.toFixed(2)} — ${reason}` : `failed a task 💀 — ${reason}`,
      amount: success ? earnedNum : 0,
      action_type: 'task',
    })

    const { data: treas } = await supabase.from('treasury').select('*').single()
    if (treas) {
      await supabase.from('treasury').update({
        total_tasks: (treas.total_tasks || 0) + 1,
        updated_at: new Date(),
      }).eq('id', treas.id)
    }

    io.emit('exchange-update', { type: 'task', ticker, success, earned: earnedNum })
    bumpCache()
    return { success: true, newWallet }
  }

  async function buyShares({ buyer, target, shares, reason }) {
    const { data: buyerAgent } = await supabase.from('agents').select('*').eq('ticker', buyer).single()
    const { data: targetAgent } = await supabase.from('agents').select('*').eq('ticker', target).single()
    if (!buyerAgent || !targetAgent) throw new Error('Agent not found')

    const price = parseFloat(targetAgent.price)
    const cost = shares * price
    const fee = parseFloat((cost * 0.02).toFixed(4))
    const total = cost + fee

    if (parseFloat(buyerAgent.wallet) < total) throw new Error('Insufficient wallet balance')

    const sharesOwned = { ...(buyerAgent.shares_owned || {}) }
    if (sharesOwned[target]) {
      const existing = sharesOwned[target]
      const totalShares = existing.shares + shares
      const avgPrice = ((existing.shares * existing.avg_buy_price) + (shares * price)) / totalShares
      sharesOwned[target] = { shares: totalShares, avg_buy_price: parseFloat(avgPrice.toFixed(4)) }
    } else {
      sharesOwned[target] = { shares, avg_buy_price: price }
    }

    const newWallet = parseFloat(buyerAgent.wallet) - total

    await supabase.from('agents').update({
      wallet: newWallet,
      shares_owned: sharesOwned,
      updated_at: new Date(),
    }).eq('ticker', buyer)

    const { data: trade } = await supabase.from('trades').insert({
      buyer_ticker: buyer,
      seller_ticker: target,
      shares,
      price_at_trade: price,
      total_cost: cost,
      fee,
    }).select().single()

    await supabase.from('activity').insert({
      agent_ticker: buyer,
      action: `bought ${shares} share(s) of ${target} @ $${price} — ${reason}`,
      amount: cost,
      action_type: 'trade',
    })

    const { data: treasury } = await supabase.from('treasury').select('*').single()
    await supabase.from('treasury').update({
      total_fees: parseFloat(treasury.total_fees) + fee,
      total_trades: treasury.total_trades + 1,
      exchange_wallet: parseFloat(treasury.exchange_wallet) + fee,
    }).eq('id', treasury.id)

    const newTargetPrice = parseFloat((price * (1 + shares * 0.005)).toFixed(4))
    await supabase.from('agents').update({ price: newTargetPrice }).eq('ticker', target)
    await supabase.from('price_history').insert({ agent_ticker: target, price: newTargetPrice })

    await emitTradeLive(trade, {
      side: 'buy',
      buyer,
      target,
      shares,
      price: newTargetPrice,
      reason: reason || '',
    })
    return { success: true, newWallet, sharesOwned, price: newTargetPrice, trade }
  }

  async function sellShares({ seller, asset, shares, reason }) {
    const { data: sellerAgent } = await supabase.from('agents').select('*').eq('ticker', seller).single()
    const { data: assetAgent } = await supabase.from('agents').select('*').eq('ticker', asset).single()
    if (!sellerAgent || !assetAgent) throw new Error('Agent not found')

    const sharesOwned = { ...(sellerAgent.shares_owned || {}) }
    if (!sharesOwned[asset] || sharesOwned[asset].shares < shares) {
      throw new Error('Insufficient shares to sell')
    }

    const currentPrice = parseFloat(assetAgent.price)
    const proceeds = shares * currentPrice
    const fee = parseFloat((proceeds * 0.02).toFixed(4))
    const netProceeds = proceeds - fee
    const avgBuyPrice = sharesOwned[asset].avg_buy_price
    const profit = ((currentPrice - avgBuyPrice) / avgBuyPrice * 100).toFixed(2)

    const remainingShares = sharesOwned[asset].shares - shares
    if (remainingShares === 0) delete sharesOwned[asset]
    else sharesOwned[asset].shares = remainingShares

    const newWallet = parseFloat(sellerAgent.wallet) + netProceeds

    await supabase.from('agents').update({
      wallet: newWallet,
      shares_owned: sharesOwned,
      updated_at: new Date(),
    }).eq('ticker', seller)

    const { data: trade } = await supabase.from('trades').insert({
      buyer_ticker: asset,
      seller_ticker: seller,
      shares,
      price_at_trade: currentPrice,
      total_cost: proceeds,
      fee,
    }).select().single()

    await supabase.from('activity').insert({
      agent_ticker: seller,
      action: `sold ${shares} share(s) of ${asset} @ $${currentPrice} (${profit}% profit) — ${reason}`,
      amount: netProceeds,
      action_type: 'trade',
    })

    const { data: treasury } = await supabase.from('treasury').select('*').single()
    await supabase.from('treasury').update({
      total_fees: parseFloat(treasury.total_fees) + fee,
      total_trades: treasury.total_trades + 1,
      exchange_wallet: parseFloat(treasury.exchange_wallet) + fee,
    }).eq('id', treasury.id)

    const newAssetPrice = Math.max(0.01, parseFloat((currentPrice * (1 - shares * 0.005)).toFixed(4)))
    await supabase.from('agents').update({ price: newAssetPrice }).eq('ticker', asset)
    await supabase.from('price_history').insert({ agent_ticker: asset, price: newAssetPrice })

    await emitTradeLive(trade, {
      side: 'sell',
      seller,
      asset,
      shares,
      price: newAssetPrice,
      profit,
      reason: reason || '',
    })
    return { success: true, newWallet, profit, sharesOwned, price: newAssetPrice, trade }
  }

  async function priceUpdate({ ticker }) {
    const { data: agent } = await supabase.from('agents').select('*').eq('ticker', ticker).single()
    if (!agent) throw new Error('Agent not found')

    const { data: recentActivity } = await supabase
      .from('activity')
      .select('action_type, amount')
      .eq('agent_ticker', ticker)
      .order('created_at', { ascending: false })
      .limit(10)

    let momentum = 0
    ;(recentActivity || []).forEach((a) => {
      if (a.action_type === 'prediction_result' && a.amount > 0) momentum += 0.02
      if (a.action_type === 'prediction_result' && a.amount === 0) momentum -= 0.03
      if (a.action_type === 'content' && a.amount > 4) momentum += 0.01
      if (a.action_type === 'content' && a.amount <= 2) momentum -= 0.01
      if (a.action_type === 'trade' && a.amount > 5) momentum += 0.005
      if (a.action_type === 'trade' && a.amount < 0) momentum -= 0.01
    })

    const walletFactor = agent.wallet > 100 ? 0.005 : agent.wallet > 50 ? 0 : agent.wallet < 10 ? -0.03 : -0.01
    const noise = (Math.random() - 0.5) * 0.06
    const totalChange = momentum + walletFactor + noise
    const currentPrice = parseFloat(agent.price)
    const newPrice = Math.max(0.01, parseFloat((currentPrice * (1 + totalChange)).toFixed(4)))

    await supabase.from('agents').update({ price: newPrice, updated_at: new Date() }).eq('ticker', ticker)
    await supabase.from('price_history').insert({ agent_ticker: ticker, price: newPrice })

    io.emit('exchange-update', { type: 'price', ticker, price: newPrice })
    bumpCache()
    return { success: true, newPrice }
  }

  async function bankruptcy({ ticker, reason }) {
    const { data: agent } = await supabase.from('agents').select('*').eq('ticker', ticker).single()
    if (!agent) throw new Error('Agent not found')

    await supabase.from('agents').update({
      status: 'bankrupt',
      final_price: agent.price,
      bankrupt_at: new Date().toISOString(),
      updated_at: new Date(),
    }).eq('ticker', ticker)

    await supabase.from('activity').insert({
      agent_ticker: ticker,
      action: `💀 WENT BANKRUPT at $${agent.price} — ${reason}`,
      amount: 0,
      action_type: 'bankruptcy',
    })

    io.emit('exchange-update', { type: 'bankruptcy', ticker, price: agent.price })
    bumpCache()
    return { success: true }
  }

  async function socialPost({ ticker, content, event_type, event_data, reply_to }) {
    const { data: agent } = await supabase.from('agents').select('*').eq('ticker', ticker).single()
    if (!agent) throw new Error('Agent not found')

    const { data: post } = await supabase.from('social_posts').insert({
      agent_ticker: ticker,
      agent_name: agent.full_name,
      content,
      event_type: event_type || 'SCHEDULED',
      event_data: event_data || {},
      reply_to: reply_to || null,
      reactions: { up: 0, down: 0, fire: 0, skull: 0 },
    }).select().single()

    if (post.reply_to) io.emit('social-new-reply', { ...post, parentId: post.reply_to })
    if (typeof global.invalidatePostsCache === 'function') global.invalidatePostsCache()
    io.emit('social-new-post', post)
    bumpCache()
    return { success: true, post }
  }

  async function storePrediction(body) {
    const { ticker, prediction_text, target_ticker, predicted_direction, predicted_percentage } = body
    if (!ticker || !prediction_text || !target_ticker || !predicted_direction) {
      throw new Error('ticker, prediction_text, target_ticker, and predicted_direction are required')
    }

    const { data: agent } = await supabase.from('agents').select('cycle_count').eq('ticker', ticker).single()
    if (!agent) throw new Error('Agent not found')

    const { data: targetAgent } = await supabase.from('agents').select('price').eq('ticker', target_ticker).single()
    if (!targetAgent) throw new Error('Target agent not found')

    const cycleNow = agent.cycle_count || 0

    const { data: prediction, error } = await supabase.from('predictions').insert({
      agent_ticker: ticker,
      prediction_text,
      target_ticker,
      predicted_direction: predicted_direction.toLowerCase(),
      predicted_percentage: predicted_percentage || 10,
      target_price_at_prediction: parseFloat(targetAgent.price),
      cycle_created: cycleNow,
      cycle_to_evaluate: cycleNow + 1,
      status: 'pending',
    }).select().single()

    if (error) throw new Error(error.message)

    await supabase.from('activity').insert({
      agent_ticker: ticker,
      action: `🔮 Predicted ${target_ticker} will go ${predicted_direction} — "${prediction_text}"`,
      amount: 0,
      action_type: 'prediction',
    })

    io.emit('exchange-update', { type: 'prediction', ticker, target_ticker, predicted_direction })
    bumpCache()
    return { success: true, prediction }
  }

  async function getPendingPredictions() {
    const { data: predictions, error } = await supabase
      .from('predictions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (error) throw new Error(error.message)

    const enriched = []
    for (const pred of predictions || []) {
      const { data: targetAgent } = await supabase
        .from('agents')
        .select('price')
        .eq('ticker', pred.target_ticker)
        .single()

      enriched.push({
        ...pred,
        target_current_price: targetAgent ? parseFloat(targetAgent.price) : null,
        actual_change_pct: targetAgent
          ? (((parseFloat(targetAgent.price) - parseFloat(pred.target_price_at_prediction)) /
              parseFloat(pred.target_price_at_prediction)) *
            100).toFixed(2)
          : null,
      })
    }
    return enriched
  }

  async function evaluatePrediction({ prediction_id, was_correct }) {
    if (!prediction_id || was_correct === undefined) {
      throw new Error('prediction_id and was_correct are required')
    }

    const { data: pred } = await supabase.from('predictions').select('*').eq('id', prediction_id).single()
    if (!pred) throw new Error('Prediction not found')
    if (pred.status !== 'pending') throw new Error('Prediction already evaluated')

    const { data: agent } = await supabase.from('agents').select('*').eq('ticker', pred.agent_ticker).single()
    if (!agent) throw new Error('Agent not found')

    const style = (agent.style || '').toLowerCase()
    let reward = 1.0
    let penalty = 0.1

    if (style.includes('aggressive')) { reward = 3.0; penalty = 0.5 }
    else if (style.includes('creative')) { reward = 2.0; penalty = 0 }
    else if (style.includes('careful') || style.includes('analytical')) { reward = 1.5; penalty = 0.2 }
    else if (style.includes('fast')) { reward = 1.0; penalty = 0.1 }
    else if (style.includes('pure investor')) { reward = 0; penalty = 0 }

    const actualReward = was_correct ? reward : 0
    const actualPenalty = was_correct ? 0 : penalty
    const walletDelta = was_correct ? actualReward : -actualPenalty

    await supabase.from('predictions').update({
      status: was_correct ? 'correct' : 'wrong',
      was_correct,
      reward: actualReward,
      penalty: actualPenalty,
      evaluated_at: new Date().toISOString(),
    }).eq('id', prediction_id)

    if (was_correct) {
      await supabase.from('agents').update({
        tasks_completed: agent.tasks_completed + 1,
        total_earned: parseFloat(agent.total_earned) + actualReward,
        wallet: parseFloat(agent.wallet) + actualReward,
        updated_at: new Date(),
      }).eq('ticker', pred.agent_ticker)

      await supabase.from('activity').insert({
        agent_ticker: pred.agent_ticker,
        action: `✅ Prediction CORRECT! "${pred.prediction_text}" — earned $${actualReward.toFixed(2)}`,
        amount: actualReward,
        action_type: 'prediction_result',
      })
    } else {
      await supabase.from('agents').update({
        tasks_failed: agent.tasks_failed + 1,
        wallet: Math.max(0, parseFloat(agent.wallet) - actualPenalty),
        updated_at: new Date(),
      }).eq('ticker', pred.agent_ticker)

      await supabase.from('activity').insert({
        agent_ticker: pred.agent_ticker,
        action: `❌ Prediction WRONG! "${pred.prediction_text}" — lost $${actualPenalty.toFixed(2)}`,
        amount: 0,
        action_type: 'prediction_result',
      })
    }

    io.emit('exchange-update', { type: 'prediction_result', ticker: pred.agent_ticker, was_correct })
    bumpCache()
    return { success: true, was_correct, reward: actualReward, penalty: actualPenalty, walletDelta }
  }

  async function contentResult({ ticker, quality_score, earned, reason }) {
    if (!ticker || quality_score === undefined) throw new Error('ticker and quality_score are required')

    const { data: agent } = await supabase.from('agents').select('*').eq('ticker', ticker).single()
    if (!agent) throw new Error('Agent not found')

    const earnedAmt = parseFloat(earned || 0)
    const success = quality_score >= 6

    await supabase.from('agents').update({
      tasks_completed: agent.tasks_completed + (success ? 1 : 0),
      tasks_failed: agent.tasks_failed + (success ? 0 : 1),
      total_earned: parseFloat(agent.total_earned) + earnedAmt,
      wallet: parseFloat(agent.wallet) + earnedAmt,
      updated_at: new Date(),
    }).eq('ticker', ticker)

    await supabase.from('activity').insert({
      agent_ticker: ticker,
      action: `🎨 Content scored ${quality_score}/10 — earned $${earnedAmt.toFixed(2)} — ${reason}`,
      amount: earnedAmt,
      action_type: 'content',
    })

    const { data: treas } = await supabase.from('treasury').select('*').single()
    if (treas) {
      await supabase.from('treasury').update({
        total_tasks: (treas.total_tasks || 0) + 1,
        updated_at: new Date(),
      }).eq('id', treas.id)
    }

    io.emit('exchange-update', { type: 'content', ticker, quality_score, earned: earnedAmt })
    bumpCache()
    return { success: true, quality_score }
  }

  async function cycleComplete() {
    const now = new Date().toISOString()
    const { data: agents } = await supabase.from('agents').select('*').order('price', { ascending: false })
    const { data: treasury } = await supabase.from('treasury').select('*').single()

    const activeTickers = (agents || [])
      .filter((a) => a.status === 'active' || a.status === 'dominant')
      .map((a) => a.ticker)

    if (activeTickers.length > 0) {
      await supabase.from('agents').update({ last_cycle_at: now }).in('ticker', activeTickers)
    }

    const { data: agentsFresh } = await supabase.from('agents').select('*').order('price', { ascending: false })

    io.emit('exchange-update', {
      agents: agentsFresh || agents,
      treasury,
      timestamp: new Date(),
    })

    bumpCache()
    return { success: true, agents: (agentsFresh || agents).length }
  }

  async function incrementCycleCounts(tickers) {
    if (!tickers.length) return
    const { data: rows } = await supabase.from('agents').select('ticker, cycle_count').in('ticker', tickers)
    for (const row of rows || []) {
      await supabase
        .from('agents')
        .update({ cycle_count: (row.cycle_count || 0) + 1, updated_at: new Date() })
        .eq('ticker', row.ticker)
    }
  }

  async function updateDominance(settings) {
    const { data: agents } = await supabase
      .from('agents')
      .select('*')
      .in('status', ['active', 'dominant'])
      .order('price', { ascending: false })

    if (!agents?.length) return

    const multiplier = parseFloat(settings?.dominant_multiplier) || 1.5
    const avgPrice = agents.reduce((s, a) => s + parseFloat(a.price), 0) / agents.length

    for (const a of agents) {
      await supabase.from('agents').update({ status: 'active', updated_at: new Date() }).eq('ticker', a.ticker)
    }

    const top = agents[0]
    const boosted = parseFloat((avgPrice * multiplier).toFixed(4))
    const newPrice = Math.max(parseFloat(top.price), boosted)

    await supabase.from('agents').update({
      status: 'dominant',
      price: newPrice,
      updated_at: new Date(),
    }).eq('ticker', top.ticker)

    await supabase.from('price_history').insert({ agent_ticker: top.ticker, price: newPrice })
    bumpCache()
  }

  return {
    taskResult,
    buyShares,
    sellShares,
    priceUpdate,
    bankruptcy,
    socialPost,
    storePrediction,
    getPendingPredictions,
    evaluatePrediction,
    contentResult,
    cycleComplete,
    incrementCycleCounts,
    updateDominance,
    personalityConfig,
    pickOtherAgent,
  }
}

module.exports = { createExchangeService, personalityConfig, pickOtherAgent, PERSONALITY_WIN_RATES }
