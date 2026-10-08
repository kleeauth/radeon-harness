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
import { buildModPrompt } from './lib/modPrompt'
import { MAX_IMAGES, readImage, type ImageAttachment } from './lib/images'
import { mods, useMods } from './mods/runtime'
import { Sidebar } from './components/Sidebar'
import { Composer } from './components/Composer'
import { Conversation } from './components/Conversation'
import { ModBands, ModStatusLine, ModToasts, ModsPanel } from './components/ModChrome'
import { ConfirmDialog } from './components/ConfirmDialog'
import { QuestionCard } from './components/QuestionCard'
import { WIDGET_FIX_EVENT, type WidgetFixRequest } from './components/Widget'
import type { Session } from '@opencode-ai/sdk'
import { AlertIcon, ComposeIcon, LogoMark, SidebarIcon, XIcon } from './components/Icons'
import './App.css'

const MODEL_KEY = 'radeon-harness.model'
const INTELLIGENT_KEY = 'radeon-harness.intelligent-ui'
const SIDEBAR_KEY = 'radeon-harness.sidebar-open'
const THINKING_KEY = 'radeon-harness.thinking'
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
  const [images, setImages] = useState<ImageAttachment[]>([])
  // thinking level per model ("provider/model" -> variant), remembered across launches
  const [thinkingByModel, setThinkingByModel] = useState<Record<string, string>>(() => readPref(THINKING_KEY, {}))
  const [error, setError] = useState<string | null>(null)
  const [modsOpen, setModsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'one'; session: Session } | { kind: 'all' } | null>(null)

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
  useEffect(() => writePref(THINKING_KEY, thinkingByModel), [thinkingByModel])

  // the level only applies if this model still offers it
  const modelKey = model ? `${model.providerID}/${model.modelID}` : ''
  const modelLevels =
    providers.find((p) => p.id === model?.providerID)?.models.find((m) => m.id === model?.modelID)?.variants ?? []
  const thinking = modelLevels.includes(thinkingByModel[modelKey]) ? thinkingByModel[modelKey] : null
  const setThinking = (variant: string | null) =>
    setThinkingByModel((all) => {
      const next = { ...all }
      if (variant) next[modelKey] = variant
      else delete next[modelKey]
      return next
    })

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
      // handled in submit(): it needs to send a prompt and watch the turn
      { name: 'mod', description: 'Have the model build a mod: /mod <what it should do>', run: () => {} },
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
  const sendPrompt = async (text: string, withImages: ImageAttachment[] = []) => {
    const id = await ensureThread()
    const result = await mods.dispatch('prompt.submit', { sessionID: id, text })
    if (!result) return
    await chat.send(id, result.text, model, intelligent ? INTELLIGENT_UI_PROMPT : undefined, withImages, thinking)
  }

  const addImages = async (files: File[]) => {
    const room = MAX_IMAGES - images.length
    if (room <= 0) return setError(`Up to ${MAX_IMAGES} images per message`)
    if (files.length > room) setError(`Only the first ${room} images were attached (max ${MAX_IMAGES})`)
    const read = await Promise.allSettled(files.slice(0, room).map(readImage))
    const ok = read.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    if (ok.length < read.length) setError("Some images couldn't be read")
    setImages((list) => [...list, ...ok].slice(0, MAX_IMAGES))
  }

  const submit = async (override?: string) => {
    const text = (override ?? draft).trim()
    // a retry or "Fix it" sends its own text and leaves attachments in the composer alone
    const attached = override === undefined ? images : []
    if (!text && !attached.length) return
    setDraft('')
    if (attached.length) setImages([])
    setError(null)
    try {
      if (!text) return await sendPrompt('', attached)
      const cmd = commands.parse(text)
      if (cmd?.kind === 'builtin' && cmd.builtin.name === 'mod') {
        const modsDir = window.opencodeApp?.modsDir
        if (!modsDir) return mods.toast('mod', 'Building mods needs the desktop app')
        if (!cmd.args.trim()) {
          setDraft('/mod ')
          return mods.toast('mod', 'Describe the mod after /mod, e.g. /mod show a clock in the status line')
        }
        const id = await ensureThread()
        modBuildRef.current = { sessionID: id, sawBusy: false }
        await chat.send(id, buildModPrompt(cmd.args.trim(), modsDir), model)
        return
      }
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
      await sendPrompt(text, attached)
    } catch (e) {
      setDraft(text)
      if (attached.length) setImages(attached)
      setError(`Send failed: ${e}`)
    }
  }

  // after a /mod build finishes, load what the model wrote
  const modBuildRef = useRef<{ sessionID: string; sawBusy: boolean } | null>(null)
  useEffect(() => {
    const pending = modBuildRef.current
    if (!pending) return
    if (state.busy[pending.sessionID]) {
      pending.sawBusy = true
    } else if (pending.sawBusy) {
      modBuildRef.current = null
      const before = new Set(mods.getSnapshot().mods.map((m) => m.info.name))
      void mods.reload().then(() => {
        const added = mods.getSnapshot().mods.filter((m) => !before.has(m.info.name))
        const broken = added.filter((m) => m.error)
        if (broken.length) mods.toast('mod', `${broken[0].info.name} loaded with an error: open Mods to see it`)
        else if (added.length) mods.toast('mod', `Mod ready: ${added.map((m) => m.info.name).join(', ')}`)
        // some models describe the files instead of writing them with tools
        else mods.toast('mod', "No new mod was written: this model skipped its file tools. Try again, or with a stronger model.")
      })
    }
  }, [state.busy])

  // "Fix it" on a broken widget: send the error back to the model in this thread
  const submitRef = useRef(submit)
  submitRef.current = submit
  useEffect(() => {
    const onFix = (e: Event) => {
      const { errors } = (e as CustomEvent<WidgetFixRequest>).detail
      void submitRef.current(
        `The widget you just made failed in the app with this error:\n\n${errors.map((m) => `- ${m}`).join('\n')}\n\n` +
          'Please send a corrected widget. Wrap the script in an IIFE so names like `top` or `name` cannot collide with browser globals.',
      )
    }
    window.addEventListener(WIDGET_FIX_EVENT, onFix)
    return () => window.removeEventListener(WIDGET_FIX_EVENT, onFix)
  }, [])

  const messages = useMemo(() => {
    if (!activeID) return []
    const s = state.sessions[activeID]
    return s ? s.order.map((id) => s.messages[id]).filter(Boolean) : []
  }, [state.sessions, activeID])

  const busy = activeID ? !!state.busy[activeID] : false
  const pending = state.permissions.filter((p) => p.sessionID === activeID)
  const thread = activeID ? state.threads[activeID] : undefined
  const topLevelThreads = Object.values(state.threads).filter((s) => !s.parentID)

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
        images={images}
        onAddImages={(files) => void addImages(files)}
        onRemoveImage={(id) => setImages((list) => list.filter((img) => img.id !== id))}
        thinking={thinking}
        onThinkingChange={setThinking}
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
        onDeleteThread={(session) => setConfirmDelete({ kind: 'one', session })}
        onDeleteAll={() => setConfirmDelete({ kind: 'all' })}
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
                      <div className="permission-title">{p.title}</div>
                      {p.detail && <div className="permission-detail">{p.detail}</div>}
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
              {state.questions
                .filter((q) => q.sessionID === activeID)
                .map((q) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    onAnswer={(answers) => chat.answerQuestion(q.id, answers)}
                    onDismiss={() => chat.dismissQuestion(q.id)}
                  />
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

      {confirmDelete?.kind === 'one' && (
        <ConfirmDialog
          title="Delete this thread?"
          confirmLabel="Delete thread"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const id = confirmDelete.session.id
            await chat.deleteThread(id)
            if (id === activeID) newThread()
            setConfirmDelete(null)
          }}
        >
          <p>
            <strong>{displayTitle(confirmDelete.session.title)}</strong> and all of its messages will be permanently
            deleted from opencode. This can't be undone.
          </p>
        </ConfirmDialog>
      )}

      {confirmDelete?.kind === 'all' && (
        <ConfirmDialog
          title="Delete all threads?"
          confirmLabel={`Delete ${topLevelThreads.length} threads`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            // sub-agent sessions go with their parent, so only top-level threads are deleted directly
            for (const s of topLevelThreads) await chat.deleteThread(s.id)
            newThread()
            setConfirmDelete(null)
          }}
        >
          <p>
            All {topLevelThreads.length} threads in this workspace (<code>{window.opencodeApp?.workspace ?? 'current folder'}</code>)
            will be permanently deleted from opencode, including in the opencode terminal app. This can't be undone.
          </p>
          <p>Threads in other workspace folders aren't affected.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
