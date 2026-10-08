import { useState } from 'react'
import type { PendingQuestion } from '../lib/chatState'

type Props = {
  question: PendingQuestion
  onAnswer: (answers: string[][]) => Promise<void>
  onDismiss: () => Promise<void>
}

// The agent is waiting on these answers; its turn stays blocked until one is sent or skipped.
export function QuestionCard({ question, onAnswer, onDismiss }: Props) {
  const [picked, setPicked] = useState<string[][]>(() => question.questions.map(() => []))
  const [sending, setSending] = useState(false)
  const single = question.questions.length === 1

  const send = async (answers: string[][]) => {
    setSending(true)
    try {
      await onAnswer(answers)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="question-card">
      {question.questions.map((q, qi) => (
        <div key={qi} className="question-block">
          {q.header && <div className="question-header">{q.header}</div>}
          <div className="question-text">{q.question}</div>
          <div className="question-options">
            {q.options.map((o) => {
              const on = picked[qi]?.includes(o.label)
              return (
                <button
                  key={o.label}
                  type="button"
                  className={on ? 'question-option on' : 'question-option'}
                  title={o.description}
                  disabled={sending}
                  onClick={() => {
                    // one question: a click answers it; several: pick one per question, then Send
                    if (single) return void send([[o.label]])
                    setPicked((p) => p.map((sel, i) => (i === qi ? [o.label] : sel)))
                  }}
                >
                  <span className="question-option-label">{o.label}</span>
                  {o.description && <span className="question-option-desc">{o.description}</span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="question-actions">
        <button type="button" className="btn ghost" disabled={sending} onClick={() => void onDismiss()}>
          Skip
        </button>
        {!single && (
          <button
            type="button"
            className="btn primary"
            disabled={sending || picked.some((p) => p.length === 0)}
            onClick={() => void send(picked)}
          >
            Send answers
          </button>
        )}
      </div>
    </div>
  )
}
