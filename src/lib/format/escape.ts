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

/** The developer's comment as a blockquote; line breaks are kept. */
export function blockquote(comment: string): string {
  return comment
    .replace(/\r\n?/g, '\n')
    .trimEnd()
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n')
}
