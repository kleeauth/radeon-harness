import { useMemo, useState } from 'react'
import type { Session } from '@opencode-ai/sdk'
import { displayTitle } from '../lib/opencode'
import { LogoMark, PlusIcon, PuzzleIcon, SearchIcon, SidebarIcon } from './Icons'

type Props = {
  sessions: Session[]
  activeID: string | null
  busy: Record<string, boolean>
  connected: boolean
  modCount: number
  onSelect: (id: string) => void
  onNew: () => void
  onOpenMods: () => void
  onCollapse: () => void
}

const DAY = 24 * 60 * 60 * 1000

function bucket(ts: number, now: number): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (ts >= startOfToday) return 'Today'
  if (ts >= startOfToday - DAY) return 'Yesterday'
  if (ts >= startOfToday - 7 * DAY) return 'Previous 7 days'
  if (ts >= startOfToday - 30 * DAY) return 'Previous 30 days'
  return 'Older'
}

function relative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}d` : new Date(ts).toLocaleDateString()
}

export function Sidebar({ sessions, activeID, busy, connected, modCount, onSelect, onNew, onOpenMods, onCollapse }: Props) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const now = Date.now()
    const q = query.trim().toLowerCase()
    const sorted = sessions
      .filter((s) => !s.parentID) // sub-agent sessions stay out of the main list
      .filter((s) => !q || displayTitle(s.title).toLowerCase().includes(q))
      .sort((a, b) => b.time.updated - a.time.updated)
    const map = new Map<string, Session[]>()
    for (const s of sorted) {
      const key = bucket(s.time.updated, now)
      map.set(key, [...(map.get(key) ?? []), s])
    }
    return { now, entries: [...map.entries()] }
  }, [sessions, query])

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <div className="brand">
          <LogoMark size={22} />
          <span>Radeon Harness</span>
        </div>
        <button type="button" className="icon-btn" onClick={onCollapse} aria-label="Hide sidebar" title="Hide sidebar (Ctrl+B)">
          <SidebarIcon size={17} />
        </button>
      </div>

      <div className="sidebar-actions">
        <button type="button" className="new-thread" onClick={onNew}>
          <PlusIcon size={15} />
          <span>New thread</span>
          <kbd>Ctrl N</kbd>
        </button>
        <label className="sidebar-search">
          <SearchIcon size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search threads" />
        </label>
      </div>

      <nav className="thread-list">
        {groups.entries.length === 0 && (
          <div className="thread-empty">{query ? 'No matching threads' : 'No threads yet'}</div>
        )}
        {groups.entries.map(([label, list]) => (
          <div key={label} className="thread-group">
            <div className="thread-group-label">{label}</div>
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                className={s.id === activeID ? 'thread active' : 'thread'}
                onClick={() => onSelect(s.id)}
              >
                {busy[s.id] && <span className="thread-busy" aria-label="running" />}
                <span className="thread-title">{displayTitle(s.title)}</span>
                <span className="thread-time">{relative(s.time.updated, groups.now)}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="footer-status">
          <span className={connected ? 'status-dot ok' : 'status-dot'} />
          <span>{connected ? 'Connected' : 'Connecting…'}</span>
        </span>
        <button type="button" className="mods-btn" onClick={onOpenMods}>
          <PuzzleIcon size={13} />
          Mods{modCount > 0 && ` · ${modCount}`}
        </button>
      </div>
    </aside>
  )
}
