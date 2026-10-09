import { useCallback, useEffect, useReducer, useState } from 'react'
import type { Event, Message, Part, Session } from '@opencode-ai/sdk'
import { appToken, client, type ModelRef } from './opencode'
import {
  applyEvent,
  emptyChat,
  loadHistory,
  setPending,
  setThreads,
  toPendingPermission,
  type ChatState,
  type PendingPermission,
  type PendingQuestion,
} from './chatState'
import { forwardToMods } from '../mods/bridge'
import type { ImageAttachment } from './images'

type Action =
  | { type: 'event'; event: Event }
  | { type: 'history'; sessionID: string; items: Array<{ info: Message; parts: Part[] }> }
  | { type: 'threads'; list: Session[] }
  | { type: 'pending'; permissions: PendingPermission[]; questions: PendingQuestion[] }

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case 'pending':
      return setPending(state, action.permissions, action.questions)
    case 'event':
      return applyEvent(state, action.event)
    case 'history':
      return loadHistory(state, action.sessionID, action.items)
    case 'threads':
      return setThreads(state, action.list)
  }
}

export function useChat() {
  const [state, dispatch] = useReducer(reducer, emptyChat)
  const [connected, setConnected] = useState(false)

  const loadPending = async () => {
    const headers = { 'x-app-token': appToken }
    const [perms, questions] = await Promise.all([
      fetch('/oc/permission', { headers }).then((r) => (r.ok ? r.json() : [])),
      fetch('/oc/question', { headers }).then((r) => (r.ok ? r.json() : [])),
    ])
    dispatch({
      type: 'pending',
      permissions: (perms as Parameters<typeof toPendingPermission>[0][]).map(toPendingPermission),
      questions: questions as PendingQuestion[],
    })
  }

  // Live event stream. Reconnects after a drop, with a short backoff.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      while (!cancelled) {
        try {
          const sub = await client.event.subscribe()
          setConnected(true)
          // anything asked while we weren't listening (or before a restart) would block its turn forever
          void loadPending().catch(() => {})
          for await (const event of sub.stream) {
            if (cancelled) return
            dispatch({ type: 'event', event: event as Event })
            forwardToMods(event as Event)
          }
        } catch {
          // fall through to retry
        }
        setConnected(false)
        if (!cancelled) await new Promise((r) => setTimeout(r, 1500))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadThreads = useCallback(async () => {
    const res = await client.session.list()
    if (res.data) dispatch({ type: 'threads', list: res.data })
  }, [])

  const loadSession = useCallback(async (sessionID: string) => {
    const res = await client.session.messages({ path: { id: sessionID } })
    if (res.data) {
      dispatch({ type: 'history', sessionID, items: res.data as Array<{ info: Message; parts: Part[] }> })
    }
  }, [])

  const createThread = useCallback(async (): Promise<Session> => {
    const res = await client.session.create({ body: {} })
    if (!res.data) throw new Error('server returned no session')
    dispatch({ type: 'threads', list: [res.data] })
    return res.data
  }, [])

  // Fire and forget: the reply arrives through the event stream.
  const send = useCallback(
    async (
      sessionID: string,
      text: string,
      model: ModelRef | null,
      system?: string,
      images: ImageAttachment[] = [],
      variant?: string | null,
      sharedContexts: string[] = [],
    ) => {
      const parts = [
        // other chats shared as context: the model reads them, the chat shows them as chips
        ...sharedContexts.map((text) => ({ type: 'text' as const, text, synthetic: true })),
        ...images.map((img) => ({ type: 'file' as const, mime: img.mime, filename: img.name, url: img.dataUrl })),
        ...(text ? [{ type: 'text' as const, text }] : []),
      ]
      const res = await client.session.promptAsync({
        path: { id: sessionID },
        // `variant` is the thinking level; the bundled SDK's types predate it, the server accepts it
        body: { model: model ?? undefined, system: system || undefined, parts, ...(variant ? { variant } : {}) } as never,
      })
      if (res.error) throw new Error(JSON.stringify(res.error))
    },
    [],
  )

  // the session.deleted event removes it from the sidebar
  const deleteThread = useCallback(async (sessionID: string) => {
    const res = await client.session.delete({ path: { id: sessionID } })
    if (res.error) throw new Error(JSON.stringify(res.error))
  }, [])

  // opencode's own slash commands (from its config and project)
  const runCommand = useCallback(async (sessionID: string, command: string, args: string, model: ModelRef | null) => {
    const res = await client.session.command({
      path: { id: sessionID },
      body: { command, arguments: args, model: model ? `${model.providerID}/${model.modelID}` : undefined },
    })
    if (res.error) throw new Error(JSON.stringify(res.error))
  }, [])

  const abort = useCallback(async (sessionID: string) => {
    await client.session.abort({ path: { id: sessionID } })
  }, [])

  // the bundled SDK predates these endpoints, so they're called directly through the gateway
  const post = useCallback(async (path: string, body: unknown) => {
    const res = await fetch(`/oc${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-token': appToken },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`)
  }, [])

  const respondPermission = useCallback(
    async (_sessionID: string, permissionID: string, reply: 'once' | 'always' | 'reject') => {
      await post(`/permission/${encodeURIComponent(permissionID)}/reply`, { reply })
    },
    [post],
  )

  const answerQuestion = useCallback(
    async (questionID: string, answers: string[][]) => {
      await post(`/question/${encodeURIComponent(questionID)}/reply`, { answers })
    },
    [post],
  )

  const dismissQuestion = useCallback(
    async (questionID: string) => {
      await post(`/question/${encodeURIComponent(questionID)}/reject`, {})
    },
    [post],
  )

  return {
    state,
    connected,
    loadThreads,
    loadSession,
    createThread,
    deleteThread,
    send,
    runCommand,
    abort,
    respondPermission,
    answerQuestion,
    dismissQuestion,
  }
}
