import type { Event, Message, Part, Permission, Session } from '@opencode-ai/sdk'

export type MessageView = { info: Message; parts: Part[] }

export type ChatState = {
  // thread metadata for the sidebar, kept fresh by session.* events
  threads: Record<string, Session>
  // per session: message ids in display order, plus their data
  sessions: Record<string, { order: string[]; messages: Record<string, MessageView> }>
  busy: Record<string, boolean>
  permissions: Permission[]
}

export const emptyChat: ChatState = { threads: {}, sessions: {}, busy: {}, permissions: [] }

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
      return {
        ...state,
        permissions: [...state.permissions.filter((p) => p.id !== event.properties.id), event.properties],
      }

    case 'permission.replied':
      return {
        ...state,
        permissions: state.permissions.filter((p) => p.id !== event.properties.permissionID),
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
