// Where the items of the current page are now: pins, the highlight, revealing and editing
// all work from these placements.

import { isConnected, queryFirst, rectOf } from '@/lib/capture/dom'
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

/** Pin positions for the targets on screen; a pin that would cover another moves left. */
export function pinPositions(
  pins: { id: string; rect: Rect }[],
  viewport: { width: number; height: number },
): { id: string; x: number; y: number }[] {
  const placed: { id: string; x: number; y: number }[] = []
  for (const { id, rect } of pins) {
    const at = pinPosition(rect, viewport)
    if (!at) continue
    const covers = () =>
      placed.some((p) => Math.abs(p.x - at.x) < SIZE && Math.abs(p.y - at.y) < SIZE)
    for (let tries = 0; covers() && tries < pins.length; tries++) {
      at.x = Math.max(EDGE, at.x - SIZE - GAP)
    }
    placed.push({ id, ...at })
  }
  return placed
}
