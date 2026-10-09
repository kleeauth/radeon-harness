import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

type Options = {
  width: number | 'anchor' // a fixed width, or as wide as the anchor
  maxHeight: number
  gap?: number
}

// Positions a dropdown on the page itself (rendered through a portal), next to its anchor:
// above when there's room, below otherwise, always inside the window. Split panes and scroll
// areas can't clip it this way.
export function useFloating(anchor: RefObject<HTMLElement | null>, open: boolean, opts: Options): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const { width, maxHeight, gap = 8 } = opts

  useLayoutEffect(() => {
    if (!open) return setStyle(null)
    const place = () => {
      const el = anchor.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const margin = 8
      const w = Math.min(width === 'anchor' ? r.width : width, window.innerWidth - margin * 2)
      const left = Math.min(Math.max(r.left, margin), window.innerWidth - w - margin)
      const above = r.top - gap - margin
      const below = window.innerHeight - r.bottom - gap - margin
      const up = above >= Math.min(maxHeight, 240) || above >= below
      const height = Math.max(120, Math.min(maxHeight, up ? above : below))
      setStyle({
        position: 'fixed',
        left,
        width: w,
        maxHeight: height,
        ...(up ? { bottom: window.innerHeight - r.top + gap } : { top: r.bottom + gap }),
        transformOrigin: up ? 'bottom left' : 'top left',
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, open, width, maxHeight, gap])

  return style
}
