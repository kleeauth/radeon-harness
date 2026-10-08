// Electron main process: launches opencode serve, runs a local gateway, opens the window.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { spawn, execSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const net = require('net')
const path = require('path')

const DIST = path.join(__dirname, '..', 'dist')
const APP_TOKEN = crypto.randomBytes(24).toString('hex')
const OPENCODE_PASSWORD = crypto.randomBytes(24).toString('hex')
const basicAuth = 'Basic ' + Buffer.from(`opencode:${OPENCODE_PASSWORD}`).toString('base64')

let opencodeProc = null
let opencodePort = 0
let gatewayPort = 0
let widgetPort = 0

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, headers: { Authorization: basicAuth } }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(body)) : reject(new Error(`HTTP ${res.statusCode}`))))
      })
      .on('error', reject)
  })
}

async function waitForServer(port, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      await getJson(port, '/global/health')
      return
    } catch {
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  throw new Error('opencode server did not become healthy in time')
}

const isWindows = process.platform === 'win32'

// Apps started from a desktop menu (Linux especially) don't get the shell's PATH, so look in
// the usual install locations too. OPENCODE_BIN overrides everything.
function resolveOpencode() {
  if (process.env.OPENCODE_BIN && fs.existsSync(process.env.OPENCODE_BIN)) return process.env.OPENCODE_BIN
  const home = require('os').homedir()
  const names = isWindows ? ['opencode.exe', 'opencode.cmd'] : ['opencode']
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter),
    path.join(home, '.opencode', 'bin'),
    ...(isWindows
      ? [path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'opencode')]
      : [
          path.join(home, '.local', 'bin'),
          path.join(home, '.bun', 'bin'),
          path.join(home, '.npm-global', 'bin'),
          '/usr/local/bin',
          '/usr/bin',
          '/opt/homebrew/bin',
          '/home/linuxbrew/.linuxbrew/bin',
          '/snap/bin',
        ]),
  ].filter(Boolean)
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

let opencodeLog = ''

// ---------- settings ----------
// opencode works inside one folder: the workspace. Without a choice it's the home folder,
// never the folder the app happened to be launched from (an install dir or system32).
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(patch) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2))
}

function workspaceDir() {
  const chosen = readSettings().workspace
  if (chosen && fs.existsSync(chosen) && fs.statSync(chosen).isDirectory()) return chosen
  return require('os').homedir()
}

async function startOpencode() {
  const bin = resolveOpencode()
  if (!bin) {
    throw new Error(
      'opencode was not found.\n\nInstall it from https://opencode.ai, then start Radeon Harness again. ' +
        'If it is installed somewhere unusual, set the OPENCODE_BIN environment variable to its full path.',
    )
  }
  opencodePort = await freePort()
  const args = ['serve', '--port', String(opencodePort), '--hostname', '127.0.0.1']
  const env = { ...process.env, OPENCODE_SERVER_PASSWORD: OPENCODE_PASSWORD }
  const cwd = workspaceDir()
  if (isWindows && /\.cmd$/i.test(bin)) {
    // npm's .cmd shims need cmd.exe; one quoted string avoids the shell+args deprecation (DEP0190)
    opencodeProc = spawn(`"${bin}" ${args.join(' ')}`, { env, cwd, shell: true, windowsHide: true })
  } else {
    // its own process group on Linux/macOS, so stopping it takes any children with it
    opencodeProc = spawn(bin, args, { env, cwd, windowsHide: true, detached: !isWindows })
  }
  const keepLog = (chunk) => {
    opencodeLog = (opencodeLog + chunk.toString()).slice(-2000)
  }
  opencodeProc.stdout?.on('data', keepLog)
  opencodeProc.stderr?.on('data', keepLog)
  opencodeProc.on('error', (err) => keepLog(`\n${err.message}`))
  opencodeProc.on('exit', (code) => {
    if (!app.isQuitting) {
      dialog.showErrorBox('opencode stopped', `The opencode server exited (code ${code}). The app will close.\n\n${opencodeLog.slice(-600)}`)
      app.quit()
    }
  })
  try {
    await waitForServer(opencodePort)
  } catch (err) {
    throw new Error(`${err.message}\n\n${opencodeLog.slice(-600)}`)
  }
}

