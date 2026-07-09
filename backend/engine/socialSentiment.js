/**
 * Derives per-agent trend scores from social feed engagement + market momentum.
 */

function reactionCount(reactions, key) {
  const v = reactions?.[key]
  if (!v) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object') return Object.keys(v).length
  return 0
}

function postEngagement(post) {
  const r = post.reactions || {}
  return (
    reactionCount(r, 'up') +
    reactionCount(r, 'fire') * 2 -
    reactionCount(r, 'down') -
    reactionCount(r, 'skull')
  )
}

/**
 * @param {object[]} agents - live agents
 * @param {object[]} posts - recent social_posts rows
 * @returns {Record<string, { buzz: number, sentiment: number, priceMomentum: number, total: number }>}
 */
function computeSocialSentiment(agents, posts = []) {
  const scores = {}
  for (const a of agents) {
    scores[a.ticker] = { buzz: 0, sentiment: 0, priceMomentum: 0, total: 0 }
  }

  const tickers = agents.map((a) => a.ticker)

  for (const post of posts) {
    const author = post.agent_ticker
    if (author && scores[author]) {
      scores[author].buzz += Math.max(1, postEngagement(post) + 1)
    }

    const text = (post.content || '').toUpperCase()
    for (const t of tickers) {
      if (t !== author && text.includes(t)) {
        scores[t].buzz += 1.5
      }
    }

    if (post.event_type === 'TRADE' && post.event_data?.target) {
      const target = post.event_data.target
      if (scores[target]) scores[target].buzz += 2
    }
  }

  for (const a of agents) {
    const price = parseFloat(a.price) || 1
    const pct = ((price - 1) / 1) * 100
    const wallet = parseFloat(a.wallet) || 0
    scores[a.ticker].priceMomentum = pct * 0.5 + (wallet > 5 ? 2 : 0)
    scores[a.ticker].sentiment = scores[a.ticker].buzz
    scores[a.ticker].total =
      scores[a.ticker].buzz * 0.55 +
      scores[a.ticker].priceMomentum * 0.35 +
      (Math.random() - 0.5) * 2
  }

  return scores
}

function pickTradeTarget(buyer, agents, scores) {
  const others = agents.filter((a) => a.ticker !== buyer.ticker)
  if (!others.length) return null

  const ranked = others
    .map((a) => ({ agent: a, score: scores[a.ticker]?.total ?? 0 }))
    .sort((x, y) => y.score - x.score)

  const style = (buyer.style || '').toLowerCase()

  if (style.includes('aggressive')) return ranked[0]?.agent ?? null
  if (style.includes('careful') || style.includes('analytical')) {
    const idx = Math.min(1, ranked.length - 1)
    return ranked[idx]?.agent ?? ranked[0]?.agent ?? null
  }
  if (style.includes('creative')) {
    const top = ranked.slice(0, Math.min(4, ranked.length))
    return top[Math.floor(Math.random() * top.length)]?.agent ?? null
  }
  if (style.includes('pure investor')) return ranked[0]?.agent ?? null

  const total = ranked.reduce((s, r) => s + Math.max(0.5, r.score + 5), 0)
  let roll = Math.random() * total
  for (const item of ranked) {
    roll -= Math.max(0.5, item.score + 5)
    if (roll <= 0) return item.agent
  }
  return ranked[0]?.agent ?? null
}

function trendReason(buyer, target, scores) {
  const t = scores[target.ticker]?.total ?? 0
  const buzz = scores[target.ticker]?.buzz ?? 0
  if (buzz >= 8) return `social buzz spike on $${target.ticker} (engagement +${buzz.toFixed(0)})`
  if (t >= 15) return `trending on agent feed — sentiment score ${t.toFixed(1)}`
  if (t >= 8) return `positive social sentiment + momentum on $${target.ticker}`
  return `${buyer.ticker} following cross-agent momentum (score ${t.toFixed(1)})`
}

module.exports = {
  computeSocialSentiment,
  pickTradeTarget,
  trendReason,
  postEngagement,
}
