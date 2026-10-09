import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloating } from '../lib/floating'
import type { ModelRef, ProviderOption } from '../lib/opencode'
import { CheckIcon, ChevronDownIcon, SearchIcon } from './Icons'

type Props = {
  providers: ProviderOption[]
  value: ModelRef | null
  onChange: (model: ModelRef) => void
}

const MAX_RESULTS = 150

export function ModelPicker({ providers, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const floating = useFloating(rootRef, open, { width: 360, maxHeight: 420 })
  const inputRef = useRef<HTMLInputElement>(null)

  const currentName = useMemo(() => {
    if (!value) return 'Select model'
    const p = providers.find((x) => x.id === value.providerID)
    return p?.models.find((m) => m.id === value.modelID)?.name ?? value.modelID
  }, [providers, value])

  // filter across provider name, model name and id; cap the list so huge catalogs stay fast
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    let budget = MAX_RESULTS
    const out: ProviderOption[] = []
    for (const p of providers) {
      if (budget <= 0) break
      const models = p.models.filter(
        (m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
      )
      if (models.length) {
        const slice = models.slice(0, budget)
        budget -= slice.length
        out.push({ ...p, models: slice })
      }
    }
    return out
  }, [providers, query])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
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

  return (
    <div className="model-picker" ref={rootRef}>
      <button type="button" className="chip" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="chip-label">{currentName}</span>
        <ChevronDownIcon size={14} />
      </button>

      {open && floating && createPortal(
        <div className="popover floating" role="listbox" ref={popRef} style={floating}>
          <div className="popover-search">
            <SearchIcon size={14} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models"
            />
          </div>
          <div className="popover-list">
            {groups.length === 0 && <div className="popover-empty">No models match</div>}
            {groups.map((p) => (
              <div key={p.id}>
                <div className="popover-group">{p.name}</div>
                {p.models.map((m) => {
                  const selected = value?.providerID === p.id && value?.modelID === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={selected ? 'popover-item selected' : 'popover-item'}
                      onClick={() => {
                        onChange({ providerID: p.id, modelID: m.id })
                        setOpen(false)
                        setQuery('')
                      }}
                    >
                      <span className="popover-item-name">{m.name}</span>
                      <span className="popover-item-id">{m.id}</span>
                      {selected && <CheckIcon size={14} />}
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
