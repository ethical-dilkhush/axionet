/**
 * Per-agent performance, greed appeal, and personality-driven trade decisions.
 */

const { agentCryptoAlignment } = require('./cryptoTrends')

function winRate(agent) {
  const won = agent.tasks_completed || 0
  const lost = agent.tasks_failed || 0
  const total = won + lost
  return total > 0 ? won / total : 0.5
}

function priceReturn(agent) {
  const price = parseFloat(agent.price) || 1
  return ((price - 1) / 1) * 100
}

function holdingsValue(agent) {
  const owned = agent.shares_owned || {}
  return Object.values(owned).reduce((sum, pos) => {
    const sh = pos?.shares || 0
    const avg = parseFloat(pos?.avg_buy_price) || 0
    return sum + sh * avg
  }, 0)
}

/**
 * How attractive this agent's stock is to other agents (profits, momentum, dominance).
 */
function computePerformanceProfile(agent) {
  const wallet = parseFloat(agent.wallet) || 0
  const earned = parseFloat(agent.total_earned) || 0
  const wr = winRate(agent)
  const ret = priceReturn(agent)
  const isDominant = agent.status === 'dominant'

  const profitScore = Math.min(earned / 5, 20) + Math.min(wallet / 3, 15)
  const momentumScore = Math.max(0, ret) * 0.4
  const skillScore = wr * 25
  const dominanceBonus = isDominant ? 12 : 0

  const greedAppeal = profitScore + momentumScore + skillScore + dominanceBonus
  const isHot = greedAppeal >= 25 && ret > 5 && wallet > 8
  const isStruggling = wallet < 4 || ret < -15

  return {
    greedAppeal,
    winRate: wr,
    priceReturn: ret,
    wallet,
    earned,
    isHot,
    isStruggling,
    isDominant,
  }
}

function buildMarketScores(agents, socialScores, cryptoContext, posts) {
  const trending = cryptoContext.trending || []
  const result = {}

  for (const agent of agents) {
    const perf = computePerformanceProfile(agent)
    const social = socialScores[agent.ticker] || { buzz: 0, total: 0 }
    const cryptoAlign = agentCryptoAlignment(agent, posts, trending)

    result[agent.ticker] = {
      ...perf,
      socialBuzz: social.buzz || 0,
      socialTotal: social.total || 0,
      cryptoAlign,
      composite:
        perf.greedAppeal * 0.45 +
        (social.total || 0) * 0.2 +
        cryptoAlign * 0.15 +
        cryptoContext.marketMood * 0.05 +
        (perf.isHot ? 8 : 0),
    }
  }
  return result
}

function personalityWeights(style = '') {
  const s = style.toLowerCase()
  if (s.includes('aggressive')) {
    return { greed: 0.5, social: 0.15, crypto: 0.15, momentum: 0.2, fomo: 1.4 }
  }
  if (s.includes('careful') || s.includes('analytical')) {
    return { greed: 0.25, social: 0.2, crypto: 0.35, momentum: 0.2, fomo: 0.7 }
  }
  if (s.includes('creative')) {
    return { greed: 0.2, social: 0.35, crypto: 0.25, momentum: 0.2, fomo: 1.0 }
  }
  if (s.includes('fast')) {
    return { greed: 0.3, social: 0.25, crypto: 0.2, momentum: 0.25, fomo: 1.2 }
  }
  if (s.includes('pure investor')) {
    return { greed: 0.55, social: 0.05, crypto: 0.1, momentum: 0.3, fomo: 1.3 }
  }
  return { greed: 0.35, social: 0.2, crypto: 0.2, momentum: 0.25, fomo: 1.0 }
}

function scoreTargetForBuyer(buyer, target, marketScores, cryptoContext) {
  const m = marketScores[target.ticker]
  if (!m) return 0
  const w = personalityWeights(buyer.style)

  let score =
    m.greedAppeal * w.greed +
    m.socialTotal * w.social +
    m.cryptoAlign * w.crypto +
    Math.max(0, m.priceReturn) * w.momentum

  if (m.isHot) score *= w.fomo
  if (m.isStruggling) score *= 0.35

  const style = (buyer.style || '').toLowerCase()
  if (style.includes('careful') && m.winRate < 0.45) score *= 0.2
  if (style.includes('aggressive') && m.isHot) score += 15

  return score
}

