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
