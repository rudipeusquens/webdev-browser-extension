// Where the comment popover goes: next to its target, always fully inside the viewport.

import type { Rect } from '@/lib/collection/model'

interface Size {
  width: number
  height: number
}

const MARGIN = 8
const GAP = 8

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

export function placeNear(target: Rect, size: Size, viewport: Size): { x: number; y: number } {
  const x = clamp(target.x, MARGIN, viewport.width - size.width - MARGIN)
  const below = target.y + target.height + GAP
  const above = target.y - GAP - size.height
  if (below + size.height + MARGIN <= viewport.height) return { x, y: below }
  if (above >= MARGIN) return { x, y: above }
  return { x, y: clamp(below, MARGIN, viewport.height - size.height - MARGIN) }
}

const CHIP_GAP = 6

/** Where the Comment chip goes: below the last line of a selection, ending where it ends. */
export function chipPosition(line: Rect, size: Size, viewport: Size): { x: number; y: number } {
  const x = clamp(line.x + line.width - size.width, MARGIN, viewport.width - size.width - MARGIN)
  const below = line.y + line.height + CHIP_GAP
  const above = line.y - CHIP_GAP - size.height
  const y = below + size.height + MARGIN <= viewport.height || above < MARGIN ? below : above
  return { x, y: clamp(y, MARGIN, viewport.height - size.height - MARGIN) }
}

/** The rectangle spanned by two points, e.g. where a drag started and where it is now. */
export function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}
