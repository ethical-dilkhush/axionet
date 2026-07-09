import { useEffect, useState } from 'react'
import axios from 'axios'
import AgentAvatar from './AgentAvatar'

const API = import.meta.env.VITE_API_URL

export default function Ticker({ agents: liveAgents }) {
  const [agents, setAgents] = useState([])

  useEffect(() => {
    if (liveAgents && liveAgents.length > 0) {
      setAgents(liveAgents)
    } else {
      axios.get(`${API}/api/agents`).then(r => setAgents(r.data))
    }
  }, [liveAgents])

  const items = [
    ...agents.map(a => ({
      type: 'agent',
      ticker: a.ticker,
      avatarUrl: a.avatar_url,
      price: parseFloat(a.price).toFixed(4),
      change: ((parseFloat(a.price) - 1.0) / 1.0 * 100).toFixed(2),
      status: a.status
    })),
    { type: 'stat', label: '🔄 TRADES', value: '' },
    { type: 'stat', label: '⚡ AUTONOMOUS', value: '' },
    { type: 'stat', label: '🤖 AI EXCHANGE', value: '' },
  ]

  return (
    <div style={{
      background: 'linear-gradient(90deg, #050811 0%, #0d1424 50%, #050811 100%)',
      borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
      height: '38px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      position: 'relative'
    }}>
      <div style={{
        display: 'flex',
        animation: 'ticker-scroll 40s linear infinite',
        whiteSpace: 'nowrap',
        gap: '52px',
        padding: '0 24px'
      }}>
        {[...items, ...items].map((item, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: '0.72rem',
            fontWeight: 500
          }}>
            {item.type === 'agent' ? (
              <>
                <AgentAvatar ticker={item.ticker} avatarUrl={item.avatarUrl} size="xs" style={{ border: 'none' }} />
                <span style={{ color: '#a78bfa', fontWeight: 700, letterSpacing: '0.3px' }}>{item.ticker}</span>
                <span style={{ color: '#ffffff', fontWeight: 600 }}>${item.price}</span>
                <span style={{
                  color: parseFloat(item.change) >= 0 ? '#34d399' : '#f87171',
                  fontWeight: 700
                }}>
                  {parseFloat(item.change) >= 0 ? '▲' : '▼'} {Math.abs(item.change)}%
                </span>
                {item.status === 'bankrupt' && (
                  <span style={{
                    fontSize: '0.58rem',
                    background: 'linear-gradient(180deg, #dc2626, #b91c1c)',
                    color: 'white',
                    padding: '2px 7px',
                    borderRadius: '999px',
                    fontWeight: 700,
                    letterSpacing: '0.5px'
                  }}>BANKRUPT</span>
                )}
                <span style={{ color: '#1f2742' }}>|</span>
              </>
            ) : (
              <span style={{ color: '#475569', letterSpacing: '0.5px', fontWeight: 600 }}>{item.label}</span>
            )}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  )
}