function stopOpencode() {
  if (!opencodeProc || !opencodeProc.pid) return
  try {
    if (isWindows) execSync(`taskkill /pid ${opencodeProc.pid} /t /f`, { stdio: 'ignore' })
    else process.kill(-opencodeProc.pid, 'SIGTERM') // negative pid: the whole process group
  } catch {
    try {
      opencodeProc.kill('SIGTERM')
    } catch {
      // already gone
    }
  }
  opencodeProc = null
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}

// Only the sanitized model list leaves the gateway. API keys stay in opencode.
async function handleProviders(res) {
  const body = await getJson(opencodePort, '/config/providers')
  const providers = body.providers
    .map((p) => ({
      id: p.id,
      name: p.name,
      models: Object.values(p.models).map((m) => ({ id: m.id, name: m.name })),
    }))
    .filter((p) => p.models.length > 0)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ providers, defaults: body.default ?? {} }))
}

// ---------- live data for widgets ----------
// Widgets have no network of their own. They ask through the app, and the request runs here:
// HTTPS GET only, no cookies, public addresses only, time and size capped.
const dns = require('dns').promises

const FETCH_TIMEOUT_MS = 10000
const FETCH_MAX_BYTES = 2 * 1024 * 1024
const FETCH_MAX_REDIRECTS = 3

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
}

async function assertPublicUrl(raw) {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('only https URLs are allowed')
  if (url.username || url.password) throw new Error('credentials in URLs are not allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true })
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error('local and private network addresses are blocked')
  }
  return url
}

async function readCapped(res) {
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > FETCH_MAX_BYTES) {
      await reader.cancel()
      throw new Error('response larger than 2 MB')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

// text stays text; images and other binary content travel as base64
function isTextual(contentType) {
  return /^text\/|json|xml|javascript|csv|svg/.test(contentType) || contentType === ''
}

async function brokeredFetch(rawUrl) {
  let url = await assertPublicUrl(rawUrl)
  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'RadeonHarness/0.1 (+widget live data)', Accept: 'application/json, text/plain, */*' },
    })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      url = await assertPublicUrl(new URL(location, url).toString()) // every hop is re-checked
      continue
    }
    const contentType = res.headers.get('content-type') || ''
    const bytes = await readCapped(res)
    const textual = isTextual(contentType)
    return {
      ok: res.ok,
      status: res.status,
      url: url.toString(),
      contentType,
      encoding: textual ? 'utf8' : 'base64',
      body: bytes.toString(textual ? 'utf8' : 'base64'),
    }
  }
  throw new Error('too many redirects')
}

function handleWidgetFetch(req, res) {
  let raw = ''
  req.on('data', (c) => {
    raw += c
    if (raw.length > 8192) req.destroy()
  })
  req.on('end', async () => {
    let out
    try {
      const { url } = JSON.parse(raw)
      out = await brokeredFetch(String(url))
    } catch (err) {
      out = { ok: false, status: 0, error: err && err.name === 'TimeoutError' ? 'request timed out' : String(err.message || err) }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out))
  })
}

// ---------- mods ----------
// Each mod is a folder holding mod.json ({ name, description, version }) and mod.js.
function modDirs() {
  const user = path.join(app.getPath('userData'), 'mods')
  fs.mkdirSync(user, { recursive: true })
  return { bundled: path.join(__dirname, '..', 'mods'), user }
}

function listMods() {
  const out = []
  for (const [source, dir] of Object.entries(modDirs())) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      const folder = path.join(dir, name)
      if (!fs.existsSync(path.join(folder, 'mod.js'))) continue
      let meta = {}
      try {
        meta = JSON.parse(fs.readFileSync(path.join(folder, 'mod.json'), 'utf8'))
      } catch {
        // mod.json is optional
      }
      out.push({ name, description: meta.description || '', version: meta.version || '0.0.0', source })
    }
  }
  return out
}

