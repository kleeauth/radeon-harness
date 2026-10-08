import type { AssistantMessage, Event } from '@opencode-ai/sdk'
import { mods } from './runtime'

// Translates opencode's raw event stream into the smaller set of mod events.
const turnStarted = new Map<string, number>()
const toolsReported = new Set<string>()
const messagesReported = new Set<string>()
const textByMessage = new Map<string, Map<string, string>>()

export function forwardToMods(event: Event) {
  switch (event.type) {
    case 'session.status': {
      const { sessionID, status } = event.properties
      if (status.type === 'busy' && !turnStarted.has(sessionID)) {
        turnStarted.set(sessionID, Date.now())
        mods.emit('turn.start', { sessionID })
      } else if (status.type === 'idle') {
        endTurn(sessionID)
      }
      return
    }
    case 'session.idle':
      endTurn(event.properties.sessionID)
      return

    case 'message.part.updated': {
      const { part } = event.properties
      if (part.type === 'text') {
        const parts = textByMessage.get(part.messageID) ?? new Map<string, string>()
        parts.set(part.id, part.text)
        textByMessage.set(part.messageID, parts)
      }
      if (part.type === 'tool' && (part.state.status === 'completed' || part.state.status === 'error')) {
        if (toolsReported.has(part.callID)) return
        toolsReported.add(part.callID)
        const s = part.state
        mods.emit('tool.result', {
          sessionID: part.sessionID,
          tool: part.tool,
          status: s.status,
          title: s.status === 'completed' ? s.title : s.error,
          durationMs: s.time.end - s.time.start,
        })
      }
      return
    }

    case 'message.updated': {
      const info = event.properties.info
      if (info.role !== 'assistant') return
      const a = info as AssistantMessage
      if (!a.time.completed || messagesReported.has(a.id)) return
      messagesReported.add(a.id)
      const text = [...(textByMessage.get(a.id)?.values() ?? [])].join('\n')
      textByMessage.delete(a.id)
      mods.emit('message.complete', {
        sessionID: a.sessionID,
        text,
        cost: a.cost,
        tokens: { input: a.tokens.input, output: a.tokens.output },
      })
      return
    }
  }
}

function endTurn(sessionID: string) {
  const started = turnStarted.get(sessionID)
  if (started === undefined) return
  turnStarted.delete(sessionID)
  mods.emit('turn.end', { sessionID, durationMs: Date.now() - started })
}
