// The brief sent by /mod: everything the model needs to write a working Radeon Harness mod in one go.
export function buildModPrompt(request: string, modsDir: string): string {
  return `Create a Radeon Harness mod that does this: ${request}

Write it into its own new folder inside this directory (create the folder; pick a short kebab-case name that describes the mod):
${modsDir}

The folder needs exactly two files:

1. \`mod.json\`
\`\`\`json
{ "name": "<folder-name>", "version": "0.1.0", "description": "<one line>" }
\`\`\`

2. \`mod.js\`: an ES module exporting \`register(on, $)\`. Plain JavaScript, no imports, no Node APIs, no DOM access. It runs inside the app's interface.

\`\`\`js
export function register(on, $) {
  // hooks and commands go here
}
\`\`\`

## Hooks: on(event, (e, next) => ...)
Return nothing to let the event continue unchanged, return null to swallow it, or return next({ ...e, changes }) to pass on a changed event.

| event | e | notes |
| --- | --- | --- |
| session.start | { sessionID } | a thread was opened or created |
| prompt.submit | { sessionID, text } | before a prompt is sent; rewrite text or return null to cancel it |
| turn.start | { sessionID } | the model started working |
| turn.end | { sessionID, durationMs } | the model finished |
| tool.result | { sessionID, tool, status: 'completed' or 'error', title, durationMs } | a tool call finished |
| message.complete | { sessionID, text, cost, tokens: { input, output } } | an assistant reply finished |

## The $ API
- $.ui.status(text): set this mod's entry in the status line under the composer; $.ui.status(undefined) clears it
- $.ui.toast(text): show a toast for a few seconds
- $.ui.band({ text, tone }): show a band above the composer, tone is 'info', 'warn' or 'accent'; $.ui.band(null) removes it
- $.command.register({ name, description, run: (args, $) => result }): add a slash command; run may return { prompt: '...' } to send a prompt to the model, { text: '...' } to show a note, or nothing
- $.state.get(key, fallback) / $.state.set(key, value): persistent storage for this mod, JSON values only
- $.activeSession(): the id of the thread on screen, or null
- setTimeout / setInterval are available for timers

## Example
\`\`\`js
export function register(on, $) {
  let count = $.state.get('count', 0)
  $.ui.status(\`\${count} prompts sent\`)
  on('prompt.submit', (e) => {
    count += 1
    $.state.set('count', count)
    $.ui.status(\`\${count} prompts sent\`)
  })
  $.command.register({
    name: 'reset-count',
    description: 'Reset the prompt counter',
    run: () => { count = 0; $.state.set('count', 0); $.ui.status('0 prompts sent'); return { text: 'Counter reset' } },
  })
}
\`\`\`

Rules:
- Slash command names: lowercase, no spaces, and not one of: new, mods, ui, mod.
- Catch your own errors in timers and async code so one failure doesn't break the mod.
- Keep it small and focused on the request.

When the files are written, reply with: the mod's name, what it does, and the slash commands it adds. The app reloads mods automatically after your reply.`
}
