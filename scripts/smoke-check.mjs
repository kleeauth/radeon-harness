// Connects to the running app over the DevTools protocol and checks it actually works:
// the window loaded, opencode connected, and the bundled mods were found.
const DEBUG = 'http://127.0.0.1:9222'
const deadline = Date.now() + 60_000

const pages = await (await fetch(`${DEBUG}/json`)).json()
const page = pages.find((p) => p.type === 'page')
if (!page) throw new Error('no app window found')
console.log('window:', page.title, page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let seq = 0
const evaluate = (expression) =>
  new Promise((resolve) => {
    const id = ++seq
    const onMessage = (m) => {
      const data = JSON.parse(m.data)
      if (data.id !== id) return
      ws.removeEventListener('message', onMessage)
      resolve(data.result?.result?.value)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })

let state
while (Date.now() < deadline) {
  state = await evaluate(`({
    title: document.title,
    platform: document.documentElement.dataset.platform,
    connected: document.querySelector('.footer-status')?.innerText ?? '',
    mods: document.querySelector('.mods-btn:last-child')?.innerText ?? '',
    composer: !!document.querySelector('.composer textarea'),
  })`)
  if (state?.connected === 'Connected') break
  await new Promise((r) => setTimeout(r, 1000))
}
ws.close()
console.log('state:', JSON.stringify(state))

const problems = []
if (state?.title !== 'Radeon Harness') problems.push(`unexpected title: ${state?.title}`)
if (state?.platform !== 'linux') problems.push(`platform is ${state?.platform}, expected linux`)
if (state?.connected !== 'Connected') problems.push('opencode never connected')
if (!/Mods · 3/.test(state?.mods ?? '')) problems.push(`bundled mods not loaded: ${state?.mods}`)
if (!state?.composer) problems.push('composer missing')

if (problems.length) {
  console.error('SMOKE TEST FAILED\n- ' + problems.join('\n- '))
  process.exit(1)
}
console.log('SMOKE TEST PASSED')
