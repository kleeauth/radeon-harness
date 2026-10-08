import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelRef, ProviderOption } from '../lib/opencode'
import { ArrowUpIcon, SparkleIcon, StopIcon } from './Icons'
import { ModelPicker } from './ModelPicker'

export type SlashCommand = { name: string; description: string; source: string }

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onStop: () => void
  busy: boolean
  providers: ProviderOption[]
  model: ModelRef | null
  onModelChange: (m: ModelRef) => void
  commands: SlashCommand[]
  intelligent: boolean
  onToggleIntelligent: () => void
  placeholder?: string
}

export function Composer(props: Props) {
  const { value, onChange, onSubmit, onStop, busy, providers, model, onModelChange, commands, intelligent, onToggleIntelligent } = props
  const ref = useRef<HTMLTextAreaElement>(null)
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  // grow with content up to a cap, then scroll
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }, [value])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  // the menu shows while typing the command name: "/" followed by no whitespace yet
  const slashQuery = /^\/(\S*)$/.exec(value)?.[1]
  const matches = useMemo(() => {
    if (slashQuery === undefined) return []
    const q = slashQuery.toLowerCase()
    return commands.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 8)
  }, [commands, slashQuery])
  const menuOpen = matches.length > 0 && !dismissed

  useEffect(() => {
    setSelected(0)
    if (slashQuery === undefined) setDismissed(false)
  }, [slashQuery])

  const complete = (name: string) => {
    onChange(`/${name} `)
    ref.current?.focus()
  }

  const canSend = value.trim().length > 0 && !busy

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSend) onSubmit()
      }}
    >
      {menuOpen && (
        <div className="slash-menu" role="listbox">
          {matches.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'slash-item active' : 'slash-item'}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                complete(c.name)
              }}
            >
              <span className="slash-name">/{c.name}</span>
              <span className="slash-desc">{c.description}</span>
              <span className="slash-source">{c.source}</span>
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        value={value}
        rows={1}
        placeholder={props.placeholder ?? 'Ask anything, or type / for commands'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (menuOpen) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const d = e.key === 'ArrowDown' ? 1 : -1
              setSelected((s) => (s + d + matches.length) % matches.length)
              return
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
              e.preventDefault()
              complete(matches[selected].name)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setDismissed(true)
              return
            }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (canSend) onSubmit()
          }
        }}
      />
      <div className="composer-bar">
        <ModelPicker providers={providers} value={model} onChange={onModelChange} />
        <button
          type="button"
          className={intelligent ? 'chip toggle on' : 'chip toggle'}
          onClick={onToggleIntelligent}
          aria-pressed={intelligent}
          title="Let the model answer with interactive widgets when they help"
        >
          <SparkleIcon size={13} />
          <span className="chip-label">Intelligent UI</span>
        </button>
        <span className="composer-hint">/ for commands</span>
        {busy ? (
          <button type="button" className="send-btn stop" onClick={onStop} aria-label="Stop">
            <StopIcon size={14} />
          </button>
        ) : (
          <button type="submit" className="send-btn" disabled={!canSend} aria-label="Send">
            <ArrowUpIcon size={16} />
          </button>
        )}
      </div>
    </form>
  )
}
