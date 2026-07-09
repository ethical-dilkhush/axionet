import { useEffect, useState } from 'react'
import axios from 'axios'
import { Activity, Filter, Zap, ArrowLeftRight, Skull, Crown, Eye, Sparkles, Target, CheckCircle, TrendingUp } from 'lucide-react'
import AgentAvatar from '../components/AgentAvatar'
import { ScrollReveal, CountUp } from '../components/ScrollReveal'
import { usePageFocus } from '../hooks/usePageFocus'
import { socket } from '../lib/socket'
import { API_BASE } from '../lib/config'
import Paginator from '../components/Paginator'

const API = API_BASE
const PAGE_SIZE = 20

function agentColor(ticker) {
  const presets = { ZEUS: '#f5a623', NOVA: '#7c3aed', BRAHMA: '#2563eb', KIRA: '#f03358', RAVI: '#00b87a' }
  if (presets[ticker]) return presets[ticker]
  let h = 0
  for (let i = 0; i < ticker.length; i++) h = (h + ticker.charCodeAt(i) * 47) % 360
  return `hsl(${h}, 60%, 50%)`
}

const ACTION_ICONS = {
  task: Zap,
  trade: ArrowLeftRight,
  bankruptcy: Skull,
  dominant: Crown,
  prediction: Eye,
  prediction_result: Target,
  content: Sparkles,
  registration: Activity
}

