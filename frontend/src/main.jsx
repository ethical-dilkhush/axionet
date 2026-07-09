import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import WalletProvider from './components/WalletProvider'
import './App.css'
import App from './App.jsx'

// Spotlight cursor effect — gives every .card a soft violet glow that follows the cursor
if (typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches) {
  let raf = 0
  let pending = null
  const handler = (e) => {
    pending = e
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const ev = pending
      pending = null
      if (!ev) return
      const card = ev.target.closest && ev.target.closest('.card')
      if (!card) return
      const r = card.getBoundingClientRect()
      card.style.setProperty('--mx', `${ev.clientX - r.left}px`)
      card.style.setProperty('--my', `${ev.clientY - r.top}px`)
    })
  }
  document.addEventListener('mousemove', handler, { passive: true })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </StrictMode>,
)
