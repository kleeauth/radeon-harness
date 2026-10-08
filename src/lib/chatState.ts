import type { Event, Message, Part, Session } from '@opencode-ai/sdk'

export type MessageView = { info: Message; parts: Part[] }

// A tool waiting for the user's go-ahead. The turn is blocked until it's answered.
export type PendingPermission = { id: string; sessionID: string; title: string; detail: string }

// The agent asking the user something (opencode's question tool). Also blocks the turn.
export type PendingQuestion = {
  id: string
  sessionID: string
  questions: Array<{ question: string; header?: string; options: Array<{ label: string; description?: string }> }>
}

export type ChatState = {
  // thread metadata for the sidebar, kept fresh by session.* events
  threads: Record<string, Session>
  // per session: message ids in display order, plus their data
  sessions: Record<string, { order: string[]; messages: Record<string, MessageView> }>
  busy: Record<string, boolean>
  permissions: PendingPermission[]
  questions: PendingQuestion[]
}

export const emptyChat: ChatState = { threads: {}, sessions: {}, busy: {}, permissions: [], questions: [] }

// Current opencode sends `permission.asked` { id, sessionID, permission, patterns, metadata }.
// Older servers sent `permission.updated` with a ready-made title; both end up here.
type RawPermission = {
  id: string
  sessionID: string
  permission?: string
  type?: string
  title?: string
  patterns?: string[]
  pattern?: string | string[]
  metadata?: Record<string, unknown>
}

const PERMISSION_LABELS: Record<string, string> = {
  external_directory: 'Access files outside the workspace',
  edit: 'Edit files',
  write: 'Write files',
  bash: 'Run a command',
  webfetch: 'Fetch a web page',
  doom_loop: 'Keep going after repeated identical tool calls',
}

export function toPendingPermission(raw: RawPermission): PendingPermission {
  const kind = raw.permission ?? raw.type ?? 'permission'
  const meta = raw.metadata ?? {}
  const command = typeof meta.command === 'string' ? meta.command : undefined
  const patterns = raw.patterns ?? (Array.isArray(raw.pattern) ? raw.pattern : raw.pattern ? [raw.pattern] : [])
  return {
    id: raw.id,
    sessionID: raw.sessionID,
    title: raw.title ?? PERMISSION_LABELS[kind] ?? kind,
    detail: command ?? patterns.join(', '),
  }
}

export function setPending(state: ChatState, permissions: PendingPermission[], questions: PendingQuestion[]): ChatState {
  const merge = <T extends { id: string }>(current: T[], incoming: T[]) => [
    ...current,
    ...incoming.filter((x) => !current.some((c) => c.id === x.id)),
  ]
  return { ...state, permissions: merge(state.permissions, permissions), questions: merge(state.questions, questions) }
}

// events this SDK version doesn't type yet
type LooseEvent = { type: string; properties: Record<string, unknown> }

function applyNewerEvent(state: ChatState, ev: LooseEvent): ChatState | null {
  const p = ev.properties
  switch (ev.type) {
    case 'permission.asked':
      return setPending(state, [toPendingPermission(p as unknown as RawPermission)], [])
    case 'question.asked':
      return setPending(state, [], [p as unknown as PendingQuestion])
    case 'question.replied':
    case 'question.rejected':
      return { ...state, questions: state.questions.filter((q) => q.id !== p.requestID) }
    case 'message.part.delta': {
      // streaming text arrives as deltas against a part we already know
      const { sessionID, messageID, partID, field, delta } = p as {
        sessionID: string
        messageID: string
        partID: string
        field: string
        delta: string
      }
      const view = state.sessions[sessionID]?.messages[messageID]
      const idx = view?.parts.findIndex((x) => x.id === partID) ?? -1
      if (!view || idx < 0) return state
      const prev = view.parts[idx] as unknown as Record<string, unknown>
      const parts = [...view.parts]
      parts[idx] = { ...prev, [field]: String(prev[field] ?? '') + delta } as unknown as Part
      const session = state.sessions[sessionID]
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [sessionID]: { ...session, messages: { ...session.messages, [messageID]: { ...view, parts } } },
        },
      }
    }
    default:
      return null
  }
}

