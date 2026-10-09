import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@opencode-ai/sdk'
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
import { usePanes } from './lib/usePanes'
import { usePaneInputs } from './lib/usePaneInputs'
import { INTELLIGENT_UI_PROMPT } from './lib/intelligentUi'
import { buildModPrompt } from './lib/modPrompt'
import type { ImageAttachment } from './lib/images'
import { mods, useMods } from './mods/runtime'
import { Sidebar, THREAD_DRAG_TYPE } from './components/Sidebar'
import { Composer } from './components/Composer'
import { ChatPane } from './components/ChatPane'
import { ModBands, ModStatusLine, ModToasts, ModsPanel } from './components/ModChrome'
import { ConfirmDialog } from './components/ConfirmDialog'
import { WIDGET_FIX_EVENT, type WidgetFixRequest } from './components/Widget'
import { ComposeIcon, SidebarIcon, SplitIcon } from './components/Icons'
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
  const panes = usePanes()
  const inputs = usePaneInputs()

  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [model, setModel] = useState<ModelRef | null>(() => readPref<ModelRef | null>(MODEL_KEY, null))
  const [intelligent, setIntelligent] = useState(() => readPref(INTELLIGENT_KEY, true))
  const [thinkingByModel, setThinkingByModel] = useState<Record<string, string>>(() => readPref(THINKING_KEY, {}))
  const [modsOpen, setModsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'one'; session: Session } | { kind: 'all' } | null>(null)
  const [dropActive, setDropActive] = useState(false)

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

  // mods and "Fix it" act on the focused pane's thread
  const focusedRef = useRef(panes.focused)
  focusedRef.current = panes.focused

  useEffect(() => {
    mods.activeSession = () => focusedRef.current.sessionID
    void mods.load(appToken)
    chat.loadThreads().catch((e) => inputs.setError(focusedRef.current.id, `Couldn't load threads: ${e}`))
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
      .catch((e) => inputs.setError(focusedRef.current.id, `Couldn't load models: ${e}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // threads restored into panes from last time need their history
  useEffect(() => {
    for (const p of panes.panes) if (p.sessionID && !state.sessions[p.sessionID]) void chat.loadSession(p.sessionID).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes.panes])

  useEffect(() => {
    if (model) writePref(MODEL_KEY, model)
  }, [model])
  useEffect(() => writePref(INTELLIGENT_KEY, intelligent), [intelligent])
  useEffect(() => writePref(THINKING_KEY, thinkingByModel), [thinkingByModel])

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

  // a fresh chat in the focused pane
  const newThread = useCallback(() => {
    panes.setSession(panes.focused.id, null)
    inputs.setError(panes.focused.id, null)
    setDrawerOpen(false)
  }, [panes, inputs])

  const splitPane = useCallback(
    (sessionID: string | null = null) => {
      const added = panes.split(sessionID)
      if (added === false && !sessionID)
        mods.toast('split', panes.max === 4 ? 'Up to 4 chats at once' : 'Up to 2 chats in a window; go fullscreen for 4')
      if (sessionID) void chat.loadSession(sessionID).catch(() => {})
    },
    [panes, chat],
  )

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
      } else if (key === '\\') {
        e.preventDefault()
        splitPane()
      } else if (key === 'w' && panes.panes.length > 1) {
        e.preventDefault()
        panes.close(panes.focused.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newThread, toggleSidebar, splitPane, panes])

  const builtins = useMemo<Builtin[]>(
    () => [
      { name: 'new', description: 'Start a new thread', run: () => newThread() },
      { name: 'split', description: 'Open another chat side by side', run: () => splitPane() },
      { name: 'mods', description: 'Manage mods', run: () => setModsOpen(true) },
      { name: 'ui', description: 'Toggle Intelligent UI widgets', run: () => setIntelligent((v) => !v) },
      // handled in submit(): it needs to send a prompt and watch the turn
      { name: 'mod', description: 'Have the model build a mod: /mod <what it should do>', run: () => {} },
    ],
    [newThread, splitPane],
  )
  const commands = useCommands(builtins)

  const selectThread = (id: string) => {
    panes.open(id)
    inputs.setError(panes.focused.id, null)
    setDrawerOpen(false)
    mods.emit('session.start', { sessionID: id })
    chat.loadSession(id).catch((e) => inputs.setError(panes.focused.id, `Couldn't load that thread: ${e}`))
  }

  // a pane's thread, created on its first message
  const ensureThread = async (paneId: string) => {
    const pane = panes.panes.find((p) => p.id === paneId)
    if (pane?.sessionID) return pane.sessionID
    const id = (await chat.createThread()).id
    panes.setSession(paneId, id)
    mods.emit('session.start', { sessionID: id })
    return id
  }

  // a plain prompt: mods may rewrite or swallow it first
  const sendPrompt = async (paneId: string, text: string, withImages: ImageAttachment[] = []) => {
    const id = await ensureThread(paneId)
    const result = await mods.dispatch('prompt.submit', { sessionID: id, text })
    if (!result) return
    await chat.send(id, result.text, model, intelligent ? INTELLIGENT_UI_PROMPT : undefined, withImages, thinking)
  }

  const submit = async (paneId: string, override?: string) => {
    const text = (override ?? inputs.draftOf(paneId)).trim()
    // a retry or "Fix it" sends its own text and leaves attachments in the composer alone
    const attached = override === undefined ? inputs.imagesOf(paneId) : []
    if (!text && !attached.length) return
    inputs.setDraft(paneId, '')
    if (attached.length) inputs.setPaneImages(paneId, () => [])
    inputs.setError(paneId, null)
    try {
      if (!text) return await sendPrompt(paneId, '', attached)
      const cmd = commands.parse(text)
      if (cmd?.kind === 'builtin' && cmd.builtin.name === 'mod') {
        const modsDir = window.opencodeApp?.modsDir
        if (!modsDir) return mods.toast('mod', 'Building mods needs the desktop app')
        if (!cmd.args.trim()) {
          inputs.setDraft(paneId, '/mod ')
          return mods.toast('mod', 'Describe the mod after /mod, e.g. /mod show a clock in the status line')
        }
        const id = await ensureThread(paneId)
        modBuildRef.current = { sessionID: id, sawBusy: false }
        await chat.send(id, buildModPrompt(cmd.args.trim(), modsDir), model)
        return
      }
      if (cmd?.kind === 'builtin') return cmd.builtin.run(cmd.args)
      if (cmd?.kind === 'mod') {
        const out = await mods.runCommand(cmd.name, cmd.args)
        if (out?.text) mods.toast(cmd.name, out.text)
        if (out?.prompt) await sendPrompt(paneId, out.prompt)
        return
      }
      if (cmd?.kind === 'opencode') {
        const id = await ensureThread(paneId)
        return await chat.runCommand(id, cmd.name, cmd.args, model)
      }
      await sendPrompt(paneId, text, attached)
    } catch (e) {
      inputs.setDraft(paneId, text)
      if (attached.length) inputs.setPaneImages(paneId, () => attached)
      inputs.setError(paneId, `Send failed: ${e}`)
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
        else mods.toast('mod', "No new mod was written: this model skipped its file tools. Try again, or with a stronger model.")
      })
    }
  }, [state.busy])

  // "Fix it" on a broken widget: send the error back to the model in the focused pane
  const submitRef = useRef(submit)
  submitRef.current = submit
  useEffect(() => {
    const onFix = (e: Event) => {
      const { errors } = (e as CustomEvent<WidgetFixRequest>).detail
      void submitRef.current(
        focusedRef.current.id,
        `The widget you just made failed in the app with this error:\n\n${errors.map((m) => `- ${m}`).join('\n')}\n\n` +
          'Please send a corrected widget. Wrap the script in an IIFE so names like `top` or `name` cannot collide with browser globals.',
      )
    }
    window.addEventListener(WIDGET_FIX_EVENT, onFix)
    return () => window.removeEventListener(WIDGET_FIX_EVENT, onFix)
  }, [])

  const topLevelThreads = Object.values(state.threads).filter((s) => !s.parentID)
  const split = panes.panes.length > 1

  const composerFor = (paneId: string, sessionID: string | null) => {
    const busy = sessionID ? !!state.busy[sessionID] : false
    return (
      <>
        <ModBands />
        <Composer
          value={inputs.draftOf(paneId)}
          onChange={(v) => inputs.setDraft(paneId, v)}
          onSubmit={() => submit(paneId)}
          onStop={() => sessionID && chat.abort(sessionID)}
          busy={busy}
          providers={providers}
          model={model}
          onModelChange={setModel}
          commands={commands.list}
          intelligent={intelligent}
          onToggleIntelligent={() => setIntelligent((v) => !v)}
          images={inputs.imagesOf(paneId)}
          onAddImages={(files) => void inputs.addImages(paneId, files, inputs.imagesOf(paneId).length)}
          onRemoveImage={(id) => inputs.setPaneImages(paneId, (list) => list.filter((img) => img.id !== id))}
          thinking={thinking}
          onThinkingChange={setThinking}
        />
        <ModStatusLine />
      </>
    )
  }

  const messagesOf = (sessionID: string | null) => {
    const s = sessionID ? state.sessions[sessionID] : undefined
    return s ? s.order.map((id) => s.messages[id]).filter(Boolean) : []
  }

  return (
    <div className={['app', showSidebar ? 'sidebar-open' : 'sidebar-collapsed', narrow ? 'narrow' : ''].join(' ')}>
      {narrow && drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />}
      <Sidebar
        sessions={Object.values(state.threads)}
        activeID={panes.focused.sessionID}
        openIDs={panes.panes.flatMap((p) => (p.sessionID ? [p.sessionID] : []))}
        busy={state.busy}
        connected={connected}
        modCount={modSnapshot.mods.filter((m) => m.enabled).length}
        onSelect={selectThread}
        onNew={newThread}
        onOpenMods={() => setModsOpen(true)}
        onCollapse={toggleSidebar}
        onDeleteThread={(session) => setConfirmDelete({ kind: 'one', session })}
        onDeleteAll={() => setConfirmDelete({ kind: 'all' })}
        onOpenInSplit={(id) => splitPane(id)}
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
            {split
              ? `${panes.panes.length} chats`
              : panes.focused.sessionID
                ? displayTitle(state.threads[panes.focused.sessionID]?.title)
                : 'New thread'}
          </div>
          <button
            type="button"
            className="icon-btn split-btn"
            onClick={() => splitPane()}
            disabled={panes.panes.length >= panes.max}
            title={
              panes.panes.length >= panes.max
                ? panes.max === 4
                  ? 'Up to 4 chats at once'
                  : 'Go fullscreen for up to 4 chats'
                : 'Split: open another chat side by side (Ctrl+\\)'
            }
          >
            <SplitIcon size={15} />
            <span>Split</span>
          </button>
        </header>

        <div
          className={['panes', `panes-${panes.panes.length}`, dropActive ? 'drop-active' : ''].join(' ')}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(THREAD_DRAG_TYPE)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDropActive(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false)
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData(THREAD_DRAG_TYPE)
            setDropActive(false)
            if (!id) return
            e.preventDefault()
            splitPane(id)
          }}
        >
          {panes.panes.map((pane) => {
            const sid = pane.sessionID
            return (
              <ChatPane
                key={pane.id}
                sessionID={sid}
                title={sid ? displayTitle(state.threads[sid]?.title) : 'New thread'}
                focused={split && pane.id === panes.focused.id}
                split={split}
                messages={messagesOf(sid)}
                busy={sid ? !!state.busy[sid] : false}
                permissions={state.permissions.filter((p) => sid && p.sessionID === sid)}
                questions={state.questions.filter((q) => sid && q.sessionID === sid)}
                error={inputs.errorOf(pane.id)}
                composer={composerFor(pane.id, sid)}
                suggestions={SUGGESTIONS}
                onFocus={() => panes.setFocusedId(pane.id)}
                onClose={() => panes.close(pane.id)}
                onRetry={(text) => submit(pane.id, text)}
                onSuggestion={(text) => inputs.setDraft(pane.id, text)}
                onDismissError={() => inputs.setError(pane.id, null)}
                onPermission={(id, reply) => sid && chat.respondPermission(sid, id, reply)}
                onAnswer={(id, answers) => chat.answerQuestion(id, answers)}
                onDismissQuestion={(id) => chat.dismissQuestion(id)}
              />
            )
          })}
          {dropActive && (
            <div className="drop-hint-panes">
              {panes.panes.length < panes.max ? 'Drop to open in a new pane' : 'Drop to open in the focused pane'}
            </div>
          )}
        </div>
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
            panes.forget(id)
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
            for (const s of topLevelThreads) {
              await chat.deleteThread(s.id)
              panes.forget(s.id)
            }
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
