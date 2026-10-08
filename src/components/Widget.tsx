import { useCallback, useEffect, useRef, useState } from 'react'
import { widgetOrigin } from '../lib/opencode'
import { allowAlways, hostOf, isAlwaysAllowed, liveFetch, type LiveResult } from '../lib/liveData'
import { GlobeIcon, SparkleIcon } from './Icons'

const MAX_HEIGHT = 720

type Pending = { id: number; url: string }

// Renders model-written HTML in a sandboxed iframe on a separate, network-less origin.
// sandbox without allow-same-origin: the widget can't touch the app, its storage, or the token.
// Its only way out is harness.fetch, brokered here with a per-site permission prompt.
export function Widget({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)
  const [showCode, setShowCode] = useState(false)

  const allowed = useRef(new Set<string>())
  const denied = useRef(new Set<string>())
  const queue = useRef(new Map<string, Pending[]>())
  const [asking, setAsking] = useState<string[]>([])
  const [sources, setSources] = useState<string[]>([])

  const reply = useCallback((id: number, result: LiveResult) => {
    frameRef.current?.contentWindow?.postMessage({ type: 'widget-fetch-result', id, result }, '*')
  }, [])

  const run = useCallback(
    async (host: string, { id, url }: Pending) => {
      setSources((s) => (s.includes(host) ? s : [...s, host]))
      reply(id, await liveFetch(url))
    },
    [reply],
  )

  const syncAsking = () => setAsking([...queue.current.keys()])

  const decide = (host: string, decision: 'once' | 'always' | 'block') => {
    const waiting = queue.current.get(host) ?? []
    queue.current.delete(host)
    syncAsking()
    if (decision === 'block') {
      denied.current.add(host)
      waiting.forEach((p) => reply(p.id, { ok: false, status: 0, error: `access to ${host} was blocked` }))
      return
    }
    if (decision === 'always') allowAlways(host)
    allowed.current.add(host)
    waiting.forEach((p) => run(host, p))
  }

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return
      const data = e.data as { type?: string; h?: number; id?: number; url?: string }
      if (data.type === 'widget-ready') {
        frameRef.current?.contentWindow?.postMessage({ type: 'widget-render', html }, '*')
      } else if (data.type === 'widget-height' && typeof data.h === 'number') {
        setHeight(Math.min(Math.max(data.h, 40), MAX_HEIGHT))
      } else if (data.type === 'widget-fetch' && typeof data.id === 'number' && typeof data.url === 'string') {
        const request = { id: data.id, url: data.url }
        const host = hostOf(data.url)
        if (!host) return reply(request.id, { ok: false, status: 0, error: 'only https URLs are allowed' })
        if (denied.current.has(host)) {
          return reply(request.id, { ok: false, status: 0, error: `access to ${host} was blocked` })
        }
        if (allowed.current.has(host) || isAlwaysAllowed(host)) return void run(host, request)
        queue.current.set(host, [...(queue.current.get(host) ?? []), request])
        syncAsking()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [html, reply, run])

  if (!widgetOrigin) {
    // dev in a plain browser tab: no widget host, show the source instead
    return (
      <div className="widget">
        <div className="widget-head">
          <span><SparkleIcon size={13} /> Widget</span>
          <span className="widget-note">Open in the app to run widgets</span>
        </div>
        <pre className="widget-code">{html}</pre>
      </div>
    )
  }

  return (
    <div className="widget seamless">
      <div className="widget-tools">
        {sources.length > 0 && (
          <span className="widget-live" title={sources.join(', ')}>
            <span className="live-dot" /> Live · {sources.length === 1 ? sources[0] : `${sources.length} sources`}
          </span>
        )}
        <button type="button" onClick={() => setShowCode((s) => !s)}>{showCode ? 'Hide code' : 'Code'}</button>
      </div>

      {asking.map((host) => (
        <div key={host} className="widget-ask">
          <GlobeIcon size={15} />
          <span className="widget-ask-text">
            This widget wants live data from <strong>{host}</strong>
          </span>
          <span className="widget-ask-actions">
            <button type="button" className="btn ghost" onClick={() => decide(host, 'block')}>Block</button>
            <button type="button" className="btn ghost" onClick={() => decide(host, 'always')}>Always allow</button>
            <button type="button" className="btn primary" onClick={() => decide(host, 'once')}>Allow</button>
          </span>
        </div>
      ))}

      <iframe
        ref={frameRef}
        className="widget-frame"
        title="Interactive widget"
        src={`${widgetOrigin}/frame.html`}
        sandbox="allow-scripts"
        style={{ height }}
      />
      {showCode && <pre className="widget-code">{html}</pre>}
    </div>
  )
}

export function WidgetPending() {
  return (
    <div className="widget pending">
      <div className="widget-building">
        <span className="spinner" />
        <span className="shimmer">Building interactive view</span>
      </div>
    </div>
  )
}
