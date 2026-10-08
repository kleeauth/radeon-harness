import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  appToken,
  displayTitle,
  fetchProviders,
  pickDefaultModel,
  type ModelRef,
  type ProviderOption,
} from './lib/opencode'
import { useChat } from './lib/useChat'
import { useCommands, type Builtin } from './lib/useCommands'
import { INTELLIGENT_UI_PROMPT } from './lib/intelligentUi'
import { mods, useMods } from './mods/runtime'
import { Sidebar } from './components/Sidebar'
import { Composer } from './components/Composer'
import { Conversation } from './components/Conversation'
import { ModBands, ModStatusLine, ModToasts, ModsPanel } from './components/ModChrome'
import { AlertIcon, ComposeIcon, LogoMark, SidebarIcon, XIcon } from './components/Icons'
import './App.css'

const MODEL_KEY = 'radeon-harness.model'
const INTELLIGENT_KEY = 'radeon-harness.intelligent-ui'
const SIDEBAR_KEY = 'radeon-harness.sidebar-open'
const NARROW_QUERY = '(max-width: 760px)'

function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked: preference lasts for this session only
  }
}

const SUGGESTIONS = [
  'Explain the structure of this project',
  'Build me a mortgage calculator',
  'Compare React, Vue and Svelte',
  'Find and fix a bug in the code',
]

