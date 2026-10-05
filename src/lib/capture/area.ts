// Areas: the rectangle the developer dragged, the smallest element that holds it and the
// topmost elements fully inside it (spec section 6). Rectangles are in viewport
// coordinates until the snapshot stores them in page coordinates.

import type { AreaTarget, Rect } from '../collection/model'
import { LIMITS } from '../collection/model'
import { childrenOf, MAX_DEPTH, parentOf, rectOf } from './dom'
import { snapshotElement } from './snapshot'

/** Most elements one search looks at; the count of elements inside stops there. */
export const AREA_BUDGET = 10_000
/** Boxes may stick out this far and still count as inside: drags are not pixel-exact. */
const TOLERANCE = 1

const rendered = (el: Element) => Element.prototype.checkVisibility?.call(el) ?? true
const shown = (el: Element) =>
  Element.prototype.checkVisibility?.call(el, { checkVisibilityCSS: true }) ?? true

function holds(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x + TOLERANCE &&
    outer.y <= inner.y + TOLERANCE &&
    outer.x + outer.width >= inner.x + inner.width - TOLERANCE &&
    outer.y + outer.height >= inner.y + inner.height - TOLERANCE
  )
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const isEmpty = (r: Rect) => r.width === 0 || r.height === 0

/**
 * The element that holds the rectangle: from the topmost page element at its center (hit
 * testing skips `pointer-events: none` layers such as toast containers) up to the first
 * whose box holds the whole rectangle; `body` when none does.
 */
export function areaContainer(doc: Document, rect: Rect, skip?: Element): Element {
  const body = doc.body ?? doc.documentElement
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const hit = doc.elementsFromPoint(center.x, center.y).find((el) => el !== skip)
  let el: Element | null = hit ?? null
  for (let depth = 0; el && el !== body && depth < MAX_DEPTH; depth++, el = parentOf(el)) {
    if (el === doc.documentElement) break
    if (holds(rectOf(el), rect)) return el
  }
  return body
}

/**
 * The topmost elements fully inside `rect` (an element counts if it is inside and its parent
 * is not), in document order: the first `LIMITS.areaElements`, and how many there were up
 * to `budget` visited elements.
 */
export function elementsInside(
  container: Element,
  rect: Rect,
  skip?: Element,
  budget = AREA_BUDGET,
): { elements: Element[]; total: number } {
  const elements: Element[] = []
  let total = 0
  // Depth first in document order, without recursion: pages can nest deeply.
  const stack = childrenOf(container).reverse()
  for (let visited = 0; stack.length > 0 && visited < budget; visited++) {
    const el = stack.pop() as Element
    if (el === skip || !rendered(el)) continue
    const box = rectOf(el)
    const inside = !isEmpty(box) && holds(rect, box)
    if (inside && shown(el)) {
      total++
      if (elements.length < LIMITS.areaElements) elements.push(el)
      continue
    }
    // Zero-size wrappers (`display: contents`), hidden elements and boxes that reach into the
    // rectangle may hold elements inside it; boxes elsewhere do not.
    if (isEmpty(box) || inside || overlaps(box, rect)) stack.push(...childrenOf(el).reverse())
  }
  return { elements, total }
}

/** The area target for a rectangle in viewport coordinates, and the element that holds it. */
export function snapshotArea(
  doc: Document,
  rect: Rect,
  skip?: Element,
): { target: AreaTarget; container: Element } {
  const container = areaContainer(doc, rect, skip)
  const { elements, total } = elementsInside(container, rect, skip)
  const view = doc.defaultView
  return {
    container,
    target: {
      kind: 'area',
      rect: {
        x: Math.round(rect.x + (view?.scrollX ?? 0)),
        y: Math.round(rect.y + (view?.scrollY ?? 0)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      container: snapshotElement(container),
      elements: elements.map((el) => snapshotElement(el)),
      moreCount: total - elements.length,
    },
  }
}