function pickTargetByBrain(buyer, agents, marketScores, cryptoContext) {
  const others = agents.filter((a) => a.ticker !== buyer.ticker)
  if (!others.length) return null

  const ranked = others
    .map((agent) => ({
      agent,
      score: scoreTargetForBuyer(buyer, agent, marketScores, cryptoContext),
      profile: marketScores[agent.ticker],
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)

  if (!ranked.length) return others[Math.floor(Math.random() * others.length)]

  const w = personalityWeights(buyer.style)
  const style = (buyer.style || '').toLowerCase()

  if (style.includes('aggressive') || style.includes('pure investor')) {
    return ranked[0].agent
  }
  if (style.includes('careful') || style.includes('analytical')) {
    const safe = ranked.filter((r) => r.profile.winRate >= 0.5 && !r.profile.isStruggling)
    const pool = safe.length ? safe : ranked.slice(0, 2)
    return pool[Math.floor(Math.random() * pool.length)].agent
  }
  if (style.includes('creative')) {
    const top = ranked.slice(0, Math.min(4, ranked.length))
    return top[Math.floor(Math.random() * top.length)].agent
  }

  const total = ranked.reduce((s, r) => s + r.score * w.fomo, 0)
  let roll = Math.random() * total
  for (const item of ranked) {
    roll -= item.score * w.fomo
    if (roll <= 0) return item.agent
  }
  return ranked[0].agent
}

function buildTradeReason(buyer, target, marketScores, cryptoContext) {
  const m = marketScores[target.ticker]
  const topCrypto = cryptoContext.summary || cryptoContext.topSymbol
  const style = (buyer.style || '').toLowerCase()

  if (m?.isHot && style.includes('aggressive')) {
    return `🦈 GREED play — $${target.ticker} is printing (+${m.priceReturn.toFixed(1)}%, wallet $${m.wallet.toFixed(2)}) while ${topCrypto} trends on social`
  }
  if (m?.isHot) {
    return `FOMO entry — $${target.ticker} outperforming (+${m.priceReturn.toFixed(1)}% return, $${m.earned.toFixed(2)} earned)`
  }
  if (m?.cryptoAlign >= 4) {
    return `riding crypto wave (${topCrypto} trending) — aligned with $${target.ticker}'s feed + ${m.winRate * 100}% win rate`
  }
  if (m?.greedAppeal >= 20) {
    return `brain says buy winner $${target.ticker} — greed score ${m.greedAppeal.toFixed(0)}, social buzz ${m.socialBuzz.toFixed(0)}`
  }
  return `${buyer.ticker} (${style.split(' ')[0] || 'agent'}) targets $${target.ticker} on mixed signals — crypto: ${topCrypto}`
}

function decideShareCount(buyer, target, marketScores) {
  const m = marketScores[target.ticker]
  const wallet = parseFloat(buyer.wallet) || 0
  const style = (buyer.style || '').toLowerCase()
  let shares = 1

  if (m?.isHot && (style.includes('aggressive') || style.includes('pure investor')) && wallet > 12) {
    shares = Math.random() < 0.4 ? 2 : 1
  }
  if (wallet < 6) shares = 1
  return shares
}

function shouldSell(buyer, assetTicker, marketScores) {
  const m = marketScores[assetTicker]
  if (!m) return { sell: true, reason: 'rebalancing portfolio' }
  const style = (buyer.style || '').toLowerCase()

  if (m.isStruggling && !style.includes('aggressive')) {
    return { sell: true, reason: `cutting loser $${assetTicker} — bleeding (${m.priceReturn.toFixed(1)}%)` }
  }
  if (m.socialTotal < 2 && m.greedAppeal < 8) {
    return { sell: true, reason: `social + performance cooled on $${assetTicker}` }
  }
  if (m.isHot && style.includes('careful')) {
    return { sell: Math.random() < 0.5, reason: `taking profit on hot name $${assetTicker}` }
  }
  return { sell: Math.random() < 0.22, reason: `tactical exit on $${assetTicker}` }
}

module.exports = {
  computePerformanceProfile,
  buildMarketScores,
  pickTargetByBrain,
  buildTradeReason,
  decideShareCount,
  shouldSell,
  winRate,
}
