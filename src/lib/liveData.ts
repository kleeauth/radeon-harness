import { appToken } from './opencode'

// Result shape shared with the widget frame's harness.fetch.
export type LiveResult = {
  ok: boolean
  status: number
  url?: string
  contentType?: string
  body?: string
  error?: string
}

const ALWAYS_KEY = 'radeon-harness.live-data.always'

function readAlways(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ALWAYS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function isAlwaysAllowed(host: string) {
  return readAlways().includes(host)
}

export function allowAlways(host: string) {
  try {
    localStorage.setItem(ALWAYS_KEY, JSON.stringify([...new Set([...readAlways(), host])]))
  } catch {
    // storage blocked: allowed for this widget only
  }
}

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? u.hostname : null
  } catch {
    return null
  }
}

// The request itself runs in the Electron main process, which enforces https, public hosts and size limits.
export async function liveFetch(url: string): Promise<LiveResult> {
  try {
    const res = await fetch('/api/widget-fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-token': appToken },
      body: JSON.stringify({ url }),
    })
    if (!res.ok) return { ok: false, status: 0, error: `gateway error ${res.status}` }
    return (await res.json()) as LiveResult
  } catch (err) {
    return { ok: false, status: 0, error: String(err) }
  }
}
