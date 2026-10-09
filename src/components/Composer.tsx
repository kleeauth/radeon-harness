import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelRef, ProviderOption } from '../lib/opencode'
import { imagesFrom, MAX_IMAGES, type ImageAttachment } from '../lib/images'
import { AlertIcon, ArrowUpIcon, ImageIcon, LinkIcon, SparkleIcon, StopIcon, XIcon } from './Icons'
import { ModelPicker } from './ModelPicker'
import { ThinkingPicker } from './ThinkingPicker'
import { ContextPicker, type ContextOption } from './ContextPicker'
import { THREAD_DRAG_TYPE } from './Sidebar'

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
  images: ImageAttachment[]
  onAddImages: (files: File[]) => void
  onRemoveImage: (id: string) => void
  thinking: string | null
  contextOptions: ContextOption[]
  contexts: Array<{ id: string; title: string }> // chats shared with the next message
  onAddContext: (sessionID: string) => void
  onRemoveContext: (sessionID: string) => void
  onThinkingChange: (variant: string | null) => void
  placeholder?: string
}

export function Composer(props: Props) {
  const {
    value,
    onChange,
    onSubmit,
    onStop,
    busy,
    providers,
    model,
    onModelChange,
    commands,
    intelligent,
    onToggleIntelligent,
    images,
    onAddImages,
    onRemoveImage,
    thinking,
    onThinkingChange,
    contextOptions,
    contexts,
    onAddContext,
    onRemoveContext,
  } = props
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [dragging, setDragging] = useState<false | 'file' | 'thread'>(false)

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

  const currentModel = useMemo(() => {
    if (!model) return undefined
    return providers.find((p) => p.id === model.providerID)?.models.find((x) => x.id === model.modelID)
  }, [providers, model])
  const modelSeesImages = currentModel?.images ?? true
  const levels = currentModel?.variants ?? []

  const complete = (name: string) => {
    onChange(`/${name} `)
    ref.current?.focus()
  }

  const canSend = (value.trim().length > 0 || images.length > 0) && !busy
  const full = images.length >= MAX_IMAGES

  return (
    <form
      className={dragging ? 'composer dragging' : 'composer'}
      onSubmit={(e) => {
        e.preventDefault()
        if (canSend) onSubmit()
      }}
      onDragOver={(e) => {
        const thread = e.dataTransfer.types.includes(THREAD_DRAG_TYPE)
        if (!thread && !Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) return
        e.preventDefault()
        // a chat dropped here is shared as context, not opened in a split pane
        if (thread) e.stopPropagation()
        setDragging(thread ? 'thread' : 'file')
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const thread = e.dataTransfer.getData(THREAD_DRAG_TYPE)
        if (thread) {
          e.stopPropagation()
          return onAddContext(thread)
        }
        const files = imagesFrom(e.dataTransfer.files)
        if (files.length) onAddImages(files)
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

      {dragging && (
        <div className="drop-hint">{dragging === 'thread' ? "Drop to share this chat's context" : 'Drop images to attach'}</div>
      )}

      {contexts.length > 0 && (
        <div className="context-chips">
          {contexts.map((c) => (
            <span key={c.id} className="context-chip-item" title={`The conversation from "${c.title}" goes along with your next message`}>
              <LinkIcon size={12} />
              <span className="context-chip-title">{c.title}</span>
              <button type="button" onClick={() => onRemoveContext(c.id)} aria-label={`Stop sharing ${c.title}`}>
                <XIcon size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="attachments">
          {images.map((img) => (
            <div key={img.id} className="attachment" title={img.name}>
              <img src={img.dataUrl} alt={img.name} />
              <button type="button" className="attachment-remove" onClick={() => onRemoveImage(img.id)} aria-label={`Remove ${img.name}`}>
                <XIcon size={11} />
              </button>
            </div>
          ))}
          {!modelSeesImages && (
            <div className="attachment-warning">
              <AlertIcon size={13} /> This model can't see images. Pick one that can, e.g. Claude or GPT.
            </div>
          )}
        </div>
      )}

      <textarea
        ref={ref}
        value={value}
        rows={1}
        placeholder={props.placeholder ?? 'Ask anything, paste an image, or type / for commands'}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const files = imagesFrom(e.clipboardData.items)
          if (!files.length) return
          // a pasted screenshot has no text worth inserting; mixed content keeps its text
          if (!e.clipboardData.getData('text/plain')) e.preventDefault()
          onAddImages(files)
        }}
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
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            const files = imagesFrom(e.target.files)
            if (files.length) onAddImages(files)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="icon-btn attach-btn"
          onClick={() => fileRef.current?.click()}
          disabled={full}
          aria-label="Attach images"
          title={full ? `Up to ${MAX_IMAGES} images per message` : 'Attach images (or paste / drop them)'}
        >
          <ImageIcon size={17} />
        </button>
        <ModelPicker providers={providers} value={model} onChange={onModelChange} />
        {levels.length > 0 && <ThinkingPicker variants={levels} value={thinking} onChange={onThinkingChange} />}
        <ContextPicker
          options={contextOptions}
          selected={contexts.map((c) => c.id)}
          onToggle={(id) => (contexts.some((c) => c.id === id) ? onRemoveContext(id) : onAddContext(id))}
        />
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
