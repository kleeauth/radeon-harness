// Slash commands, plus a prompt-rewriting mode that shows a band above the composer.
/** @param {import('../../src/mods/types').On} on @param {import('../../src/mods/types').ModApi} $ */
export function register(on, $) {
  let terse = $.state.get('terse', false)
  const syncBand = () =>
    $.ui.band(terse ? { text: 'Terse mode: answers are kept short. /terse to turn off.', tone: 'accent' } : null)
  syncBand()

  $.command.register({
    name: 'widget',
    description: 'Build an interactive widget for something',
    run: (args) =>
      args.trim()
        ? { prompt: `Build an interactive widget for: ${args.trim()}. Use a widget block, with a one-line lead-in.` }
        : { text: 'Usage: /widget <what to build>, e.g. /widget loan calculator' },
  })

  $.command.register({
    name: 'explain',
    description: 'Explain a file, concept or error step by step',
    run: (args) => ({ prompt: `Explain step by step, plainly and concretely: ${args.trim() || 'this project'}` }),
  })

  $.command.register({
    name: 'terse',
    description: 'Toggle terse mode (short answers)',
    run: () => {
      terse = !terse
      $.state.set('terse', terse)
      syncBand()
      $.ui.toast(terse ? 'Terse mode on' : 'Terse mode off')
    },
  })

  // rewrite outgoing prompts while terse mode is on
  on('prompt.submit', (e, next) => {
    if (!terse) return next(e)
    return next({ ...e, text: `${e.text}\n\n(Answer as briefly as possible. No preamble.)` })
  })
}
