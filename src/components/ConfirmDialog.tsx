import { useEffect, useState, type ReactNode } from 'react'

type Props = {
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => Promise<void>
  onCancel: () => void
}

// Destructive actions go through here: Cancel has focus, Escape cancels, nothing happens without a click.
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel }: Props) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, running])

  const confirm = async () => {
    setRunning(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(String(e))
      setRunning(false)
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && !running && onCancel()}>
      <div className="confirm-dialog" role="alertdialog" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <div className="confirm-body">{children}</div>
        {error && <div className="mod-error">{error}</div>}
        <div className="confirm-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={running} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={confirm} disabled={running}>
            {running ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
