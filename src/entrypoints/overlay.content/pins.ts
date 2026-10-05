// Numbered pins on marked elements of the current page.

import { isConnected } from '@/lib/capture/dom'
import type { Annotation, Rect } from '@/lib/collection/model'

/**
 * The element of each item: the one marked in this session while it is still on the page,
 * else the first match of the stored selector. Items without a match get no pin.
 */
export function resolveTargets(
  items: Annotation[],
  live: Map<string, Element>,
  doc: Document,
): Map<string, Element> {
  const found = new Map<string, Element>()
  for (const item of items) {
    if (item.target.kind !== 'element') continue
    const marked = live.get(item.id)
    if (marked && isConnected(marked)) {
      found.set(item.id, marked)
      continue
    }
    try {
      const el = doc.querySelector(item.target.element.selector)
      if (el) found.set(item.id, el)
    } catch {
      // A selector the browser cannot parse: no pin.
    }
  }
  return found
}

const SIZE = 20
const EDGE = 4

/** Top-left of a pin centered on the target's top-right corner; null when it is off-screen. */
export function pinPosition(
  rect: Rect,
  viewport: { width: number; height: number },
): { x: number; y: number } | null {
  const outside =
    rect.y + rect.height < 0 ||
    rect.y > viewport.height ||
    rect.x + rect.width < 0 ||
    rect.x > viewport.width
  if (outside) return null
  const clamp = (value: number, max: number) => Math.max(EDGE, Math.min(value, max - SIZE - EDGE))
  return {
    x: clamp(rect.x + rect.width - SIZE / 2, viewport.width),
    y: clamp(rect.y - SIZE / 2, viewport.height),
  }
}
