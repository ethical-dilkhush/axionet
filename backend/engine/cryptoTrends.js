/**
 * Trending cryptocurrencies from CoinGecko + mentions in agent social feed.
 */

const axios = require('axios')

const CRYPTO_KEYWORDS = [
  'BTC', 'BITCOIN', 'ETH', 'ETHEREUM', 'SOL', 'SOLANA', 'DOGE', 'DOGECOIN',
  'XRP', 'RIPPLE', 'ADA', 'CARDANO', 'AVAX', 'AVALANCHE', 'LINK', 'CHAINLINK',
  'BNB', 'MATIC', 'POLYGON', 'DOT', 'POLKADOT', 'SHIB', 'PEPE', 'ARB', 'OP',
]

const FALLBACK_TRENDS = [
  { symbol: 'BTC', name: 'Bitcoin', rank: 1, buzz: 10, change24h: 0 },
  { symbol: 'ETH', name: 'Ethereum', rank: 2, buzz: 9, change24h: 0 },
  { symbol: 'SOL', name: 'Solana', rank: 3, buzz: 8, change24h: 0 },
]

let cache = { trends: null, fetchedAt: 0 }
const CACHE_MS = 5 * 60 * 1000

async function fetchCoinGeckoTrending() {
  const now = Date.now()
  if (cache.trends && now - cache.fetchedAt < CACHE_MS) {
    return cache.trends
  }

  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/search/trending', {
      timeout: 8000,
      headers: { Accept: 'application/json' },
    })
    const trends = (data?.coins || []).slice(0, 12).map((entry, i) => ({
      symbol: (entry.item?.symbol || '').toUpperCase(),
      name: entry.item?.name || entry.item?.symbol,
      rank: i + 1,
      buzz: Math.max(12 - i, 1),
      change24h: 0,
      source: 'coingecko',
    }))
    cache = { trends, fetchedAt: now }
    return trends
  } catch (err) {
    console.warn('[crypto] CoinGecko trending fetch failed:', err.message)
    return cache.trends || FALLBACK_TRENDS
  }
}

function scanPostsForCrypto(posts = []) {
  const mentionCounts = {}
  for (const post of posts) {
    const text = (post.content || '').toUpperCase()
    for (const kw of CRYPTO_KEYWORDS) {
      if (text.includes(kw)) {
        const sym = kw.length <= 4 ? kw : kw.slice(0, 4)
        mentionCounts[sym] = (mentionCounts[sym] || 0) + 1
      }
    }
  }
  return Object.entries(mentionCounts)
    .map(([symbol, count]) => ({ symbol, buzz: count * 2, source: 'social' }))
    .sort((a, b) => b.buzz - a.buzz)
    .slice(0, 8)
}

function mergeTrendSignals(coingecko = [], social = []) {
  const map = new Map()
  for (const t of coingecko) {
    map.set(t.symbol, { ...t, coingeckoBuzz: t.buzz, socialBuzz: 0, combined: t.buzz })
  }
  for (const s of social) {
    const existing = map.get(s.symbol)
    if (existing) {
      existing.socialBuzz = s.buzz
      existing.combined = existing.coingeckoBuzz + s.buzz
    } else {
      map.set(s.symbol, {
        symbol: s.symbol,
        name: s.symbol,
        rank: 99,
        buzz: s.buzz,
        coingeckoBuzz: 0,
        socialBuzz: s.buzz,
        combined: s.buzz,
        source: 'social',
      })
    }
  }
  return [...map.values()].sort((a, b) => b.combined - a.combined)
}

function agentCryptoAlignment(agent, posts, trending) {
  const topSymbols = new Set(trending.slice(0, 5).map((t) => t.symbol))
  let alignment = 0
  const agentPosts = posts.filter((p) => p.agent_ticker === agent.ticker)
  for (const post of agentPosts) {
    const text = (post.content || '').toUpperCase()
    for (const sym of topSymbols) {
      if (text.includes(sym) || text.includes(sym === 'BTC' ? 'BITCOIN' : sym)) {
        alignment += 3
      }
    }
  }
  const style = (agent.style || '').toLowerCase()
  if (style.includes('aggressive') && trending[0]) alignment += 1
  if (style.includes('analytical') && trending.length) alignment += 2
  return alignment
}

async function buildCryptoMarketContext(posts = []) {
  const coingecko = await fetchCoinGeckoTrending()
  const social = scanPostsForCrypto(posts)
  const trending = mergeTrendSignals(coingecko, social)
  const marketMood =
    trending.slice(0, 3).reduce((s, t) => s + t.combined, 0) / 3
  return {
    trending,
    marketMood,
    topSymbol: trending[0]?.symbol || 'BTC',
    summary: trending.slice(0, 3).map((t) => `$${t.symbol}`).join(', '),
  }
}

module.exports = {
  buildCryptoMarketContext,
  agentCryptoAlignment,
  fetchCoinGeckoTrending,
  CRYPTO_KEYWORDS,
}
