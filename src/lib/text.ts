// Cleaning of page-derived strings before they are stored or written to the prompt.

// Characters that show nothing a reader notices, but that a model reads: controls, format
// characters (zero widths, bidirectional controls that make text read differently than it is
// stored, Unicode tags that spell ASCII invisibly, the soft hyphen), private use (icon fonts),
// variation selectors and Hangul fillers. Tabs and line breaks become a space instead.
const INVISIBLE =
  /[\p{Cc}\p{Cf}\p{Co}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u115F\u1160\u3164\uFFA0]/u
const BREAKS = /[\t\n\v\f\r\u0085]/
// Except where they change how the character before them is written: the zero-width
// (non-)joiner in Persian and Indic words and emoji sequences, text and emoji presentation.
// One at a time, they carry no hidden text.
const JOINERS = /\u200C|\u200D|\uFE0E|\uFE0F/
const PRESENTATION = /\uFE0E|\uFE0F/

/**
 * What `collapse` makes of one code point, after `previous`, the last character kept before
 * it: the point itself, a space, or nothing.
 */
export function cleanPoint(point: string, previous: string): string {
  if (!INVISIBLE.test(point)) return point
  if (BREAKS.test(point)) return ' '
  if (!JOINERS.test(point) || previous === '' || /\s/.test(previous)) return ''
  // An emoji sequence joins a presented emoji to the next: VS16 + ZWJ.
  if (JOINERS.test(previous)) return PRESENTATION.test(previous) && point === '\u200D' ? point : ''
  return point
}

const INVISIBLE_RUNS = new RegExp(`${INVISIBLE.source}+`, 'gu')

/** Removes invisible characters and collapses whitespace, including line breaks, to one space. */
export function collapse(s: string): string {
  return s
    .replace(INVISIBLE_RUNS, (run: string, offset: number, whole: string) => {
      // What comes before a run is kept as it is.
      let previous = whole.charAt(offset - 1)
      let out = ''
      for (const point of run) {
        const kept = cleanPoint(point, previous)
        out += kept
        previous = kept || previous
      }
      return out
    })
    .replace(/\s+/g, ' ')
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
