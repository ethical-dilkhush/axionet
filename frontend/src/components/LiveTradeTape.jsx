import { useEffect, useState, useRef } from 'react'
import { ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'
import { socket } from '../lib/socket'
import AgentAvatar from './AgentAvatar'

const MAX_ITEMS = 12

function agentColor(ticker) {
  const presets = { RAVI: '#00b87a', ZEUS: '#f5a623', NOVA: '#7c3aed', BRAHMA: '#2563eb', KIRA: '#f03358' }
  if (presets[ticker]) return presets[ticker]
  let h = 0
  for (let i = 0; i < (ticker || '').length; i++) h = (h + ticker.charCodeAt(i) * 47) % 360
  return `hsl(${h}, 60%, 50%)`
}

function formatTrade(evt) {
  const side = evt.side
  if (side === 'sell') {
    return {
      id: evt.trade?.id || `${evt.seller}-${evt.asset}-${evt.timestamp}`,
      primary: evt.seller,
      secondary: evt.asset,
      side: 'sell',
      shares: evt.shares,
      price: evt.price,
      reason: evt.reason,
    }
  }
  return {
    id: evt.trade?.id || `${evt.buyer}-${evt.target}-${evt.timestamp}`,
    primary: evt.buyer,
    secondary: evt.target,
    side: 'buy',
    shares: evt.shares,
    price: evt.price,
    reason: evt.reason,
  }
}

export default function LiveTradeTape({ agents = [] }) {
  const [items, setItems] = useState([])
  const [pulse, setPulse] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    const onTrade = (payload) => {
      if (!payload?.trade && !payload?.buyer && !payload?.seller) return
      const row = formatTrade(payload)
      setItems((prev) => [row, ...prev].slice(0, MAX_ITEMS))
      setPulse(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setPulse(false), 600)
    }

    socket.on('trade-live', onTrade)
    return () => {
      socket.off('trade-live', onTrade)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const avatarFor = (ticker) => agents.find((a) => a.ticker === ticker)?.avatar_url

  return (
    <div className={`live-trade-tape ${pulse ? 'live-trade-tape--pulse' : ''}`}>
      <div className="live-trade-tape-label">
        <span className="live-trade-tape-dot" />
        LIVE AGENT TRADES
      </div>
      <div className="live-trade-tape-track">
        {items.length === 0 && (
          <span className="live-trade-tape-empty">Waiting for inter-agent trades…</span>
        )}
        {items.map((t) => (
          <div key={t.id} className={`live-trade-item live-trade-item--${t.side}`}>
            <AgentAvatar ticker={t.primary} avatarUrl={avatarFor(t.primary)} size="xs" />
            <span className="live-trade-ticker" style={{ color: agentColor(t.primary) }}>{t.primary}</span>
            {t.side === 'buy' ? <TrendingUp size={12} className="live-trade-icon" /> : <TrendingDown size={12} className="live-trade-icon" />}
            <span className="live-trade-action">{t.side === 'buy' ? 'bought' : 'sold'}</span>
            <span className="live-trade-ticker" style={{ color: agentColor(t.secondary) }}>${t.secondary}</span>
            <ArrowRight size={10} style={{ opacity: 0.4 }} />
            <span className="live-trade-meta">{t.shares} @ ${parseFloat(t.price || 0).toFixed(4)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
