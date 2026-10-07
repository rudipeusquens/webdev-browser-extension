// Markdown escaping for page-derived strings (spec section 7). Page text must never end its
// delimiter, start a new line or be rendered as HTML by a Markdown viewer.

/** Escapes `<` where it would start an HTML tag or comment; everything else stays readable. */
export function plain(s: string): string {
  return s.replace(/<(?=[A-Za-z/!?])/g, '\\<')
}

/** A code span whose fence is longer than any run of backticks inside. */
export function inlineCode(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${s}${pad}${fence}`
}

/** A double-quoted string with `\` and `"` escaped. */
export function quoted(s: string): string {
  return `"${plain(s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))}"`
}

// What a comment cannot show and a model would still read: controls other than tab and line
// breaks, Unicode tags, bidirectional controls and zero-width spaces. Joiners and variation
// selectors stay: emoji and some scripts need them.
const HIDDEN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u{E0000}-\u{E007F}\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu

/** The developer's comment as a blockquote; line breaks are kept. */
export function blockquote(comment: string): string {
  return comment
    .replace(HIDDEN, '')
    .replace(/\r\n?/g, '\n')
    .trimEnd()
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n')
}
