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

## Requirements

- [opencode](https://opencode.ai) installed and on your `PATH` (`opencode --version` should work), with at least one provider configured (`opencode auth login`)
- Node.js 20 or newer

## Run it

```bash
git clone https://github.com/cloverscripts/radeon-harness.git
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

For live data, widgets call:

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
```

For `npm run dev`, start `opencode serve` yourself and put its address and password in `.env.local` (see [`.env.example`](.env.example)). Widgets and mods need the desktop app.

## License

[MIT](LICENSE)

Radeon Harness is an independent project. It is not affiliated with or endorsed by opencode or AMD.