function serveModFile(urlPath, res) {
  // /mods/<source>/<name>/mod.js
  const m = /^\/mods\/(bundled|user)\/([^/]+)\/mod\.js$/.exec(urlPath)
  const dirs = modDirs()
  const file = m && path.join(dirs[m[1]], decodeURIComponent(m[2]), 'mod.js')
  if (!file || !file.startsWith(dirs[m[1]]) || !fs.existsSync(file)) {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}

// Forward everything under /oc/ to opencode, adding auth. Streams pass through unbuffered.
function handleProxy(req, res) {
  const headers = { ...req.headers, authorization: basicAuth }
  delete headers['x-app-token']
  delete headers.host
  const upstream = http.request(
    { host: '127.0.0.1', port: opencodePort, method: req.method, path: req.url.replace(/^\/oc/, '') || '/', headers },
    (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers)
      upRes.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end()
  })
  req.pipe(upstream)
}

function serveStatic(urlPath, res) {
  const safe = path.normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^([/\\])+/, '')
  let file = path.join(DIST, safe)
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html') // SPA fallback
  }
  const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }
  if (file.endsWith('.html')) headers['Content-Security-Policy'] = appCsp()
  res.writeHead(200, headers)
  fs.createReadStream(file).pipe(res)
}

function appCsp() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    `frame-src http://127.0.0.1:${widgetPort}`,
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
}

// Intelligent UI widgets run here: a separate origin, loaded in a sandboxed iframe,
// with a CSP that allows inline code but no network at all.
const WIDGET_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
].join('; ')

const WIDGET_FRAME = `<!doctype html>
<html><head><meta charset="utf-8"></head><body><script>
// Runs before the widget's own code: height reporting plus harness.fetch, the only way out.
// The base style makes the frame invisible: dark scheme (a light one makes Chromium paint a white
// backdrop), transparent page, no page scroll, app font and scrollbars.
// The doctype matters: without it the written document is in quirks mode, where <body> stretches to the
// frame's height, so content could never measure smaller than the frame and widgets only ever grew.
const BASE_STYLE =
  '<!doctype html><meta name="color-scheme" content="dark"><style>' +
  ':root{color-scheme:dark}' +
  'html,body{margin:0;padding:0;background:transparent!important;overflow:hidden}' +
  "body{display:flow-root;color:#ececee;font:14px/1.55 'Inter','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif}" +
  '::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:#3a3a41;border-radius:8px}::-webkit-scrollbar-track{background:transparent}' +
  '</style>'

const BOOTSTRAP = BASE_STYLE + '<script>(' + function () {
  // measure the content itself; the document's scrollHeight never shrinks below the frame and only grows
  // <html> always exists and is content-sized, so it can be observed before <body> is parsed
  const send = () => {
    if (!document.body) return;
    parent.postMessage({ type: 'widget-height', h: Math.ceil(document.body.getBoundingClientRect().height) }, '*');
  };
  new ResizeObserver(send).observe(document.documentElement);
  document.addEventListener('DOMContentLoaded', send);
  window.addEventListener('load', send);

  // a broken widget script must not fail silently: report it so the app can show it
  window.addEventListener('error', (e) => {
    parent.postMessage({ type: 'widget-error', message: String(e.message || 'script error'), line: e.lineno || 0 }, '*');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    parent.postMessage({ type: 'widget-error', message: 'Unhandled promise rejection: ' + reason, line: 0 }, '*');
  });

  let seq = 0;
  const pending = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || e.data.type !== 'widget-fetch-result') return;
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    const r = e.data.result;
    if (!r.status) return p.reject(new Error(r.error || 'request failed'));
    const b64 = r.encoding === 'base64';
    const text = () => (b64 ? new TextDecoder().decode(Uint8Array.from(atob(r.body), (c) => c.charCodeAt(0))) : r.body);
    p.resolve({
      ok: r.ok,
      status: r.status,
      url: r.url,
      headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? r.contentType : null) },
      text: async () => text(),
      json: async () => JSON.parse(text()),
      dataUrl: async () =>
        'data:' + (r.contentType || 'application/octet-stream') + ';base64,' +
        (b64 ? r.body : btoa(String.fromCharCode(...new TextEncoder().encode(r.body)))),
    });
  });
  const harnessFetch = (url) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      parent.postMessage({ type: 'widget-fetch', id, url: String(url) }, '*');
    });
  window.harness = {
    fetch: harnessFetch,
    image: async (url) => {
      const res = await harnessFetch(url);
      if (!res.ok) throw new Error('image request failed: ' + res.status);
      return res.dataUrl();
    },
  };

  // <img src="https://..."> can't load directly (no network); fetch it through the broker instead
  const proxyImage = (img) => {
    const src = img.getAttribute('src');
    if (!src || !src.toLowerCase().startsWith('https://') || img.dataset.harnessSrc === src) return;
    img.dataset.harnessSrc = src;
    window.harness.image(src).then(
      (dataUrl) => {
        if (img.dataset.harnessSrc === src) img.src = dataUrl;
      },
      () => {},
    );
  };
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'IMG') proxyImage(node);
    node.querySelectorAll && node.querySelectorAll('img').forEach(proxyImage);
  };
  new MutationObserver((records) => {
    for (const rec of records) {
      if (rec.type === 'attributes') scan(rec.target);
      else rec.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
} + ')()<\\/script>';
window.addEventListener('message', (e) => {
  if (e.source !== parent || !e.data || e.data.type !== 'widget-render') return;
  document.open();
  document.write(BOOTSTRAP + e.data.html);
  document.close();
});
parent.postMessage({ type: 'widget-ready' }, '*');
</script></body></html>`

