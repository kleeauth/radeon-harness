// The mod API, modeled on Claude Code mods: register(on, $), hooks are (e, next).

export type PromptSubmitEvent = { sessionID: string; text: string }
// a prompt hook returns the (possibly rewritten) event, or null to swallow the prompt
export type PromptSubmitResult = PromptSubmitEvent | null

export type ModEvents = {
  'session.start': { sessionID: string }
  'prompt.submit': PromptSubmitEvent
  'turn.start': { sessionID: string }
  'turn.end': { sessionID: string; durationMs: number }
  'tool.result': { sessionID: string; tool: string; status: 'completed' | 'error'; title: string; durationMs: number }
  'message.complete': { sessionID: string; text: string; cost?: number; tokens?: { input: number; output: number } }
}

export type ModEventName = keyof ModEvents

export type Next<E> = (e: E) => Promise<E | null>
export type Hook<K extends ModEventName> = (e: ModEvents[K], next: Next<ModEvents[K]>) => unknown

export type CommandSpec = {
  name: string
  description: string
  // return { prompt } to send a prompt, { text } to show a note, or nothing
  run: (args: string, $: ModApi) => Promise<CommandResult | void> | CommandResult | void
}
export type CommandResult = { prompt?: string; text?: string }

export type BandSpec = { text: string; tone?: 'info' | 'warn' | 'accent' } | null

export type ModApi = {
  mod: string
  ui: {
    status: (text: string | undefined) => void
    toast: (text: string) => void
    band: (spec: BandSpec) => void
  }
  command: { register: (spec: CommandSpec) => void }
  state: {
    get: <T>(key: string, fallback: T) => T
    set: (key: string, value: unknown) => void
  }
  // the thread the user is looking at, if any
  activeSession: () => string | null
}

export type On = <K extends ModEventName>(event: K, hook: Hook<K>) => void

export type ModModule = { register: (on: On, $: ModApi) => void | Promise<void> }

export type ModInfo = { name: string; description: string; version: string; source: 'bundled' | 'user' }
