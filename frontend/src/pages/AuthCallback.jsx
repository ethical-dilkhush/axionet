import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Loader } from 'lucide-react'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [processing, setProcessing] = useState(true)
  const [errorMsg, setErrorMsg] = useState(null)

  useEffect(() => {
    if (!supabase) {
      setErrorMsg('Auth is not configured on this server.')
      setProcessing(false)
      return
    }

    let cancelled = false

    const finish = (path) => {
      if (!cancelled) navigate(path, { replace: true })
    }

    const completeAuth = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        }

        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError

        if (session) {
          window.history.replaceState({}, document.title, '/auth/callback')
          finish('/')
          return
        }

        await new Promise((resolve) => setTimeout(resolve, 500))
        const { data: { session: retry } } = await supabase.auth.getSession()
        if (retry) {
          finish('/')
        } else {
          setErrorMsg('Sign-in could not be completed. Try again from the login page.')
          finish('/login')
        }
      } catch (err) {
        console.error('Auth callback error:', err)
        setErrorMsg(err?.message || 'Sign-in failed')
        finish('/login')
      } finally {
        if (!cancelled) setProcessing(false)
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        finish('/')
        setProcessing(false)
      }
    })

    completeAuth()

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [navigate])

  return (
    <div className="auth-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="auth-card" style={{ textAlign: 'center', padding: 48 }}>
        {processing && (
          <>
            <Loader size={32} className="auth-spinner" style={{ margin: '0 auto 16px', display: 'block' }} />
            <p style={{ color: 'var(--text3)', fontSize: '0.9rem' }}>Completing sign in...</p>
          </>
        )}
        {!processing && errorMsg && (
          <p style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{errorMsg}</p>
        )}
      </div>
    </div>
  )
}
