// Browser globals that can't be redeclared: `let top = 8` at a script's top level is a SyntaxError,
// so the whole script silently never runs. Inside a block scope the same declaration is fine.
const LOCKED = '(?:top|window|document|location)'

// `let top`, `const document`, or a declaration list like `let w = 1, top = 8`
const DECLARES_LOCKED = new RegExp(
  `\\b(?:let|const|class)\\s+${LOCKED}\\b|\\b(?:let|const)\\b[^;]*?[,\\s]${LOCKED}\\s*=(?!=)`,
)

const INLINE_SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi

export function prepareWidgetHtml(html: string): string {
  return html.replace(INLINE_SCRIPT, (whole, attrs: string | undefined, code: string) => {
    // leave modules, external and non-JS scripts alone
    if (attrs && /\b(?:src|type)\s*=/i.test(attrs) && !/type\s*=\s*["']?text\/javascript/i.test(attrs)) return whole
    if (!DECLARES_LOCKED.test(code)) return whole
    return `<script${attrs ?? ''}>{\n${code}\n}</script>`
  })
}
