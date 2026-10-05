// Text selections: the selected text with some context around it and the element that holds
// it (spec section 6). Never read with `Selection.toString()`: while a text field has the
// focus, it returns the field's value although the selection looks collapsed.

import type { TextTarget } from '../collection/model'
import { LIMITS } from '../collection/model'
import { collapse } from '../text'
import { closestOf, MAX_DEPTH } from './dom'
import {
  capText,
  elementOf,
  join,
  type Piece,
  readBackward,
  readForward,
  TextReader,
} from './reader'
import { snapshotElement } from './snapshot'

const FIELDS = 'input, textarea, select'
/** Most characters read for the selected text before it is cut. */
const SELECTED_BUDGET = LIMITS.selected * 8

const inField = (node: Node | null) => {
  const el = node && elementOf(node)
  return !!el && closestOf(el, FIELDS) !== null
}

/** The focused element, looking into open shadow roots. */
function focusedElement(doc: Document): Element | null {
  let active = doc.activeElement
  for (let depth = 0; active?.shadowRoot?.activeElement && depth < MAX_DEPTH; depth++) {
    active = active.shadowRoot.activeElement
  }
  return active
}

/**
 * A copy of the page's selection, or null when nothing can be captured: no selection, a
 * collapsed one (also how Chrome reports a selection inside a text field or a shadow root),
 * the focus in a form field, or an end inside one.
 */
export function selectionRange(doc: Document): Range | null {
  const selection = doc.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (range.collapsed || inField(focusedElement(doc))) return null
  if (inField(range.startContainer) || inField(range.endContainer)) return null
  return range.cloneRange()
}

/** The element that holds the whole range, lifted out of shadow trees to their host. */
export function rangeContainer(range: Range): Element {
  let el = elementOf(range.commonAncestorContainer)
  for (let depth = 0; el && depth < MAX_DEPTH; depth++) {
    const root = Node.prototype.getRootNode.call(el)
    if (!(root instanceof ShadowRoot)) break
    el = root.host
  }
  return el ?? (range.startContainer.ownerDocument as Document).documentElement
}

const differ = (a: Piece | undefined, b: Piece | undefined) =>
  a !== undefined && b !== undefined && a.block !== b.block

function contextBefore(text: string, cut: boolean): string {
  const points = [...text]
  if (!cut && points.length <= LIMITS.context) return text.trimStart()
  return `…${points.slice(-LIMITS.context).join('')}`
}

function contextAfter(text: string, cut: boolean): string {
  const points = [...text]
  if (!cut && points.length <= LIMITS.context) return text.trimEnd()
  return `${points.slice(0, LIMITS.context).join('')}…`
}

/** The selected text with its context, or null when it holds no text the page shows. */
export function snapshotRange(range: Range): TextTarget | null {
  const view = range.startContainer.ownerDocument?.defaultView
  if (range.collapsed || !view) return null
  const reader = new TextReader(view, true)
  const common = range.commonAncestorContainer

  const selected = readForward(
    reader,
    common,
    range.startContainer,
    range.startOffset,
    (node) =>
      node === range.endContainer
        ? { stop: false, endOffset: range.endOffset }
        : { stop: range.comparePoint(node, 0) > 0 },
    SELECTED_BUDGET,
  )
  const text = collapse(join(selected.pieces))
  if (!text.trim()) return null

  // The context stays inside the box that holds the selection.
  const root = reader.blockOf(common) ?? common
  const before = readBackward(reader, root, range.startContainer, range.startOffset, LIMITS.context)
  const after = readForward(
    reader,
    root,
    range.endContainer,
    range.endOffset,
    () => ({ stop: false }),
    LIMITS.context * 8,
  )
  // Spaces at the edges of the selection, and between boxes, belong to the context.
  const lead = text.startsWith(' ') || differ(before.pieces.at(-1), selected.pieces[0])
  const trail = text.endsWith(' ') || differ(selected.pieces.at(-1), after.pieces[0])

  return {
    kind: 'text',
    selected: capText(text.trim(), LIMITS.selected, selected.cut),
    before: contextBefore(collapse(`${join(before.pieces)}${lead ? ' ' : ''}`), before.cut),
    after: contextAfter(collapse(`${trail ? ' ' : ''}${join(after.pieces)}`), after.cut),
    container: snapshotElement(rangeContainer(range)),
  }
}
