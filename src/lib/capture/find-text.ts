// Finding a text item's selection again after the page was reloaded or re-rendered: by its
// text inside the container it was captured in, read the way capture reads it (reader.ts),
// and by the context around it when the text occurs more than once.

import type { TextTarget } from '../collection/model'
import { cleanPoint, collapse } from '../text'
import { documentOf } from './dom'
import { type Piece, readForward, TextReader } from './reader'

/** Most characters of a container that are searched. */
const SEARCH_LIMIT = 20_000
/** Most occurrences compared by their context. */
const MAX_CANDIDATES = 200

interface Position {
  node: Text
  offset: number
}

/**
 * The container's text as capture stores it (white space collapsed, invisible characters
 * removed, boxes separated by a space), with the place in the page of every character.
 */
function flatten(pieces: Piece[]): { text: string; at: (Position | null)[] } {
  const chars: string[] = []
  const at: (Position | null)[] = []
  let space = true
  pieces.forEach((piece, i) => {
    if (i > 0 && pieces[i - 1]?.block !== piece.block && !space) {
      chars.push(' ')
      at.push(null)
      space = true
    }
    // By code point: a character outside the BMP is cleaned as a whole, as when it was stored.
    for (let j = 0; j < piece.text.length;) {
      const point = String.fromCodePoint(piece.text.codePointAt(j) ?? 0)
      const offset = j
      j += point.length
      const char = cleanPoint(point, chars.at(-1) ?? '').replace(/\s/g, ' ')
      if (char === '') continue
      if (char === ' ' && space) continue
      for (let k = 0; k < char.length; k++) {
        chars.push(char.charAt(k))
        at.push(piece.node ? { node: piece.node, offset: (piece.start ?? 0) + offset + k } : null)
      }
      space = char === ' '
    }
  })
  return { text: chars.join(''), at }
}

/** How many characters `a` and `b` share at their ends (`fromEnd`) or starts. */
function shared(a: string, b: string, fromEnd: boolean): number {
  let n = 0
  while (n < a.length && n < b.length) {
    const x = fromEnd ? a.charAt(a.length - 1 - n) : a.charAt(n)
    const y = fromEnd ? b.charAt(b.length - 1 - n) : b.charAt(n)
    if (x !== y) break
    n++
  }
  return n
}

const withoutEllipsis = (s: string, atStart: boolean) =>
  atStart ? s.replace(/^…/, '') : s.replace(/…$/, '')

/**
 * The selection of `target` inside `container`: every occurrence of its text (a cut text by
 * its part before the `…`), scored by how much of its context matches next to it; the best,
 * else the first. Null when the text is not there.
 */
export function findText(container: Element, target: TextTarget): Range | null {
  const view = documentOf(container).defaultView
  // Pins stored before capture removed invisible characters may still hold some.
  const needle = collapse(withoutEllipsis(target.selected, false)).trim()
  if (!view || !needle) return null
  const read = readForward(
    new TextReader(view, true),
    container,
    container,
    0,
    () => ({ stop: false }),
    SEARCH_LIMIT,
  )
  const { text, at } = flatten(read.pieces)
  const before = collapse(withoutEllipsis(target.before, true))
  const after = collapse(withoutEllipsis(target.after, false))

  let best = -1
  let bestScore = -1
  for (
    let found = text.indexOf(needle), n = 0;
    found >= 0 && n < MAX_CANDIDATES;
    found = text.indexOf(needle, found + 1), n++
  ) {
    const score =
      shared(text.slice(Math.max(0, found - before.length), found), before, true) +
      shared(text.slice(found + needle.length, found + needle.length + after.length), after, false)
    if (score > bestScore) {
      best = found
      bestScore = score
    }
  }
  const start = at[best]
  const end = at[best + needle.length - 1]
  if (best < 0 || !start || !end) return null
  const range = documentOf(container).createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + 1)
  return range
}
