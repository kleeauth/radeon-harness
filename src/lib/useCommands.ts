import { useEffect, useMemo, useState } from 'react'
import type { Command } from '@opencode-ai/sdk'
import { client } from './opencode'
import { useMods } from '../mods/runtime'
import type { SlashCommand } from '../components/Composer'

export type Builtin = { name: string; description: string; run: (args: string) => void }

export type ParsedCommand =
  | { kind: 'builtin'; builtin: Builtin; args: string }
  | { kind: 'mod'; name: string; args: string }
  | { kind: 'opencode'; name: string; args: string }

// Slash commands from three places: the app itself, mods, and opencode's own config.
// On a name clash the earlier source wins.
export function useCommands(builtins: Builtin[]) {
  const { commands: modCommands } = useMods()
  const [opencodeCommands, setOpencodeCommands] = useState<Command[]>([])

  useEffect(() => {
    client.command
      .list()
      .then((res) => res.data && setOpencodeCommands(res.data))
      .catch(() => {
        // no commands is fine
      })
  }, [])

  const list = useMemo<SlashCommand[]>(() => {
    const seen = new Set<string>()
    const out: SlashCommand[] = []
    const add = (c: SlashCommand) => {
      if (seen.has(c.name)) return
      seen.add(c.name)
      out.push(c)
    }
    builtins.forEach((b) => add({ name: b.name, description: b.description, source: 'app' }))
    modCommands.forEach((c) => add({ name: c.spec.name, description: c.spec.description, source: c.mod }))
    opencodeCommands.forEach((c) => add({ name: c.name, description: c.description ?? '', source: 'opencode' }))
    return out
  }, [builtins, modCommands, opencodeCommands])

  const parse = (text: string): ParsedCommand | null => {
    const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
    if (!m) return null
    const [, name, args = ''] = m
    const entry = list.find((c) => c.name === name)
    if (!entry) return null
    if (entry.source === 'app') return { kind: 'builtin', builtin: builtins.find((b) => b.name === name)!, args }
    if (entry.source === 'opencode') return { kind: 'opencode', name, args }
    return { kind: 'mod', name, args }
  }

  return { list, parse }
}
