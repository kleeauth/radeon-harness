import type { ReactNode } from 'react'
import type { MessageView, PendingPermission, PendingQuestion } from '../lib/chatState'
import { Conversation } from './Conversation'
import { QuestionCard } from './QuestionCard'
import { AlertIcon, LogoMark, XIcon } from './Icons'

type Props = {
  sessionID: string | null
  title: string
  focused: boolean
  split: boolean
  messages: MessageView[]
  busy: boolean
  permissions: PendingPermission[]
  questions: PendingQuestion[]
  error: string | null
  composer: ReactNode // built by the App, so model, thinking and commands stay shared
  suggestions: string[]
  onFocus: () => void
  onClose: () => void
  onRetry: (text: string) => void
  onSuggestion: (text: string) => void
  onDismissError: () => void
  onPermission: (permissionID: string, reply: 'once' | 'always' | 'reject') => void
  onAnswer: (questionID: string, answers: string[][]) => Promise<void>
  onDismissQuestion: (questionID: string) => Promise<void>
}

// One chat: its conversation, the cards that block it, and its own composer.
export function ChatPane(p: Props) {
  return (
    <section
      className={['pane', p.focused ? 'focused' : '', p.split ? 'split' : ''].join(' ')}
      onMouseDownCapture={p.onFocus}
      onFocusCapture={p.onFocus}
    >
      {p.split && (
        <div className="pane-head">
          <span className="pane-title">{p.title}</span>
          {p.busy && (
            <span className="working-pill">
              <span className="spinner" />
              Working
            </span>
          )}
          <button type="button" className="icon-btn pane-close" onClick={p.onClose} aria-label="Close pane" title="Close pane">
            <XIcon size={13} />
          </button>
        </div>
      )}

      {!p.sessionID ? (
        <div className="hero" key="hero">
          <LogoMark size={p.split ? 36 : 44} />
          <h1>What should we build?</h1>
          <p className="hero-sub">Radeon Harness runs opencode on your machine. Type / for commands.</p>
          <div className="hero-composer">{p.composer}</div>
          <div className="suggestions">
            {p.suggestions.map((s, i) => (
              <button
                key={s}
                type="button"
                className="suggestion"
                style={{ animationDelay: `${120 + i * 50}ms` }}
                onClick={() => p.onSuggestion(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <Conversation key={p.sessionID} messages={p.messages} busy={p.busy} onRetry={p.onRetry} />
          <div className="dock">
            {p.permissions.map((perm) => (
              <div key={perm.id} className="permission-card">
                <div className="permission-text">
                  <AlertIcon size={16} />
                  <div>
                    <div className="permission-title">{perm.title}</div>
                    {perm.detail && <div className="permission-detail">{perm.detail}</div>}
                  </div>
                </div>
                <div className="permission-actions">
                  <button type="button" className="btn ghost" onClick={() => p.onPermission(perm.id, 'reject')}>
                    Deny
                  </button>
                  <button type="button" className="btn ghost" onClick={() => p.onPermission(perm.id, 'always')}>
                    Always allow
                  </button>
                  <button type="button" className="btn primary" onClick={() => p.onPermission(perm.id, 'once')}>
                    Allow once
                  </button>
                </div>
              </div>
            ))}
            {p.questions.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                onAnswer={(answers) => p.onAnswer(q.id, answers)}
                onDismiss={() => p.onDismissQuestion(q.id)}
              />
            ))}
            {p.composer}
          </div>
        </>
      )}

      {p.error && (
        <div className="toast" role="alert">
          <AlertIcon size={15} />
          <span>{p.error}</span>
          <button type="button" onClick={p.onDismissError} aria-label="Dismiss">
            <XIcon size={14} />
          </button>
        </div>
      )}
    </section>
  )
}
