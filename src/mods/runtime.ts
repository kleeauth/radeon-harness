import { useSyncExternalStore } from 'react'
import type {
  BandSpec,
  CommandResult,
  CommandSpec,
  Hook,
  ModApi,
  ModEventName,
  ModEvents,
  ModInfo,
  ModModule,
} from './types'

type Loaded = { info: ModInfo; enabled: boolean; error?: string }
type HookEntry = { mod: string; event: ModEventName; fn: Hook<ModEventName> }
type Toast = { id: number; mod: string; text: string }

export type ModSnapshot = {
  mods: Loaded[]
  statuses: Array<{ mod: string; text: string }>
  bands: Array<{ mod: string; spec: NonNullable<BandSpec> }>
  toasts: Toast[]
  commands: Array<{ mod: string; spec: CommandSpec }>
}

const DISABLED_KEY = 'radeon-harness.mods.disabled'
const STATE_KEY = (mod: string) => `radeon-harness.mod.${mod}`

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked: state lives for this session only
  }
}

class ModRuntime {
  private loaded: Loaded[] = []
  private hooks: HookEntry[] = []
  private statuses = new Map<string, string>()
  private bands = new Map<string, NonNullable<BandSpec>>()
  private toasts: Toast[] = []
  private commands = new Map<string, { mod: string; spec: CommandSpec }>()
  private listeners = new Set<() => void>()
  private snapshot: ModSnapshot = { mods: [], statuses: [], bands: [], toasts: [], commands: [] }
  private toastSeq = 0
  private token = ''
  activeSession: () => string | null = () => null

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this.snapshot

  private changed() {
    this.snapshot = {
      mods: [...this.loaded],
      statuses: [...this.statuses].map(([mod, text]) => ({ mod, text })),
      bands: [...this.bands].map(([mod, spec]) => ({ mod, spec })),
      toasts: [...this.toasts],
      commands: [...this.commands.values()],
    }
    this.listeners.forEach((fn) => fn())
  }

  toast(mod: string, text: string) {
    const id = ++this.toastSeq
    this.toasts = [...this.toasts, { id, mod, text }].slice(-4)
    this.changed()
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id)
      this.changed()
    }, 4200)
  }

  private api(mod: string): ModApi {
    return {
      mod,
      ui: {
        status: (text) => {
          if (text) this.statuses.set(mod, text)
          else this.statuses.delete(mod)
          this.changed()
        },
        toast: (text) => this.toast(mod, text),
        band: (spec) => {
          if (spec) this.bands.set(mod, spec)
          else this.bands.delete(mod)
          this.changed()
        },
      },
      command: {
        register: (spec) => {
          this.commands.set(spec.name, { mod, spec })
          this.changed()
        },
      },
      state: {
        get: (key, fallback) => readJson(STATE_KEY(mod), {} as Record<string, unknown>)[key] as never ?? fallback,
        set: (key, value) => {
          const all = readJson(STATE_KEY(mod), {} as Record<string, unknown>)
          writeJson(STATE_KEY(mod), { ...all, [key]: value })
        },
      },
      activeSession: () => this.activeSession(),
    }
  }

  async load(token: string) {
    this.token = token
    this.hooks = []
    this.statuses.clear()
    this.bands.clear()
    this.commands.clear()
    const disabled = new Set(readJson<string[]>(DISABLED_KEY, []))

    let list: ModInfo[] = []
    try {
      const res = await fetch('/api/mods', { headers: { 'x-app-token': token } })
      if (res.ok) list = ((await res.json()) as { mods: ModInfo[] }).mods
    } catch {
      // no gateway (plain browser dev): run without mods
    }

    this.loaded = []
    for (const info of list) {
      const entry: Loaded = { info, enabled: !disabled.has(info.name) }
      this.loaded.push(entry)
      if (!entry.enabled) continue
      try {
        // cache-bust so a reload picks up edits
        const url = `/mods/${info.source}/${encodeURIComponent(info.name)}/mod.js?v=${Date.now()}`
        const mod = (await import(/* @vite-ignore */ url)) as ModModule
        const on = <K extends ModEventName>(event: K, fn: Hook<K>) => {
          this.hooks.push({ mod: info.name, event, fn: fn as unknown as Hook<ModEventName> })
        }
        await mod.register(on, this.api(info.name))
      } catch (err) {
        entry.error = String(err)
      }
    }
    this.changed()
  }

  reload() {
    return this.load(this.token)
  }

  setEnabled(name: string, enabled: boolean) {
    const disabled = new Set(readJson<string[]>(DISABLED_KEY, []))
    if (enabled) disabled.delete(name)
    else disabled.add(name)
    writeJson(DISABLED_KEY, [...disabled])
    return this.reload()
  }

  // Runs the hook chain. A hook that returns nothing continues with the event as-is;
  // one that returns null swallows it; one that returns an event answers with it.
  async dispatch<K extends ModEventName>(event: K, e: ModEvents[K]): Promise<ModEvents[K] | null> {
    const chain = this.hooks.filter((h) => h.event === event)
    const run = async (i: number, ev: ModEvents[K]): Promise<ModEvents[K] | null> => {
      if (i >= chain.length) return ev
      const h = chain[i]
      let called = false
      let downstream: ModEvents[K] | null = null
      const next = async (n: ModEvents[K]) => {
        called = true
        downstream = await run(i + 1, n)
        return downstream
      }
      try {
        const out = (await h.fn(ev as never, next as never)) as ModEvents[K] | null | undefined
        if (out === null) return null
        if (out !== undefined) return out
        return called ? downstream : run(i + 1, ev)
      } catch (err) {
        this.toast(h.mod, `${h.mod} failed on ${event}: ${String(err)}`)
        return run(i + 1, ev)
      }
    }
    return run(0, e)
  }

  hasCommand(name: string) {
    return this.commands.has(name)
  }

  async runCommand(name: string, args: string): Promise<CommandResult | void> {
    const entry = this.commands.get(name)
    if (!entry) return
    try {
      return await entry.spec.run(args, this.api(entry.mod))
    } catch (err) {
      this.toast(entry.mod, `/${name} failed: ${String(err)}`)
    }
  }

  emit<K extends ModEventName>(event: K, e: ModEvents[K]) {
    void this.dispatch(event, e)
  }
}

export const mods = new ModRuntime()

export function useMods() {
  return useSyncExternalStore(mods.subscribe, mods.getSnapshot)
}
