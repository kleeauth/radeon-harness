// Shows how long each turn took in the status bar, and toasts when a long one finishes.
/** @param {import('../../src/mods/types').On} on @param {import('../../src/mods/types').ModApi} $ */
export function register(on, $) {
  on('turn.start', () => {
    $.ui.status('working…')
  })

  on('turn.end', (e) => {
    const secs = (e.durationMs / 1000).toFixed(1)
    $.ui.status(`last turn ${secs}s`)
    if (e.durationMs > 20000) $.ui.toast(`Turn finished in ${secs}s`)
  })
}
