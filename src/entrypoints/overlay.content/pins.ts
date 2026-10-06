// Where the items of the current page are now: pins, the highlight, revealing and editing
// all work from these placements.

import {
  isConnected,
  MAX_DEPTH,
  ownerDocumentOf,
  parentOf,
  queryFirst,
  rectOf,
} from '@/lib/capture/dom'
import { rangeContainer } from '@/lib/capture/text'
import type { Annotation, Rect } from '@/lib/collection/model'

/** What was marked in this session: more precise than the stored selector. */
export type LiveAnchor = Element | Range

export interface Placement {
  /** The element that holds the target: scrolled into view, searched for focus traps. */
  el: Element
  /** The target's box in viewport coordinates, read when asked. */
  rect(): Rect
  /** The selection of a text item marked in this session. */
  range?: Range
}

const toRect = (r: DOMRect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height })

export const boxOf = (el: Element): Rect => toRect(rectOf(el))

const onElement = (el: Element): Placement => ({ el, rect: () => boxOf(el) })

const liveElement = (anchor: LiveAnchor | undefined) =>
  anchor instanceof Element && isConnected(anchor) ? anchor : undefined

/** A selection still on the page: a range whose nodes were removed collapses into their parent. */
export const isLiveRange = (anchor: LiveAnchor | undefined): anchor is Range =>
  anchor instanceof Range && !anchor.collapsed && anchor.startContainer.isConnected

const liveRange = (anchor: LiveAnchor | undefined) => (isLiveRange(anchor) ? anchor : undefined)

function place(item: Annotation, anchor: LiveAnchor | undefined, doc: Document) {
  const { target } = item
  switch (target.kind) {
    case 'element': {
      const el = liveElement(anchor) ?? queryFirst(doc, target.element.selector)
      return el && onElement(el)
    }
    case 'text': {
      const range = liveRange(anchor)
      if (range) {
        return {
          el: rangeContainer(range),
          range,
          rect: () => toRect(range.getBoundingClientRect()),
        }
      }
      const el = queryFirst(doc, target.container.selector)
      return el && onElement(el)
    }
    case 'area': {
      const el = liveElement(anchor) ?? queryFirst(doc, target.container.selector)
      if (!el) return null
      // The area keeps its place inside the container, both stored in page coordinates.
      const dx = target.rect.x - target.container.box.x
      const dy = target.rect.y - target.container.box.y
      const { width, height } = target.rect
      return {
        el,
        rect: () => {
          const box = boxOf(el)
          return { x: box.x + dx, y: box.y + dy, width, height }
        },
      }
    }
  }
}

/**
 * The placement of each item: what was marked in this session while it is still on the page,
 * else the first match of the stored selector (the container's for text and areas). Items
 * without a match get none.
 */
export function placeItems(
  items: Annotation[],
  live: Map<string, LiveAnchor>,
  doc: Document,
): Map<string, Placement> {
  const found = new Map<string, Placement>()
  for (const item of items) {
    const placement = place(item, live.get(item.id), doc)
    if (placement) found.set(item.id, placement)
  }
  return found
}

/** Forgets what was marked for items that no longer exist. */
export function pruneLive(live: Map<string, LiveAnchor>, items: Annotation[]) {
  const ids = new Set(items.map((item) => item.id))
  for (const id of live.keys()) if (!ids.has(id)) live.delete(id)
}

const SIZE = 20
const EDGE = 4
const GAP = 2

const CLIPPING = /hidden|scroll|auto|clip|overlay/

/**
 * The boxes that clip `el`, innermost first: scroll containers and `overflow: hidden`
 * ancestors. An absolutely positioned box escapes ancestors up to its containing block (the
 * nearest positioned or transformed one); a fixed element ends the walk (it is placed against
 * the viewport), and so do `body` and `html` (their overflow is the viewport's). `withSelf`
 * adds `el` itself, for a target inside its content (text) rather than `el`'s own box.
 */
