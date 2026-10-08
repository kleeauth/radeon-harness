import { useCallback, useEffect, useReducer, useState } from 'react'
import type { Event, Message, Part, Session } from '@opencode-ai/sdk'
import { client, type ModelRef } from './opencode'
import { applyEvent, emptyChat, loadHistory, setThreads, type ChatState } from './chatState'
import { forwardToMods } from '../mods/bridge'

type Action =
  | { type: 'event'; event: Event }
  | { type: 'history'; sessionID: string; items: Array<{ info: Message; parts: Part[] }> }
  | { type: 'threads'; list: Session[] }

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
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

  // Live event stream. Reconnects after a drop, with a short backoff.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      while (!cancelled) {
        try {
          const sub = await client.event.subscribe()
          setConnected(true)
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
  const send = useCallback(async (sessionID: string, text: string, model: ModelRef | null, system?: string) => {
    const res = await client.session.promptAsync({
      path: { id: sessionID },
      body: { model: model ?? undefined, system: system || undefined, parts: [{ type: 'text', text }] },
    })
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

  const respondPermission = useCallback(
    async (sessionID: string, permissionID: string, response: 'once' | 'always' | 'reject') => {
      await client.postSessionIdPermissionsPermissionId({
        path: { id: sessionID, permissionID },
        body: { response },
      })
    },
    [],
  )

  return { state, connected, loadThreads, loadSession, createThread, send, runCommand, abort, respondPermission }
}
