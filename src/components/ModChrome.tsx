import { useEffect, useState } from 'react'
import { mods, useMods } from '../mods/runtime'
import { PuzzleIcon, RetryIcon, XIcon } from './Icons'

// Bands sit directly above the composer, like Claude Code's AbovePrompt slot.
export function ModBands() {
  const { bands } = useMods()
  if (!bands.length) return null
  return (
    <div className="mod-bands">
      {bands.map(({ mod, spec }) => (
        <div key={mod} className={`mod-band ${spec.tone ?? 'info'}`}>
          <span className="mod-band-dot" />
          <span>{spec.text}</span>
        </div>
      ))}
    </div>
  )
}

// One thin line under the composer, every mod's entry separated by a dot.
export function ModStatusLine() {
  const { statuses } = useMods()
  if (!statuses.length) return null
  return (
    <div className="mod-status">
      {statuses.map(({ mod, text }) => (
        <span key={mod} title={mod}>{text}</span>
      ))}
    </div>
  )
}

export function ModToasts() {
  const { toasts } = useMods()
  return (
    <div className="mod-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="mod-toast">
          <PuzzleIcon size={13} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

export function ModsPanel({ onClose }: { onClose: () => void }) {
  const { mods: list, commands } = useMods()
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const reload = async () => {
    setReloading(true)
    await mods.reload()
    setReloading(false)
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mods-panel" role="dialog" aria-label="Mods">
        <header className="mods-head">
          <div className="mods-title">
            <PuzzleIcon size={16} />
            <span>Mods</span>
            <span className="mods-count">{list.filter((m) => m.enabled).length} active</span>
          </div>
          <div className="mods-head-actions">
            <button type="button" className="btn ghost" onClick={reload} disabled={reloading}>
              <RetryIcon size={13} /> {reloading ? 'Reloading' : 'Reload'}
            </button>
            {window.opencodeApp?.openModsFolder && (
              <button type="button" className="btn ghost" onClick={() => window.opencodeApp?.openModsFolder()}>
                Open folder
              </button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <XIcon size={15} />
            </button>
          </div>
        </header>

        <div className="mods-list">
          {list.length === 0 && (
            <div className="mods-empty">No mods found. Add a folder with mod.js to your mods folder, then Reload.</div>
          )}
          {list.map((m) => {
            const cmds = commands.filter((c) => c.mod === m.info.name)
            return (
              <div key={`${m.info.source}/${m.info.name}`} className="mod-row">
                <div className="mod-main">
                  <div className="mod-name">
                    {m.info.name}
                    <span className="mod-badge">{m.info.source}</span>
                    <span className="mod-version">v{m.info.version}</span>
                  </div>
                  {m.info.description && <div className="mod-desc">{m.info.description}</div>}
                  {cmds.length > 0 && (
                    <div className="mod-cmds">
                      {cmds.map((c) => (
                        <code key={c.spec.name}>/{c.spec.name}</code>
                      ))}
                    </div>
                  )}
                  {m.error && <div className="mod-error">{m.error}</div>}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={m.enabled}
                  className={m.enabled ? 'switch on' : 'switch'}
                  onClick={() => mods.setEnabled(m.info.name, !m.enabled)}
                  aria-label={`Toggle ${m.info.name}`}
                >
                  <span />
                </button>
              </div>
            )
          })}
        </div>

        <footer className="mods-foot">
          A mod is a folder with <code>mod.js</code> exporting <code>register(on, $)</code>. Hooks: <code>prompt.submit</code>,{' '}
          <code>turn.start</code>, <code>turn.end</code>, <code>tool.result</code>, <code>message.complete</code>,{' '}
          <code>session.start</code>. UI: <code>$.ui.status</code>, <code>$.ui.toast</code>, <code>$.ui.band</code>,{' '}
          <code>$.command.register</code>.
        </footer>
      </div>
    </div>
  )
}