export function clippersOf(el: Element, withSelf = false): Element[] {
  const doc = ownerDocumentOf(el)
  const view = doc.defaultView
  const clippers: Element[] = []
  // Above an absolutely positioned box, until its containing block.
  let escaping = false
  let node: Element | null = el
  for (let depth = 0; node && view && depth < MAX_DEPTH; depth++) {
    const style = view.getComputedStyle(node)
    const positioned =
      (style.position !== '' && style.position !== 'static') ||
      (style.transform !== '' && style.transform !== 'none')
    // The shorthand too: happy-dom (unit tests) does not expand it.
    const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`
    const own = node === el
    if ((!own || withSelf) && CLIPPING.test(overflow) && (!escaping || positioned)) {
      clippers.push(node)
    }
    if (style.position === 'fixed') break
    if (style.position === 'absolute') escaping = true
    else if (positioned) escaping = false
    node = parentOf(node)
    if (node === doc.body || node === doc.documentElement) break
  }
  return clippers
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

/** Width of the line around a pinned target; it is drawn just outside the target. */
const LINE = 2

export interface OutlineBox extends Rect {
  /** The sides with a line: none where a scroll container or the viewport cuts the target. */
  sides: { top: boolean; right: boolean; bottom: boolean; left: boolean }
}

/**
 * The outline of a pinned target: the visible part of `rect` inside `bounds`, grown by the
 * line on the sides that are not cut off. Null when nothing of the target is visible there or
 * the target has no box (not rendered).
 */
export function outlineBox(rect: Rect, bounds: Rect): OutlineBox | null {
  if (rect.width === 0 || rect.height === 0) return null
  const visible = intersect(rect, bounds)
  if (!visible) return null
  const sides = {
    top: rect.y >= bounds.y,
    right: rect.x + rect.width <= bounds.x + bounds.width,
    bottom: rect.y + rect.height <= bounds.y + bounds.height,
    left: rect.x >= bounds.x,
  }
  const line = (on: boolean) => (on ? LINE : 0)
  return {
    x: visible.x - line(sides.left),
    y: visible.y - line(sides.top),
    width: visible.width + line(sides.left) + line(sides.right),
    height: visible.height + line(sides.top) + line(sides.bottom),
    sides,
  }
}

/** The parts of `boxes` (the lines of a selected text) that lie inside `bounds`. */
export function clipBoxes(boxes: Rect[], bounds: Rect): Rect[] {
  return boxes.flatMap((box) => {
    const inside = box.width > 0 && box.height > 0 ? intersect(box, bounds) : null
    return inside ? [inside] : []
  })
}

/** The part of the viewport that `clippers` let through, or null when nothing is visible. */
export function visibleBounds(clippers: Element[], viewport: Rect): Rect | null {
  let bounds: Rect | null = viewport
  for (const clipper of clippers) {
    bounds = bounds && intersect(bounds, boxOf(clipper))
  }
  return bounds
}

/**
 * Top-left of a pin centered on the target's top-right corner, kept inside `bounds` (the
 * visible part of the viewport); null when no part of the target is visible there or the
 * target has no box (not rendered).
 */
export function pinPosition(rect: Rect, bounds: Rect): { x: number; y: number } | null {
  if (rect.width === 0 || rect.height === 0) return null
  const outside =
    rect.y + rect.height <= bounds.y ||
    rect.y >= bounds.y + bounds.height ||
    rect.x + rect.width <= bounds.x ||
    rect.x >= bounds.x + bounds.width
  if (outside) return null
  const clamp = (value: number, start: number, size: number) =>
    Math.max(start + EDGE, Math.min(value, start + size - SIZE - EDGE))
  return {
    x: clamp(rect.x + rect.width - SIZE / 2, bounds.x, bounds.width),
    y: clamp(rect.y - SIZE / 2, bounds.y, bounds.height),
  }
}

/** Pin positions for the targets on screen; a pin that would cover another moves left. */
export function pinPositions(
  pins: { id: string; rect: Rect; bounds: Rect | null }[],
): { id: string; x: number; y: number }[] {
  const placed: { id: string; x: number; y: number }[] = []
  for (const { id, rect, bounds } of pins) {
    const at = bounds && pinPosition(rect, bounds)
    if (!at || !bounds) continue
    const covers = () =>
      placed.some((p) => Math.abs(p.x - at.x) < SIZE && Math.abs(p.y - at.y) < SIZE)
    for (let tries = 0; covers() && tries < pins.length; tries++) {
      at.x = Math.max(bounds.x + EDGE, at.x - SIZE - GAP)
    }
    placed.push({ id, ...at })
  }
  return placed
}
