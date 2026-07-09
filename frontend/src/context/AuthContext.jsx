import { createContext, useContext, useState, useEffect } from 'react'
import { API_BASE } from '../lib/config'
import { supabase, supabaseConfigured } from '../lib/supabase'

const API = API_BASE
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s)
        setUser(s?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) {
      setProfile(null)
      return
    }
    fetch(`${API}/api/user/profile/${user.id}`)
      .then(res => res.ok ? res.json() : null)
      .then(async (data) => {
        if (data) {
          setProfile(data)
          return
        }
        // New Google (or OAuth) user — auto-create profile
        const res = await fetch(`${API}/api/user/profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: user.id,
            email: user.email,
            username: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User',
            avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
            role: 'user',
          }),
        })
        const created = res.ok ? await res.json() : null
        setProfile(created ?? null)
      })
      .catch(() => setProfile(null))
  }, [user])

  const refreshProfile = async () => {
    if (!user) return
    try {
      const res = await fetch(`${API}/api/user/profile/${user.id}`)
      const data = res.ok ? await res.json() : null
      setProfile(data ?? null)
    } catch {
      setProfile(null)
    }
  }

  const signInWithGoogle = async () => {
    if (!supabase) throw new Error('Supabase is not configured')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setProfile(null)
  }

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, signOut, refreshProfile, signInWithGoogle }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
