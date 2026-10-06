// Text selections: the selected text with some context around it and the element that holds
// it (spec section 6). Never read with `Selection.toString()`: while a text field has the
// focus, it returns the field's value although the selection looks collapsed.

import type { TextTarget } from '../collection/model'
import { LIMITS } from '../collection/model'
import { collapse } from '../text'
import { closestOf, deepActiveElement, documentOf, MAX_DEPTH } from './dom'
import {
  capText,
  elementOf,
  join,
  type Piece,
  readBackward,
  readForward,
  TextReader,
  type Until,
} from './reader'
import { snapshotElement } from './snapshot'

const FIELDS = 'input, textarea, select'
/** Most characters read for the selected text before it is cut. */
const SELECTED_BUDGET = LIMITS.selected * 8

const inField = (node: Node | null) => {
  const el = node && elementOf(node)
  return !!el && closestOf(el, FIELDS) !== null
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
  if (range.collapsed || inField(deepActiveElement(doc))) return null
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
  return el ?? documentOf(range.startContainer).documentElement
}

/** Stops a forward walk at the end of `range`. */
const untilEndOf =
  (range: Range) =>
  (node: Node): Until =>
    node === range.endContainer
      ? { stop: false, endOffset: range.endOffset }
      : { stop: range.comparePoint(node, 0) > 0 }

const differ = (a: Piece | undefined, b: Piece | undefined) =>
  a !== undefined && b !== undefined && a.block !== b.block

type TextPiece = Piece & { node: Text; start: number }

const VISIBLE = /\S/
const hasText = (p: Piece): p is TextPiece => p.node !== undefined && VISIBLE.test(p.text)

/** Where in its node the piece's first and last visible characters are. */
const firstAt = (p: TextPiece) => p.start + p.text.search(VISIBLE)
const endAt = (p: TextPiece) => p.start + p.text.trimEnd().length

function lastWithText(pieces: Piece[]): TextPiece | undefined {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i] as Piece
    if (hasText(piece)) return piece
  }
  return undefined
}

/** A range over the last visible character of `piece`. */
function lastCharacter(doc: Document, piece: TextPiece): Range {
  const end = endAt(piece)
  // A character outside the basic plane takes two code units.
  const low = /[\uDC00-\uDFFF]/.test(piece.node.data.charAt(end - 1))
  const range = doc.createRange()
  range.setStart(piece.node, Math.max(piece.start, end - (low ? 2 : 1)))
  range.setEnd(piece.node, end)
  return range
}

/** A range over the first visible character of `piece`. */
function firstCharacter(doc: Document, piece: TextPiece): Range {
  const start = firstAt(piece)
  const high = /[\uD800-\uDBFF]/.test(piece.node.data.charAt(start))
  const range = doc.createRange()
  range.setStart(piece.node, start)
  range.setEnd(piece.node, start + (high ? 2 : 1))
  return range
}

/**
 * Where the Comment chip goes: the last character the range shows, else (when hidden
 * content fills the end) the first. Null when the range shows no text. Measuring the whole
 * selection on every frame would cost too much on a long one; both walks are bounded.
 */
export function chipAnchor(range: Range): Range | null {
  const doc = documentOf(range.startContainer)
  const view = doc.defaultView
  if (range.collapsed || !view) return null
  const reader = new TextReader(view, true)
  const root = range.commonAncestorContainer
  const back = readBackward(reader, root, range.endContainer, range.endOffset, LIMITS.context)
  const last = lastWithText(back.pieces)
  if (last) {
    const char = lastCharacter(doc, last)
    // Text before the start of the range is not part of the selection.
    return range.comparePoint(char.startContainer, char.startOffset) >= 0 ? char : null
  }
  const ahead = readForward(
    reader,
    root,
    range.startContainer,
    range.startOffset,
    untilEndOf(range),
    LIMITS.context,
  )
  const first = ahead.pieces.find(hasText)
  return first ? firstCharacter(doc, first) : null
}

/** Whether two ranges cover the same part of the page. */
export function sameRange(a: Range, b: Range): boolean {
  try {
    return (
      a.compareBoundaryPoints(Range.START_TO_START, b) === 0 &&
      a.compareBoundaryPoints(Range.END_TO_END, b) === 0
    )
  } catch {
    // Ranges in different trees.
    return false
  }
}

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

export interface CapturedText {
  target: TextTarget
  /**
   * The part of the selection that was read, from its first to its last visible character:
   * a triple-click ends at the start of the next block, a huge selection is read only in part.
   */
  range: Range
}

/** The selected text with its context, or null when it holds no text the page shows. */
export function snapshotRange(range: Range): CapturedText | null {
  const doc = documentOf(range.startContainer)
  const view = doc.defaultView
  if (range.collapsed || !view) return null
  const reader = new TextReader(view, true)

  const selected = readForward(
    reader,
    range.commonAncestorContainer,
    range.startContainer,
    range.startOffset,
    untilEndOf(range),
    SELECTED_BUDGET,
  )
  const first = selected.pieces.find(hasText)
  const last = lastWithText(selected.pieces)
  if (!first || !last) return null
  const read = doc.createRange()
  read.setStart(first.node, firstAt(first))
  read.setEnd(last.node, endAt(last))

  // The context stays inside the box that holds what was read.
  const common = read.commonAncestorContainer
  const root = reader.blockOf(common) ?? common
  const before = readBackward(reader, root, read.startContainer, read.startOffset, LIMITS.context)
  const after = readForward(
    reader,
    root,
    read.endContainer,
    read.endOffset,
    () => ({ stop: false }),
    LIMITS.context * 8,
  )
  // White space next to what was read is part of the context; text of other boxes is
  // separated by a space.
  const lead = differ(before.pieces.at(-1), first)
  const trail = differ(last, after.pieces[0])

  return {
    target: {
      kind: 'text',
      selected: capText(collapse(join(selected.pieces)).trim(), LIMITS.selected, selected.cut),
      before: contextBefore(collapse(`${join(before.pieces)}${lead ? ' ' : ''}`), before.cut),
      after: contextAfter(collapse(`${trail ? ' ' : ''}${join(after.pieces)}`), after.cut),
      container: snapshotElement(rangeContainer(read)),
    },
    range: read,
  }
}