export function setThreads(state: ChatState, list: Session[]): ChatState {
  return { ...state, threads: { ...Object.fromEntries(list.map((s) => [s.id, s])), ...state.threads } }
}

function ensureSession(state: ChatState, sessionID: string) {
  return state.sessions[sessionID] ?? { order: [], messages: {} }
}

function upsertMessage(state: ChatState, info: Message): ChatState {
  const session = ensureSession(state, info.sessionID)
  const existing = session.messages[info.id]
  const nextMessages = {
    ...session.messages,
    [info.id]: { info, parts: existing?.parts ?? [] },
  }
  const order = existing ? session.order : [...session.order, info.id]
  return {
    ...state,
    sessions: { ...state.sessions, [info.sessionID]: { order, messages: nextMessages } },
  }
}

function upsertPart(state: ChatState, part: Part, delta?: string): ChatState {
  const session = ensureSession(state, part.sessionID)
  const existing = session.messages[part.messageID]
  // message.updated can arrive after its parts; create a placeholder shell if needed
  const view: MessageView = existing ?? {
    info: { id: part.messageID, sessionID: part.sessionID, role: 'assistant' } as Message,
    parts: [],
  }

  const idx = view.parts.findIndex((p) => p.id === part.id)
  let parts: Part[]
  if (idx === -1) {
    parts = [...view.parts, part]
  } else {
    parts = [...view.parts]
    const prev = view.parts[idx]
    // streaming text: the server sends the new chunk in `delta`, the part itself may be a snapshot
    if (delta && prev.type === 'text' && part.type === 'text') {
      parts[idx] = { ...part, text: prev.text + delta }
    } else {
      parts[idx] = part
    }
  }

  const order = existing ? session.order : [...session.order, part.messageID]
  return {
    ...state,
    sessions: {
      ...state.sessions,
      [part.sessionID]: {
        order,
        messages: { ...session.messages, [part.messageID]: { ...view, parts } },
      },
    },
  }
}

export function applyEvent(state: ChatState, event: Event): ChatState {
  const newer = applyNewerEvent(state, event as unknown as LooseEvent)
  if (newer) return newer
  switch (event.type) {
    case 'message.updated':
      return upsertMessage(state, event.properties.info)

    case 'message.part.updated':
      return upsertPart(state, event.properties.part, event.properties.delta)

    case 'message.part.removed': {
      const { sessionID, messageID, partID } = event.properties
      const session = ensureSession(state, sessionID)
      const view = session.messages[messageID]
      if (!view) return state
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [sessionID]: {
            ...session,
            messages: {
              ...session.messages,
              [messageID]: { ...view, parts: view.parts.filter((p) => p.id !== partID) },
            },
          },
        },
      }
    }

    case 'session.created':
    case 'session.updated':
      return { ...state, threads: { ...state.threads, [event.properties.info.id]: event.properties.info } }

    case 'session.deleted': {
      const threads = { ...state.threads }
      delete threads[event.properties.info.id]
      return { ...state, threads }
    }

    case 'session.status':
      return {
        ...state,
        busy: { ...state.busy, [event.properties.sessionID]: event.properties.status.type === 'busy' },
      }

    case 'session.idle':
      return { ...state, busy: { ...state.busy, [event.properties.sessionID]: false } }

    case 'permission.updated':
      return setPending(
        { ...state, permissions: state.permissions.filter((p) => p.id !== event.properties.id) },
        [toPendingPermission(event.properties)],
        [],
      )

    case 'permission.replied': {
      // newer servers send requestID, older ones permissionID
      const props = event.properties as { permissionID?: string; requestID?: string }
      const id = props.requestID ?? props.permissionID
      return { ...state, permissions: state.permissions.filter((p) => p.id !== id) }
    }

    default:
      return state
  }
}

// Load a full history fetched via session.messages (array of { info, parts })
export function loadHistory(
  state: ChatState,
  sessionID: string,
  items: Array<{ info: Message; parts: Part[] }>,
): ChatState {
  const order = items.map((m) => m.info.id)
  const messages = Object.fromEntries(items.map((m) => [m.info.id, { info: m.info, parts: m.parts }]))
  return { ...state, sessions: { ...state.sessions, [sessionID]: { order, messages } } }
}
