import { useEffect, useRef, useState } from 'react'
import type { MessageView } from '../lib/chatState'
import { Markdown, PartView } from './MessageParts'
import { ArrowDownIcon, CheckIcon, CopyIcon, RetryIcon } from './Icons'

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
              return (
                <div key={m.info.id} className="msg-user">
                  <div className="bubble">
                    {m.parts.map((p) =>
                      p.type === 'text' && !p.synthetic ? <Markdown key={p.id} text={p.text} /> : null,
                    )}
                  </div>
                </div>
              )
            }
            const live = busy && m === last
            const text = textOf(m)
            // retry re-asks the user message this answer replied to
            const prompt = [...messages.slice(0, i)].reverse().find((x) => x.info.role === 'user')
            return (
              <div key={m.info.id} className="msg-assistant">
                {m.parts.map((p) => (
                  <PartView key={p.id} part={p} live={live} />
                ))}
                {!live && text && (
                  <Actions text={text} onRetry={prompt && !busy ? () => onRetry(textOf(prompt)) : undefined} />
                )}
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
      {!atBottom && (
        <button type="button" className="jump-latest" onClick={jump} aria-label="Jump to latest">
          <ArrowDownIcon size={16} />
        </button>
      )}
    </>
  )
}
