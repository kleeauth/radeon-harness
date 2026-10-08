// Running cost and token totals for the thread you're looking at, persisted across restarts.
/** @param {import('../../src/mods/types').On} on @param {import('../../src/mods/types').ModApi} $ */
export function register(on, $) {
  const fmtTokens = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))

  const show = (sessionID) => {
    const t = $.state.get(sessionID, { cost: 0, tokens: 0 })
    if (!t.tokens) return $.ui.status(undefined)
    const cost = t.cost > 0 ? `$${t.cost.toFixed(4)} · ` : ''
    $.ui.status(`${cost}${fmtTokens(t.tokens)} tok`)
  }

  on('message.complete', (e) => {
    const t = $.state.get(e.sessionID, { cost: 0, tokens: 0 })
    const add = e.tokens ? e.tokens.input + e.tokens.output : 0
    $.state.set(e.sessionID, { cost: t.cost + (e.cost ?? 0), tokens: t.tokens + add })
    if (e.sessionID === $.activeSession()) show(e.sessionID)
  })

  on('session.start', (e) => show(e.sessionID))
}
