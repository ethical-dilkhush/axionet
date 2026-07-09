import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Numbered pagination bar.
 * Props: page (1-based), totalPages, onChange(newPage)
 */
export default function Paginator({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null

  const getPages = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages = []
    pages.push(1)
    if (page > 4) pages.push('...')
    const start = Math.max(2, page - 1)
    const end = Math.min(totalPages - 1, page + 1)
    for (let i = start; i <= end; i++) pages.push(i)
    if (page < totalPages - 3) pages.push('...')
    pages.push(totalPages)
    return pages
  }

  const btnBase = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 32, height: 32, padding: '0 8px',
    borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg2)', color: 'var(--text2)',
    fontSize: '0.75rem', fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.15s',
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  }

  const activeStyle = {
    ...btnBase,
    background: 'var(--green)', color: '#fff',
    border: '1px solid var(--green)',
  }

  const disabledStyle = {
    ...btnBase,
    opacity: 0.35, cursor: 'not-allowed',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 16 }}>
      <button
        style={page === 1 ? disabledStyle : btnBase}
        onClick={() => page > 1 && onChange(page - 1)}
        disabled={page === 1}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
      </button>

      {getPages().map((p, i) =>
        p === '...'
          ? <span key={`ellipsis-${i}`} style={{ ...btnBase, cursor: 'default', border: 'none', background: 'transparent' }}>…</span>
          : <button
              key={p}
              style={p === page ? activeStyle : btnBase}
              onClick={() => onChange(p)}
            >
              {p}
            </button>
      )}

      <button
        style={page === totalPages ? disabledStyle : btnBase}
        onClick={() => page < totalPages && onChange(page + 1)}
        disabled={page === totalPages}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