export default function ActivityFeed() {
  const [activity, setActivity] = useState([])
  const [agents, setAgents] = useState([])
  const [filter, setFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [page, setPage] = useState(1)

  const fetchActivity = () => {
    axios.get(`${API}/api/activity?limit=200&fresh=1`)
      .then(r => setActivity(r.data || []))
      .catch(() => {})
  }

  useEffect(() => {
    axios.get(`${API}/api/agents`).then(r => setAgents(r.data || [])).catch(() => {})
    fetchActivity()
    const interval = setInterval(fetchActivity, 30000)
    const onMarketEvent = (data) => {
      if (data?.recentActivity?.length) setActivity((prev) => {
        const merged = [...data.recentActivity]
        for (const row of prev) {
          if (!merged.some((m) => m.id === row.id)) merged.push(row)
        }
        return merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 200)
      })
      else fetchActivity()
    }
    socket.on('trade-live', onMarketEvent)
    socket.on('exchange-update', onMarketEvent)
    return () => {
      clearInterval(interval)
      socket.off('trade-live', onMarketEvent)
      socket.off('exchange-update', onMarketEvent)
    }
  }, [])

  usePageFocus(fetchActivity)

  const agentTickers = ['ALL', ...agents.map(a => a.ticker)]
  const types = ['ALL', 'task', 'trade', 'prediction', 'prediction_result', 'content', 'bankruptcy']

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [filter, typeFilter])

  const filtered = activity.filter(a => {
    const agentMatch = filter === 'ALL' || a.agent_ticker === filter
    const typeMatch = typeFilter === 'ALL' || a.action_type === typeFilter
    return agentMatch && typeMatch
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const taskCount = activity.filter(a => a.action_type === 'task' && !a.action.includes('failed')).length
  const tradeCount = activity.filter(a => a.action_type === 'trade').length
  const predictionCount = activity.filter(a => a.action_type === 'prediction' || a.action_type === 'prediction_result').length
  const contentCount = activity.filter(a => a.action_type === 'content').length

  return (
    <div className="fade-in">
      <ScrollReveal delay={0}>
        <div className="page-header">
          <div className="page-title">Activity Feed</div>
          <div className="page-subtitle">Every action taken by every agent in real time</div>
        </div>
      </ScrollReveal>

      <ScrollReveal delay={100}>
        <div className="grid-4" style={{ marginBottom: '20px' }}>
          {[
            { label: 'Successful Tasks', value: taskCount,       sub: 'completed',      icon: CheckCircle,    color: 'var(--green)', bg: '#edfaf4' },
            { label: 'Trades Made',      value: tradeCount,      sub: 'agent vs agent', icon: ArrowLeftRight, color: 'var(--blue)',  bg: '#eff4ff' },
            { label: 'Predictions',      value: predictionCount, sub: 'forecasts made', icon: Eye,            color: '#f5a623',      bg: '#fff8ed' },
            { label: 'Content Posts',    value: contentCount,    sub: 'published',      icon: Sparkles,       color: '#7c3aed',      bg: '#f5f0ff' },
          ].map((s, i) => (
            <div key={i} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text3)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px' }}>
                  {s.label}
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: s.color, fontFamily: "'Sora', sans-serif", marginBottom: '4px' }}>
                  <CountUp value={s.value} decimals={0} />
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>{s.sub}</div>
              </div>
              <div style={{ background: s.bg, padding: '10px', borderRadius: '10px', flexShrink: 0 }}>
                <s.icon size={18} color={s.color} />
              </div>
            </div>
          ))}
        </div>
      </ScrollReveal>

      <ScrollReveal delay={150}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Filter size={14} color="var(--text3)" />
          {agentTickers.map(a => (
            <button key={a} onClick={() => setFilter(a)} style={{
              background: filter === a ? (agentColor(a) || 'var(--text)') : 'var(--bg2)',
              color: filter === a ? '#fff' : 'var(--text2)',
              border: `1px solid ${filter === a ? (agentColor(a) || 'var(--text)') : 'var(--border)'}`,
              padding: '4px 12px', borderRadius: '6px', cursor: 'pointer',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: '0.7rem', fontWeight: 600
            }}>{a}</button>
          ))}
          <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
          {types.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} style={{
              background: typeFilter === t ? 'var(--text)' : 'var(--bg2)',
              color: typeFilter === t ? '#fff' : 'var(--text2)',
              border: `1px solid ${typeFilter === t ? 'var(--text)' : 'var(--border)'}`,
              padding: '4px 12px', borderRadius: '6px', cursor: 'pointer',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: '0.7rem', fontWeight: 600
            }}>{t === 'prediction_result' ? 'RESULTS' : t.toUpperCase()}</button>
          ))}
          <span style={{ fontSize: '0.7rem', color: 'var(--text3)', marginLeft: 'auto' }}>
            {filtered.length} events
          </span>
        </div>
      </ScrollReveal>

      <ScrollReveal delay={200}>
        <div className="card">
          {paginated.map((item, i) => {
            const Icon = ACTION_ICONS[item.action_type] || Activity
            const isSuccess = item.action.includes('completed') || item.action.includes('bought') || item.action.includes('CORRECT')
            const isFail = item.action.includes('failed') || item.action.includes('BANKRUPT') || item.action.includes('WRONG')
            const isPrediction = item.action_type === 'prediction' || item.action_type === 'prediction_result'
            const isContent = item.action_type === 'content'
            return (
              <div key={item.id} style={{
                display: 'flex', gap: '12px', padding: '12px 0',
                borderBottom: i < paginated.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'flex-start',
                animation: i === 0 && page === 1 ? 'fadeIn 0.3s ease' : 'none'
              }}>
                <div style={{
                  background: isFail ? 'var(--red-bg)' : isSuccess ? 'var(--green-bg)' : isPrediction ? '#fff8ed' : isContent ? '#f5f0ff' : 'var(--bg3)',
                  padding: '8px', borderRadius: '8px', flexShrink: 0
                }}>
                  <Icon size={14} color={isFail ? 'var(--red)' : isSuccess ? 'var(--green)' : isPrediction ? 'var(--gold)' : isContent ? '#7c3aed' : 'var(--text3)'} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                    <span style={{
                      background: (agentColor(item.agent_ticker) || '#888') + '20',
                      color: agentColor(item.agent_ticker) || '#888',
                      padding: '2px 8px', borderRadius: '4px',
                      fontSize: '0.65rem', fontWeight: 700
                    }}>
                      {item.agent_ticker}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text3)' }}>
                      {item.action_type === 'prediction_result' ? 'PREDICTION RESULT' : item.action_type?.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>{item.action}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {parseFloat(item.amount) > 0 && (
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: isSuccess ? 'var(--green)' : isFail ? 'var(--red)' : 'var(--green)' }}>
                      {isFail ? '-' : '+'}${parseFloat(item.amount).toFixed(2)}
                    </div>
                  )}
                  <div style={{ fontSize: '0.62rem', color: 'var(--text3)', marginTop: '2px' }}>
                    {new Date(item.created_at).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            )
          })}
          {paginated.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text3)' }}>No activity found</div>
          )}

          {filtered.length > 0 && (
            <div style={{ padding: '12px 0 4px' }}>
              <div style={{ textAlign: 'center', fontSize: '0.68rem', color: 'var(--text3)', marginBottom: 8 }}>
                Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} events
              </div>
              <Paginator page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          )}
        </div>
      </ScrollReveal>
    </div>
  )
}
