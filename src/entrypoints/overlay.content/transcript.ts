// Where a dictated text goes in the comment field (spec section 9): at the caret, replacing a
// selection, with one space where words would otherwise run together, and never beyond the
// comment limit.

import { LIMITS } from '@/lib/collection/model'
import { codePoints } from '@/lib/collection/validate'

/** What needs no space before it: whitespace and closing punctuation. */
const CLOSES = /[\s.,;:!?)\]}…]/
/**
 * What needs no space after it: an opening bracket or quote. A straight or curly quote opens
 * only at the start or after white space; after a word it closes.
 */
const OPENS = /(?:[([{„‚«‹¿¡]|(?:^|\s)["'“‘»])$/u

export function insertTranscript(
  value: string,
  start: number,
  end: number,
  text: string,
  max: number = LIMITS.comment,
): { value: string; caret: number; cut: boolean } {
  const from = Math.min(start, value.length)
  const to = Math.min(Math.max(end, from), value.length)
  const before = value.slice(0, from)
  const after = value.slice(to)
  const lead =
    before && !/\s$/.test(before) && !OPENS.test(before) && !CLOSES.test(text[0] ?? ' ') ? ' ' : ''
  const trail = after && !CLOSES.test(after[0] ?? ' ') && !/\s$/.test(text) ? ' ' : ''
  const room = max - codePoints(before) - codePoints(after)
  let piece = text
  let cut = false
  if (codePoints(lead + text + trail) > room) {
    cut = true
    piece = [...text]
      .slice(0, Math.max(0, room - lead.length))
      .join('')
      .trimEnd()
    if (!piece) return { value, caret: to, cut }
  }
  const inserted = `${lead}${piece}${cut ? '' : trail}`
  return {
    value: before + inserted + after,
    caret: before.length + lead.length + piece.length,
    cut,
  }
}
