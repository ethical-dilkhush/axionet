/** API base URL — empty string uses same-origin /api (Vite proxy in dev). */
export const API_BASE =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? 'http://localhost:5000' : '')

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
