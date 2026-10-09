import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloating } from '../lib/floating'
import { CheckIcon, LinkIcon, SearchIcon } from './Icons'

export type ContextOption = { id: string; title: string; open: boolean }

type Props = {
  options: ContextOption[] // other chats; `open` = shown in a pane right now
  selected: string[]
  onToggle: (sessionID: string) => void
}

// Pick other chats whose conversation goes along with the next message.
export function ContextPicker({ options, selected, onToggle }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const floating = useFloating(rootRef, open, { width: 320, maxHeight: 380 })

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!rootRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = options.filter((o) => !q || o.title.toLowerCase().includes(q))
    return [
      { label: 'Open in split view', items: match.filter((o) => o.open) },
      { label: 'Other chats', items: match.filter((o) => !o.open).slice(0, 40) },
    ].filter((g) => g.items.length)
  }, [options, query])

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className={selected.length ? 'chip context-chip on' : 'chip context-chip'}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Share another chat's conversation with this one (or drag a chat onto the composer)"
      >
        <LinkIcon size={13} />
        <span className="chip-label">{selected.length ? `Context · ${selected.length}` : 'Context'}</span>
      </button>

      {open &&
        floating &&
        createPortal(
          <div className="popover floating" role="listbox" ref={popRef} style={floating}>
            <div className="popover-search">
              <SearchIcon size={14} />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" />
            </div>
            <div className="popover-list">
              {groups.length === 0 && <div className="popover-empty">No other chats yet</div>}
              {groups.map((g) => (
                <div key={g.label}>
                  <div className="popover-group">{g.label}</div>
                  {g.items.map((o) => {
                    const on = selected.includes(o.id)
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="option"
                        aria-selected={on}
                        className={on ? 'popover-item selected' : 'popover-item'}
                        onClick={() => onToggle(o.id)}
                      >
                        <span className="popover-item-name">{o.title}</span>
                        <span className="popover-item-id">{on ? 'Shared with the next message' : 'Click to share'}</span>
                        {on && <CheckIcon size={14} />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
