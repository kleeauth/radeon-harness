// /client is the browser-safe entry; the root export also pulls in Node process spawning.
import { createOpencodeClient } from '@opencode-ai/sdk/client'

declare global {
  interface Window {
    opencodeApp?: {
      token: string
      widgetOrigin: string
      workspace: string
      platform: string
      openModsFolder: () => void
      chooseWorkspace: () => Promise<boolean>
    }
  }
}

// Per-launch values from the Electron preload. The gateway rejects requests without the token.
export const appToken = window.opencodeApp?.token ?? ''
export const widgetOrigin = window.opencodeApp?.widgetOrigin ?? ''

// All requests go through the local gateway at /oc, which adds opencode auth.
export const client = createOpencodeClient({
  baseUrl: '/oc',
  headers: { 'x-app-token': appToken },
})

export type ModelRef = { providerID: string; modelID: string }

export type ProviderOption = {
  id: string
  name: string
  models: Array<{ id: string; name: string }>
}

export type ProviderCatalog = {
  providers: ProviderOption[]
  // opencode's default model per provider id
  defaults: Record<string, string>
}

export async function fetchProviders(): Promise<ProviderCatalog> {
  const res = await fetch('/api/providers', { headers: { 'x-app-token': appToken } })
  if (!res.ok) throw new Error(`providers request failed: ${res.status}`)
  const body = (await res.json()) as Partial<ProviderCatalog>
  return { providers: body.providers ?? [], defaults: body.defaults ?? {} }
}

// Prefer opencode's own provider default, then any provider's default, then the first model listed.
export function pickDefaultModel({ providers, defaults }: ProviderCatalog): ModelRef | null {
  const has = (p: string, m: string) => providers.some((x) => x.id === p && x.models.some((y) => y.id === m))
  for (const providerID of ['opencode', ...Object.keys(defaults)]) {
    const modelID = defaults[providerID]
    if (modelID && has(providerID, modelID)) return { providerID, modelID }
  }
  const first = providers[0]
  return first ? { providerID: first.id, modelID: first.models[0].id } : null
}

// opencode names fresh sessions "New session - <ISO timestamp>" until it generates a title
export function displayTitle(title: string | undefined): string {
  if (!title || /^New session - \d{4}-\d{2}-\d{2}T/.test(title)) return 'New thread'
  return title
}
