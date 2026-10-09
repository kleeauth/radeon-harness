import { useCallback, useEffect, useState } from 'react'
import type { WindowState } from './opencode'

export type Pane = { id: string; sessionID: string | null }

const PANES_KEY = 'radeon-harness.panes'
const newId = () => Math.random().toString(36).slice(2, 10)

function readPanes(): Pane[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PANES_KEY) ?? '[]') as Pane[]
    if (Array.isArray(raw) && raw.length) return raw.map((p) => ({ id: newId(), sessionID: p.sessionID ?? null }))
  } catch {
    // fall through to one empty pane
  }
  return [{ id: newId(), sessionID: null }]
}

function useWindowState(): WindowState {
  const app = window.opencodeApp
  const [state, setState] = useState<WindowState>(() => app?.getWindowState?.() ?? { maximized: false, fullscreen: false })
  useEffect(() => app?.onWindowState?.(setState), [app])
  return state
}

// Split view like Claude Code: 2 chats side by side, up to 4 (2x2) only when the window fills the screen.
export function usePanes() {
  const win = useWindowState()
  const max = win.fullscreen || win.maximized ? 4 : 2
  const [panes, setPanes] = useState<Pane[]>(readPanes)
  const [focusedId, setFocusedId] = useState<string>(() => panes[0].id)

  // leaving fullscreen folds the extra panes away, keeping the focused one
  useEffect(() => {
    setPanes((list) => {
      if (list.length <= max) return list
      const keep = list.slice(0, max)
      const focused = list.find((p) => p.id === focusedId)
      if (focused && !keep.includes(focused)) keep[keep.length - 1] = focused
      return keep
    })
  }, [max, focusedId])

  useEffect(() => {
    try {
      localStorage.setItem(PANES_KEY, JSON.stringify(panes.map((p) => ({ sessionID: p.sessionID }))))
    } catch {
      // storage blocked: layout resets next launch
    }
    if (!panes.some((p) => p.id === focusedId)) setFocusedId(panes[0].id)
  }, [panes, focusedId])

  const focused = panes.find((p) => p.id === focusedId) ?? panes[0]

  const setSession = useCallback((paneId: string, sessionID: string | null) => {
    setPanes((list) => list.map((p) => (p.id === paneId ? { ...p, sessionID } : p)))
  }, [])

  // open a thread: if it's already in a pane, focus that pane; otherwise show it in the focused one
  const open = useCallback(
    (sessionID: string) => {
      const existing = panes.find((p) => p.sessionID === sessionID)
      if (existing) return setFocusedId(existing.id)
      setSession(focused.id, sessionID)
    },
    [panes, focused.id, setSession],
  )

  // add a pane (empty, or with a thread); when full, the thread replaces the focused pane instead
  const split = useCallback(
    (sessionID: string | null = null) => {
      if (sessionID) {
        const existing = panes.find((p) => p.sessionID === sessionID)
        if (existing) return setFocusedId(existing.id)
      }
      if (panes.length >= max) {
        if (sessionID) setSession(focused.id, sessionID)
        return false
      }
      const pane = { id: newId(), sessionID }
      setPanes((list) => [...list, pane])
      setFocusedId(pane.id)
      return true
    },
    [panes, max, focused.id, setSession],
  )

  const close = useCallback((paneId: string) => {
    setPanes((list) => (list.length <= 1 ? [{ ...list[0], sessionID: null }] : list.filter((p) => p.id !== paneId)))
  }, [])

  // a deleted thread leaves its panes empty
  const forget = useCallback((sessionID: string) => {
    setPanes((list) => list.map((p) => (p.sessionID === sessionID ? { ...p, sessionID: null } : p)))
  }, [])

  return { panes, focused, max, setFocusedId, setSession, open, split, close, forget }
}
