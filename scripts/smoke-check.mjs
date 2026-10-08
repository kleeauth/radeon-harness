// Connects to the running app over the DevTools protocol and checks it actually works:
// the window loaded, opencode connected, and the bundled mods were found.
// opencode's first start in a fresh container is slow, so this waits patiently.
const DEBUG = 'http://127.0.0.1:9222'
const deadline = Date.now() + 150_000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let page
while (!page && Date.now() < deadline) {
  try {
    const pages = await (await fetch(`${DEBUG}/json`)).json()
    page = pages.find((p) => p.type === 'page')
  } catch {
    // debug port not up yet
  }
  if (!page) await sleep(1000)
}
if (!page) throw new Error('no app window appeared within 150 seconds')
console.log('window:', page.title)

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
    url: location.protocol,
    platform: document.documentElement.dataset.platform,
    connected: document.querySelector('.footer-status')?.textContent?.trim() ?? '',
    mods: document.querySelector('.mods-btn:last-child')?.textContent?.trim() ?? '',
    composer: !!document.querySelector('.composer textarea'),
    statusScreen: document.querySelector('main h1')?.innerText ?? '',
  })`).catch(() => null)
  if (state?.connected === 'Connected' && /Mods · \d/.test(state?.mods ?? '')) break
  // the startup screen turned into an error: no point waiting further
  if (state?.statusScreen && /couldn't start|stopped/i.test(state.statusScreen)) break
  await sleep(1000)
}
ws.close()
console.log('state:', JSON.stringify(state))

const problems = []
if (state?.title !== 'Radeon Harness') problems.push(`unexpected title: ${state?.title}`)
if (state?.platform !== 'linux') problems.push(`platform is ${state?.platform}, expected linux`)
if (state?.connected !== 'Connected') problems.push(`opencode never connected (screen: ${state?.statusScreen || 'app'})`)
if (!/Mods · 3/.test(state?.mods ?? '')) problems.push(`bundled mods not loaded: ${state?.mods}`)
if (!state?.composer) problems.push('composer missing')

if (problems.length) {
  console.error('SMOKE TEST FAILED\n- ' + problems.join('\n- '))
  process.exit(1)
}
console.log('SMOKE TEST PASSED')
