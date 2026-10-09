import type { MessageView } from './chatState'

// A shared chat travels as a hidden (synthetic) text part that starts with this marker,
// so the conversation view can show it as a small chip instead of a wall of text.
const MARKER = '[Shared context from another chat: "'
const MAX_CHARS = 16000

export function buildSharedContext(title: string, messages: MessageView[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const who = m.info.role === 'user' ? 'User' : 'Assistant'
    for (const p of m.parts) {
      if (p.type === 'text' && !p.synthetic && p.text.trim()) lines.push(`${who}: ${p.text.trim()}`)
      else if (p.type === 'tool') lines.push(`(${who} used tool ${p.tool}${'title' in p.state && p.state.title ? `: ${p.state.title}` : ''})`)
    }
  }
  // keep the most recent part of long chats
  let body = lines.join('\n\n')
  if (body.length > MAX_CHARS) body = '…\n' + body.slice(body.length - MAX_CHARS)
  return (
    `${MARKER}${title}"]\n` +
    'The user shared this conversation from another chat in the app as context. ' +
    'Use it to inform your answer; you do not need to repeat it.\n\n' +
    (body || '(that chat has no messages yet)')
  )
}

// the chat title if this text part is a shared-context block
export function sharedContextTitle(text: string): string | null {
  if (!text.startsWith(MARKER)) return null
  const end = text.indexOf('"]', MARKER.length)
  return end > 0 ? text.slice(MARKER.length, end) : 'another chat'
}
