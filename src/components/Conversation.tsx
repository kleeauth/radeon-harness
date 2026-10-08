import { useEffect, useRef, useState } from 'react'
import type { MessageView } from '../lib/chatState'
import { Markdown, PartView } from './MessageParts'
import type { AssistantMessage, FilePart } from '@opencode-ai/sdk'
import { AlertIcon, ArrowDownIcon, CheckIcon, CopyIcon, RetryIcon } from './Icons'

type Props = {
  messages: MessageView[]
  busy: boolean
  onRetry: (text: string) => void
}

function textOf(m: MessageView) {
  return m.parts
    .filter((p) => p.type === 'text' && !p.synthetic && !p.ignored)
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n\n')
}

// A failed turn (bad key, no balance, provider down, aborted) is recorded on the assistant message.
function errorOf(m: MessageView): { title: string; detail: string } | null {
  if (m.info.role !== 'assistant') return null
  const err = (m.info as AssistantMessage).error as
    | { name?: string; data?: { message?: string; statusCode?: number; providerID?: string } }
    | undefined
  if (!err) return null
  if (err.name === 'MessageAbortedError') return { title: 'Stopped', detail: 'This reply was stopped before it finished.' }
  const status = err.data?.statusCode
  const title =
    err.name === 'ProviderAuthError' || status === 401 || status === 403
      ? "The provider refused the request"
      : status === 402 || status === 429
        ? 'Out of credits or rate-limited'
        : 'The model request failed'
  return { title, detail: err.data?.message || err.name || 'Unknown error' }
}

function Actions({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="msg-actions">
      <button
        type="button"
        aria-label="Copy"
        title="Copy"
        onClick={() =>
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      </button>
      {onRetry && (
        <button type="button" aria-label="Retry" title="Ask again" onClick={onRetry}>
          <RetryIcon size={14} />
        </button>
      )}
    </div>
  )
}

export function Conversation({ messages, busy, onRetry }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [viewing, setViewing] = useState<string | null>(null)

  useEffect(() => {
    if (!viewing) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setViewing(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing])
  const last = messages[messages.length - 1]
  const lastHasText = last?.info.role === 'assistant' && last.parts.some((p) => p.type === 'text' && p.text)

  // follow new output only while the reader is already at the bottom
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottom) el.scrollTop = el.scrollHeight
  }, [messages, busy, atBottom])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  const jump = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <>
      <div className="conversation" ref={scrollRef} onScroll={onScroll}>
        <div className="conversation-inner">
          {messages.map((m, i) => {
            if (m.info.role === 'user') {
              const pictures = m.parts.filter(
                (p): p is FilePart => p.type === 'file' && p.mime.startsWith('image/') && !!p.url,
              )
              const hasText = m.parts.some((p) => p.type === 'text' && !p.synthetic && p.text)
              return (
                <div key={m.info.id} className="msg-user">
                  {pictures.length > 0 && (
                    <div className="msg-images">
                      {pictures.map((p) => (
                        <img key={p.id} src={p.url} alt={p.filename ?? 'image'} onClick={() => setViewing(p.url)} />
                      ))}
                    </div>
                  )}
                  {hasText && (
                    <div className="bubble">
                      {m.parts.map((p) =>
                        p.type === 'text' && !p.synthetic ? <Markdown key={p.id} text={p.text} /> : null,
                      )}
                    </div>
                  )}
                </div>
              )
            }
            const live = busy && m === last
            const text = textOf(m)
            const failure = errorOf(m)
            // retry re-asks the user message this answer replied to
            const prompt = [...messages.slice(0, i)].reverse().find((x) => x.info.role === 'user')
            const retry = prompt && !busy ? () => onRetry(textOf(prompt)) : undefined
            return (
              <div key={m.info.id} className="msg-assistant">
                {m.parts.map((p) => (
                  <PartView key={p.id} part={p} live={live} />
                ))}
                {failure && (
                  <div className="msg-error" role="alert">
                    <AlertIcon size={15} />
                    <div className="msg-error-body">
                      <div className="msg-error-title">{failure.title}</div>
                      <div className="msg-error-detail">{failure.detail}</div>
                    </div>
                    {retry && (
                      <button type="button" className="btn ghost" onClick={retry}>
                        Try again
                      </button>
                    )}
                  </div>
                )}
                {!live && text && <Actions text={text} onRetry={retry} />}
              </div>
            )
          })}
          {busy && !lastHasText && (
            <div className="thinking-row">
              <span className="spinner" />
              <span className="shimmer">Working</span>
            </div>
          )}
        </div>
      </div>
      {viewing && (
        <div className="scrim" onClick={() => setViewing(null)}>
          <img className="image-viewer" src={viewing} alt="" />
        </div>
      )}
      {!atBottom && (
        <button type="button" className="jump-latest" onClick={jump} aria-label="Jump to latest">
          <ArrowDownIcon size={16} />
        </button>
      )}
    </>
  )
}
