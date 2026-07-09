import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null

if (!supabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[Axionet] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in frontend/.env — auth disabled.'
  )
}
