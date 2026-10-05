// Cleaning of page-derived strings before they are stored or written to the prompt.

// C0 and C1 controls except tab and line breaks (collapsed below), plus bidirectional
// formatting characters, which can make text read differently than it is stored.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/g

/** Removes invisible characters and collapses whitespace, including line breaks, to one space. */
export function collapse(s: string): string {
  return s.replace(INVISIBLE, '').replace(/\s+/g, ' ')
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
