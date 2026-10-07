// Cleaning of page-derived strings before they are stored or written to the prompt.

// Characters that show nothing a reader notices, but that a model reads: controls, format
// characters (zero widths, bidirectional controls that make text read differently than it is
// stored, Unicode tags that spell ASCII invisibly, the soft hyphen), private use (icon fonts),
// variation selectors and Hangul fillers. Tabs and line breaks become a space instead.
const INVISIBLE =
  /[\p{Cc}\p{Cf}\p{Co}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u115F\u1160\u3164\uFFA0]/gu
const BREAKS = /[\t\n\v\f\r\u0085]/

/** Removes invisible characters and collapses whitespace, including line breaks, to one space. */
export function collapse(s: string): string {
  return s.replace(INVISIBLE, (c) => (BREAKS.test(c) ? ' ' : '')).replace(/\s+/g, ' ')
}

/** Shortens `s` to at most `max` code points, the last one being `…`. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const points = Array.from(s)
  return points.length <= max ? s : `${points.slice(0, max - 1).join('')}…`
}

/** `collapse`, trimmed and capped: the form every page-derived string is stored in. */
export function clean(s: string, max = Number.POSITIVE_INFINITY): string {
  return truncate(collapse(s).trim(), max)
}