function startWidgetHost() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if ((req.url || '').split('?')[0] !== '/frame.html') {
        res.writeHead(404)
        return res.end()
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': WIDGET_CSP,
        'Cache-Control': 'no-store',
      })
      res.end(WIDGET_FRAME)
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function startGateway() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '/'
      const isApi = url.startsWith('/oc/') || url.startsWith('/api/')
      if (isApi && req.headers['x-app-token'] !== APP_TOKEN) {
        res.writeHead(403)
        return res.end()
      }
      if (url === '/api/providers') {
        return handleProviders(res).catch(() => {
          res.writeHead(502)
          res.end()
        })
      }
      if (url === '/api/widget-fetch' && req.method === 'POST') return handleWidgetFetch(req, res)
      if (url === '/api/mods') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ mods: listMods() }))
      }
      if (url.startsWith('/oc/')) return handleProxy(req, res)
      if (url.startsWith('/mods/')) return serveModFile(url.split('?')[0], res)
      serveStatic(url.split('?')[0], res)
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 760,
    minHeight: 520,
    title: 'Radeon Harness',
    icon: windowIcon(),
    backgroundColor: '#0e0e10',
    show: false,
    // frameless with native window buttons drawn over the top bar
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#b4b4ba', height: 40 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  // links in replies open in the real browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.loadURL(`http://127.0.0.1:${gatewayPort}/`)
}

ipcMain.on('app:open-mods', () => {
  shell.openPath(modDirs().user)
})

ipcMain.on('app:config', (event) => {
  event.returnValue = {
    token: APP_TOKEN,
    widgetOrigin: `http://127.0.0.1:${widgetPort}`,
    workspace: workspaceDir(),
    modsDir: modDirs().user,
  }
})

// switching folders restarts the app so opencode starts fresh inside the new one
ipcMain.handle('app:choose-workspace', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose a workspace folder',
    defaultPath: workspaceDir(),
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0] || result.filePaths[0] === workspaceDir()) return false
  writeSettings({ workspace: result.filePaths[0] })
  app.relaunch()
  app.quit()
  return true
})

// Windows groups taskbar buttons and names the jump list by this id. It must match build.appId in
// package.json, which the installer stamps on the Start menu and desktop shortcuts.
const APP_ID = 'io.github.cloverscripts.radeonharness'
app.setName('Radeon Harness')
if (isWindows) app.setAppUserModelId(APP_ID)

// packaged builds carry the icon in the exe; dev runs (`electron .`) need it on the window
function windowIcon() {
  const icon = path.join(__dirname, '..', 'build', 'icon.png')
  return !app.isPackaged && fs.existsSync(icon) ? icon : undefined
}

// One app at a time: a second launch focuses the existing window instead of starting another opencode.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return
  try {
    await startOpencode()
    widgetPort = await startWidgetHost()
    gatewayPort = await startGateway()
    createWindow()
  } catch (err) {
    dialog.showErrorBox('Could not start', String(err))
    app.quit()
  }
})

app.on('before-quit', () => {
  app.isQuitting = true
  stopOpencode()
})

app.on('window-all-closed', () => app.quit())
