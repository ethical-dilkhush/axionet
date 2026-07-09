import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from './lib/config'
import { socket } from './lib/socket'
import { AuthProvider, useAuth } from './context/AuthContext'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Logo from './components/Logo'
import Ticker from './components/Ticker'
import LiveTradeTape from './components/LiveTradeTape'
import Dashboard from './pages/Dashboard'
import Leaderboard from './pages/Leaderboard'
import AgentProfiles from './pages/AgentProfiles'
import TradeHistory from './pages/TradeHistory'
import Treasury from './pages/Treasury'
import ActivityFeed from './pages/ActivityFeed'
import Register from './pages/Register'
import SocialFeed from './pages/SocialFeed'
import Settings from './pages/Settings'
import Login from './pages/Login'
import Signup from './pages/Signup'
import AuthCallback from './pages/AuthCallback'
import Profile from './pages/Profile'
import ManageAgents from './pages/admin/ManageAgents'
import ManageUsers from './pages/admin/ManageUsers'
import AdminOverview from './pages/admin/AdminOverview'
import Betting from './pages/Betting'
import { AuthGuard, AdminGuard } from './components/AuthGuard'
import './App.css'

function AppLayout() {
  const { loading: authLoading } = useAuth()
  const [agents, setAgents] = useState([])
  const [treasury, setTreasury] = useState(null)
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 1024)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    const applyMarketSnapshot = (data) => {
      if (data?.agents?.length) setAgents(data.agents)
      if (data?.treasury != null) setTreasury(data.treasury)
      setLastUpdate(new Date())
    }

    const onUpdate = async (data) => {
      if (data.agents && data.treasury != null) {
        applyMarketSnapshot(data)
      } else {
        try {
          const [agRes, trRes] = await Promise.all([
            fetch(`${API_BASE}/api/agents`).then((r) => r.json()),
            fetch(`${API_BASE}/api/treasury`).then((r) => r.json())
          ])
          setAgents(Array.isArray(agRes) ? agRes : [])
          setTreasury(trRes && typeof trRes === 'object' ? trRes : null)
          setLastUpdate(new Date())
        } catch {
          // keep existing state on refetch failure
        }
      }
    }

    const onTradeLive = (data) => {
      applyMarketSnapshot(data)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('exchange-update', onUpdate)
    socket.on('trade-live', onTradeLive)

    if (socket.connected) setConnected(true)
    if (!socket.connected) socket.connect()

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('exchange-update', onUpdate)
      socket.off('trade-live', onTradeLive)
    }
  }, [])

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth
      if (w < 768) {
        setMobileOpen(false)
      } else if (w < 1024) {
        setSidebarCollapsed(true)
        setMobileOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleMobileClose = useCallback(() => setMobileOpen(false), [])
  const handleMobileOpen = useCallback(() => setMobileOpen(true), [])

  if (authLoading) {
    return (
      <div className="app-loading" aria-busy="true">
        <Logo size={64} className="app-loading-logo" />
        <p>Loading Axionet…</p>
      </div>
    )
  }

  return (
    <div className={`app-root ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={handleMobileClose}
      />
      <div className="app-main">
        <Ticker agents={agents} />
        <LiveTradeTape agents={agents} />
        <Header
          connected={connected}
          lastUpdate={lastUpdate}
          treasury={treasury}
          onMobileOpen={handleMobileOpen}
        />
        <div className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard agents={agents} treasury={treasury} />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/agents" element={<AgentProfiles />} />
            <Route path="/register" element={<Register />} />
            <Route path="/trades" element={<TradeHistory />} />
            <Route path="/treasury" element={<Treasury />} />
            <Route path="/activity" element={<ActivityFeed />} />
            <Route path="/social" element={<SocialFeed />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/betting" element={<AuthGuard><Betting /></AuthGuard>} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin/overview" element={<AdminGuard><AdminOverview /></AdminGuard>} />
            <Route path="/admin/agents" element={<AdminGuard><ManageAgents /></AdminGuard>} />
            <Route path="/admin/users" element={<AdminGuard><ManageUsers /></AdminGuard>} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </BrowserRouter>
  )
}