export default function App() {
  const chat = useChat()
  const { state, connected } = chat
  const modSnapshot = useMods()

  const [activeID, setActiveID] = useState<string | null>(null)
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [model, setModel] = useState<ModelRef | null>(() => readPref<ModelRef | null>(MODEL_KEY, null))
  const [intelligent, setIntelligent] = useState(() => readPref(INTELLIGENT_KEY, true))
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [modsOpen, setModsOpen] = useState(false)

  // wide windows: a docked sidebar that remembers its state; narrow ones: a slide-over drawer
  const [sidebarOpen, setSidebarOpen] = useState(() => readPref(SIDEBAR_KEY, true))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)
  const showSidebar = narrow ? drawerOpen : sidebarOpen

  useEffect(() => writePref(SIDEBAR_KEY, sidebarOpen), [sidebarOpen])

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const onChange = () => {
      setNarrow(mq.matches)
      setDrawerOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia(NARROW_QUERY).matches) setDrawerOpen((o) => !o)
    else setSidebarOpen((o) => !o)
  }, [])

  // mods read the active thread through this ref, so it never goes stale
  const activeRef = useRef<string | null>(null)
  activeRef.current = activeID

  useEffect(() => {
    mods.activeSession = () => activeRef.current
    void mods.load(appToken)
    chat.loadThreads().catch((e) => setError(`Couldn't load threads: ${e}`))
    fetchProviders()
      .then((catalog) => {
        setProviders(catalog.providers)
        setModel((current) => {
          const valid =
            current &&
            catalog.providers.some((p) => p.id === current.providerID && p.models.some((m) => m.id === current.modelID))
          return valid ? current : pickDefaultModel(catalog)
        })
      })
      .catch((e) => setError(`Couldn't load models: ${e}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (model) writePref(MODEL_KEY, model)
  }, [model])

  useEffect(() => writePref(INTELLIGENT_KEY, intelligent), [intelligent])

  const newThread = useCallback(() => {
    setActiveID(null)
    setDraft('')
    setError(null)
    setDrawerOpen(false)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'n') {
        e.preventDefault()
        newThread()
      } else if (key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newThread, toggleSidebar])

  const builtins = useMemo<Builtin[]>(
    () => [
      { name: 'new', description: 'Start a new thread', run: () => newThread() },
      { name: 'mods', description: 'Manage mods', run: () => setModsOpen(true) },
      { name: 'ui', description: 'Toggle Intelligent UI widgets', run: () => setIntelligent((v) => !v) },
    ],
    [newThread],
  )
  const commands = useCommands(builtins)

  const selectThread = async (id: string) => {
    setActiveID(id)
    setError(null)
    setDrawerOpen(false)
    mods.emit('session.start', { sessionID: id })
    try {
      await chat.loadSession(id)
    } catch (e) {
      setError(`Couldn't load that thread: ${e}`)
    }
  }

  const ensureThread = async () => {
    if (activeID) return activeID
    const id = (await chat.createThread()).id
    setActiveID(id)
    mods.emit('session.start', { sessionID: id })
    return id
  }

  // a plain prompt: mods may rewrite or swallow it first
  const sendPrompt = async (text: string) => {
    const id = await ensureThread()
    const result = await mods.dispatch('prompt.submit', { sessionID: id, text })
    if (!result) return
    await chat.send(id, result.text, model, intelligent ? INTELLIGENT_UI_PROMPT : undefined)
  }

  const submit = async (override?: string) => {
    const text = (override ?? draft).trim()
    if (!text) return
    setDraft('')
    setError(null)
    try {
      const cmd = commands.parse(text)
      if (cmd?.kind === 'builtin') return cmd.builtin.run(cmd.args)
      if (cmd?.kind === 'mod') {
        const out = await mods.runCommand(cmd.name, cmd.args)
        if (out?.text) mods.toast(cmd.name, out.text)
        if (out?.prompt) await sendPrompt(out.prompt)
        return
      }
      if (cmd?.kind === 'opencode') {
        const id = await ensureThread()
        return await chat.runCommand(id, cmd.name, cmd.args, model)
      }
      await sendPrompt(text)
    } catch (e) {
      setDraft(text)
      setError(`Send failed: ${e}`)
    }
  }

  const messages = useMemo(() => {
    if (!activeID) return []
    const s = state.sessions[activeID]
    return s ? s.order.map((id) => s.messages[id]).filter(Boolean) : []
  }, [state.sessions, activeID])

  const busy = activeID ? !!state.busy[activeID] : false
  const pending = state.permissions.filter((p) => p.sessionID === activeID)
  const thread = activeID ? state.threads[activeID] : undefined

  const composer = (
    <>
      <ModBands />
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={() => submit()}
        onStop={() => activeID && chat.abort(activeID)}
        busy={busy}
        providers={providers}
        model={model}
        onModelChange={setModel}
        commands={commands.list}
        intelligent={intelligent}
        onToggleIntelligent={() => setIntelligent((v) => !v)}
      />
      <ModStatusLine />
    </>
  )

  return (
    <div className={['app', showSidebar ? 'sidebar-open' : 'sidebar-collapsed', narrow ? 'narrow' : ''].join(' ')}>
      {narrow && drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />}
      <Sidebar
        sessions={Object.values(state.threads)}
        activeID={activeID}
        busy={state.busy}
        connected={connected}
        modCount={modSnapshot.mods.filter((m) => m.enabled).length}
        onSelect={selectThread}
        onNew={newThread}
        onOpenMods={() => setModsOpen(true)}
        onCollapse={toggleSidebar}
      />

      <main className="main">
        <header className="topbar drag">
          {!showSidebar && (
            <div className="topbar-actions">
              <button type="button" className="icon-btn" onClick={toggleSidebar} aria-label="Show sidebar" title="Show sidebar (Ctrl+B)">
                <SidebarIcon size={17} />
              </button>
              <button type="button" className="icon-btn" onClick={newThread} aria-label="New thread" title="New thread (Ctrl+N)">
                <ComposeIcon size={16} />
              </button>
            </div>
          )}
          <div className="topbar-title">
            {thread ? displayTitle(thread.title) : activeID ? 'Loading…' : 'New thread'}
            {busy && (
              <span className="working-pill">
                <span className="spinner" />
                Working
              </span>
            )}
          </div>
        </header>

        {!activeID ? (
          <section className="hero">
            <LogoMark size={44} />
            <h1>What should we build?</h1>
            <p className="hero-sub">Radeon Harness runs opencode on your machine. Type / for commands.</p>
            <div className="hero-composer">{composer}</div>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="suggestion" onClick={() => setDraft(s)}>
                  {s}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <>
            <Conversation messages={messages} busy={busy} onRetry={(text) => submit(text)} />
            <div className="dock">
              {pending.map((p) => (
                <div key={p.id} className="permission-card">
                  <div className="permission-text">
                    <AlertIcon size={16} />
                    <div>
                      <div className="permission-title">Permission needed</div>
                      <div className="permission-detail">{p.title}</div>
                    </div>
                  </div>
                  <div className="permission-actions">
                    <button type="button" className="btn ghost" onClick={() => chat.respondPermission(p.sessionID, p.id, 'reject')}>
                      Deny
                    </button>
                    <button type="button" className="btn ghost" onClick={() => chat.respondPermission(p.sessionID, p.id, 'always')}>
                      Always allow
                    </button>
                    <button type="button" className="btn primary" onClick={() => chat.respondPermission(p.sessionID, p.id, 'once')}>
                      Allow once
                    </button>
                  </div>
                </div>
              ))}
              {composer}
            </div>
          </>
        )}

        {error && (
          <div className="toast" role="alert">
            <AlertIcon size={15} />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              <XIcon size={14} />
            </button>
          </div>
        )}
        <ModToasts />
      </main>

      {modsOpen && <ModsPanel onClose={() => setModsOpen(false)} />}
    </div>
  )
}
