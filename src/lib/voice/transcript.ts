// Where a dictated text goes in a comment (spec section 9): at the end of what the pin holds,
// with one space where words would otherwise run together, and never beyond the comment limit.

import { LIMITS } from '../collection/model'
import { codePoints } from '../collection/validate'

/** What needs no space before it: whitespace and closing punctuation. */
const CLOSES = /[\s.,;:!?)\]}…]/
/**
 * What needs no space after it: an opening bracket or quote. A straight or curly quote and a
 * guillemet (German »…«, French «…») open only at the start or after white space; after a
 * word they close.
 */
const OPENS = /(?:[([{„‚¿¡]|(?:^|\s)["'“‘«»‹›])$/u

export function appendTranscript(
  value: string,
  text: string,
  max: number = LIMITS.comment,
): { value: string; cut: boolean } {
  const lead =
    value && !/\s$/.test(value) && !OPENS.test(value) && !CLOSES.test(text[0] ?? ' ') ? ' ' : ''
  const room = max - codePoints(value)
  if (codePoints(lead + text) <= room) return { value: value + lead + text, cut: false }
  const piece = [...text]
    .slice(0, Math.max(0, room - lead.length))
    .join('')
    .trimEnd()
  return { value: piece ? value + lead + piece : value, cut: true }
}
