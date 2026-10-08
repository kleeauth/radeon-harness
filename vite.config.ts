import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Dev bridge to the local opencode server.
// - /oc/*            -> proxied to the opencode server, Basic auth added here so the browser never holds the password
// - /api/providers   -> sanitized model list (API keys stripped before they reach the browser)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.OPENCODE_URL ?? 'http://127.0.0.1:4096'
  const password = env.OPENCODE_PASSWORD ?? ''
  const auth = 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64')

  const bridge: Plugin = {
    name: 'opencode-bridge',
    configureServer(server) {
      server.middlewares.use('/api/providers', async (_req, res) => {
        try {
          const upstream = await fetch(`${target}/config/providers`, {
            headers: { Authorization: auth },
          })
          const body = (await upstream.json()) as {
            providers: Array<{
              id: string
              name: string
              models: Record<string, { id: string; name: string }>
            }>
            default?: Record<string, string>
          }
          const providers = body.providers
            .map((p) => ({
              id: p.id,
              name: p.name,
              models: Object.values(p.models).map((m) => ({ id: m.id, name: m.name })),
            }))
            .filter((p) => p.models.length > 0)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ providers, defaults: body.default ?? {} }))
        } catch (err) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
    },
  }

  return {
    plugins: [react(), bridge],
    server: {
      proxy: {
        '/oc': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/oc/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Authorization', auth)
            })
          },
        },
      },
    },
  }
})
