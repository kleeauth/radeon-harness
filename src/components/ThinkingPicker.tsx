import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloating } from '../lib/floating'
import { BrainIcon, CheckIcon, ChevronDownIcon } from './Icons'

type Props = {
  variants: string[] // the levels this model offers, from opencode
  value: string | null // null: the model's default
  onChange: (variant: string | null) => void
}

const LABELS: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

const HINTS: Record<string, string> = {
  minimal: 'Fastest, barely thinks',
  low: 'Quick answers',
  medium: 'Balanced',
  high: 'Thinks longer on hard problems',
  xhigh: 'Very thorough, slower',
  max: 'Deepest thinking, slowest and most tokens',
}

const label = (v: string) => LABELS[v] ?? v.charAt(0).toUpperCase() + v.slice(1)

export function ThinkingPicker({ variants, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const floating = useFloating(rootRef, open, { width: 280, maxHeight: 360 })

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

  const options: Array<string | null> = [null, ...variants]

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className={value ? 'chip thinking on' : 'chip thinking'}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Thinking level: how long the model reasons before answering"
      >
        <BrainIcon size={13} />
        <span className="chip-label">{value ? label(value) : 'Thinking'}</span>
        <ChevronDownIcon size={14} />
      </button>

      {open && floating && createPortal(
        <div className="popover thinking-popover floating" role="listbox" ref={popRef} style={floating}>
          <div className="popover-group">Thinking level</div>
          <div className="popover-list">
            {options.map((v) => {
              const selected = v === value
              return (
                <button
                  key={v ?? 'default'}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? 'popover-item selected' : 'popover-item'}
                  onClick={() => {
                    onChange(v)
                    setOpen(false)
                  }}
                >
                  <span className="popover-item-name">{v ? label(v) : 'Default'}</span>
                  <span className="popover-item-id">{v ? (HINTS[v] ?? v) : "The model's own setting"}</span>
                  {selected && <CheckIcon size={14} />}
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
