# Radeon Harness

A desktop app for [opencode](https://opencode.ai): a clean, dark, Codex-style interface on top of opencode's server, with interactive answers and a mod system.

Radeon Harness launches opencode itself, so there is no terminal step. Every model you have configured in opencode is available from the model picker.

## Features

- **Codex-style interface.** A collapsible thread sidebar, a conversation column, and a floating composer with a searchable model picker. Replies render as markdown with copyable code blocks, collapsible tool calls, and reasoning.
- **Intelligent UI.** When it helps, the model answers with live interactive widgets (calculators, charts, comparisons, small games) rendered inline in the chat. Toggle it from the composer or with `/ui`.
- **Live data in widgets.** Widgets can fetch real data from public HTTPS APIs through `harness.fetch()`. You approve each new site once.
- **Mods.** Extend the app with small JavaScript modules: rewrite prompts, react to turns and tool calls, add slash commands, and draw into the status line, toasts, and a band above the composer.
- **Slash commands.** Type `/` for app commands, mod commands, and your opencode commands.
- **Permissions.** Tool permission requests from opencode appear inline with Allow once, Always allow, and Deny.

## Download

Grab the latest build from [Releases](https://github.com/kleeauth/radeon-harness/releases).

| Platform | File | Notes |
| --- | --- | --- |
| Windows 10 / 11 (x64, ARM64, 32-bit) | `Radeon-Harness-…-setup-<arch>.exe` | Installer. Per-user, no admin rights needed. |
| Windows, no install | `Radeon-Harness-…-portable-x64.exe` | Runs from anywhere, e.g. a USB stick. |
| Linux, any distro (x64, ARM64) | `Radeon-Harness-…-linux-<arch>.AppImage` | `chmod +x` it and run. |
| Debian, Ubuntu, Mint, Pop!_OS | `.deb` | `sudo apt install ./Radeon-Harness-….deb` |
| Fedora, RHEL, openSUSE | `.rpm` | `sudo dnf install ./Radeon-Harness-….rpm` |
| Arch and anything else | `.tar.gz` | Extract and run `radeon-harness`. |

The builds aren't code-signed yet, so Windows SmartScreen may warn on first launch: choose **More info → Run anyway**.

**Fedora:** install the `.rpm` with `sudo dnf install ./Radeon-Harness-*.rpm`, then start **Radeon Harness** from the app grid or run `radeon-harness`. Install opencode first (`curl -fsSL https://opencode.ai/install | bash` or `npm install -g opencode-ai`). Every release is installed and launched on Fedora in CI before it's published.

On Ubuntu 24.04 and newer, AppImages can fail to start because of a sandbox restriction. Use the `.deb` there, or start the AppImage with `--no-sandbox`. Older AppImage setups also need FUSE (`sudo apt install libfuse2`).

Windows 7 and 8.1 aren't supported: the Electron runtime this app is built on requires Windows 10 or newer.

## Requirements

- [opencode](https://opencode.ai) installed, with at least one provider configured (`opencode auth login`). The app finds it on your `PATH` and in the usual install locations. If yours is somewhere else, set `OPENCODE_BIN` to its full path.
- To build from source: Node.js 20 or newer

## Workspace

opencode works inside one folder, shown at the top of the sidebar. It starts as your home folder; click it to switch to a project folder. The app restarts into the new folder, and your threads are listed per folder.

## Run from source

```bash
git clone https://github.com/kleeauth/radeon-harness.git
cd radeon-harness
npm install
npm run app
```

`npm run app` builds the interface and starts the desktop app. The app starts its own opencode server on a free localhost port with a random password, and stops it when you close the window.

Keyboard: `Ctrl+N` new thread, `Ctrl+B` toggle sidebar, `/` commands, `Shift+Enter` newline.

## How it works

```
Electron main process
 ├─ spawns `opencode serve` on 127.0.0.1 with a random per-launch password
 ├─ gateway (127.0.0.1, random port)
 │   ├─ serves the interface
 │   ├─ /oc/*               → proxied to opencode, auth added server-side
 │   ├─ /api/providers      → model list with API keys stripped
 │   ├─ /api/widget-fetch   → live data broker for widgets
 │   └─ /api/mods, /mods/*  → mod listing and code
 └─ widget host (separate origin, random port) → sandboxed frame for widgets
```

API requests need a per-launch token that only the app's own window receives, so other local software and web pages can't drive your opencode instance through the app.

## Intelligent UI and widgets

With Intelligent UI on, the model is told it may answer with a fenced `widget` block containing a self-contained HTML fragment. Widgets run in a sandboxed iframe on a separate origin with a Content Security Policy that blocks all direct network access. They can't reach the app, its storage, or your opencode server.

Remote images work with a plain `<img src="https://…">`: the app loads them through the same broker. For live data, widgets call:

```js
const res = await harness.fetch('https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m')
const data = await res.json()
```

The request runs in the main process with strict limits: HTTPS GET only, no cookies or credentials, public addresses only (localhost and private networks are blocked, including through redirects), a 10 second timeout, and a 2 MB response cap. The first request to each site asks you to Allow, Always allow, or Block.

## Mods

A mod is a folder containing `mod.js` and an optional `mod.json`. Bundled mods live in [`mods/`](mods). Your own go in the app's mods folder: open it from **Mods → Open folder**.

```js
// mods/hello/mod.js
export function register(on, $) {
  $.command.register({
    name: 'hello',
    description: 'Say hello',
    run: (args) => ({ prompt: `Say hello to ${args || 'me'} in one sentence.` }),
  })

  on('prompt.submit', (e, next) => next({ ...e, text: e.text.trim() }))

  on('turn.end', (e) => $.ui.toast(`Done in ${(e.durationMs / 1000).toFixed(1)}s`))
}
```

```json
{ "name": "hello", "version": "0.1.0", "description": "A friendly example" }
```

| API | What it does |
| --- | --- |
| `on(event, (e, next) => …)` | Hook an event. Return nothing to continue, `null` to swallow it, or `next({ ...e })` to pass on a changed event. |
| `$.ui.status(text)` | Set this mod's entry in the status line under the composer (`undefined` clears it). |
| `$.ui.toast(text)` | Show a toast. |
| `$.ui.band({ text, tone })` | Show a band above the composer (`null` clears it). Tones: `info`, `warn`, `accent`. |
| `$.command.register({ name, description, run })` | Add a slash command. `run` may return `{ prompt }` to send a prompt or `{ text }` to show a note. |
| `$.state.get(key, fallback)` / `$.state.set(key, value)` | Persistent per-mod storage. |
| `$.activeSession()` | The id of the thread on screen, if any. |

Events: `session.start`, `prompt.submit`, `turn.start`, `turn.end`, `tool.result`, `message.complete`. Their shapes are in [`src/mods/types.ts`](src/mods/types.ts).

Mods run with the same access as the app's interface, so only install mods you trust.

## Development

```bash
npm run dev      # interface only, in a browser, proxied to an opencode server you start yourself
npm run build    # typecheck and build the interface
npm run app      # build and run the desktop app
npm run dist:win    # Windows installers into release/
npm run dist:linux  # Linux packages into release/ (needs Linux, or use the Release workflow)
```

Pushing a tag like `v0.1.0` runs the [Release workflow](.github/workflows/release.yml), which builds every Windows and Linux package on GitHub's runners and attaches them to a GitHub Release.

For `npm run dev`, start `opencode serve` yourself and put its address and password in `.env.local` (see [`.env.example`](.env.example)). Widgets and mods need the desktop app.

## License

[MIT](LICENSE)

Radeon Harness is an independent project. It is not affiliated with or endorsed by opencode or AMD.
