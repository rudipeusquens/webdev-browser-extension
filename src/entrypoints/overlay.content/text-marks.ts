// Pinned texts are marked by the browser itself (CSS Custom Highlight API): the shading is
// painted with the text, so nothing moves while the page scrolls and scroll containers cut it
// like the text. Boxes drawn by the overlay cost a style, layout and paint pass on every frame,
// too much on a huge page (spec section 8).
//
// The rules sit in one style sheet adopted by the page's document, under names no page uses.
// The page can see and remove them: that only removes the shading, the pins stay. Text inside
// the page's own shadow roots is not shaded, since the rules do not reach into them.

import { STATUSES, type Status } from '@/lib/collection/model'

/** The status colors of the pins (src/lib/status.ts): blue-600, green-700, red-600. */
const COLORS: Record<Status, string> = {
  open: '37 99 235',
  done: '21 128 61',
  deleted: '220 38 38',
}
const name = (status: Status, strong: boolean) => `webdev-pins-${status}${strong ? '-strong' : ''}`
const NAMES = STATUSES.flatMap((status) => [name(status, false), name(status, true)])
const RULES = STATUSES.map(
  (status) =>
    `::highlight(${name(status, false)}) { background-color: rgb(${COLORS[status]} / 0.15); }\n` +
    `::highlight(${name(status, true)}) { background-color: rgb(${COLORS[status]} / 0.3); }`,
).join('\n')

/** Pinned texts by status: `strong` ones are drawn stronger (their pin is hovered). */
export type Marks = Partial<Record<Status, { normal: Range[]; strong: Range[] }>>

/** What the marks use of the page; tests pass plain objects. */
export interface MarkSurface {
  doc: { adoptedStyleSheets: CSSStyleSheet[] }
  highlights: { set(name: string, highlight: Highlight): unknown; delete(name: string): unknown }
  highlight(ranges: Range[]): Highlight
  sheet(rules: string): CSSStyleSheet
}

export interface TextMarks {
  set(marks: Marks): void
  stop(): void
}

/** The page's highlights and style sheets, when the browser has them. */
export function pageSurface(doc: Document): MarkSurface | undefined {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return
  return {
    doc,
    highlights: CSS.highlights,
    highlight: (ranges) => new Highlight(...ranges),
    sheet: (rules) => {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(rules)
      return sheet
    },
  }
}

export function createTextMarks(surface: MarkSurface | undefined): TextMarks {
  if (!surface) return { set: () => undefined, stop: () => undefined }
  const { doc, highlights } = surface
  let sheet: CSSStyleSheet | undefined

  function clear() {
    for (const each of NAMES) highlights.delete(each)
  }

  return {
    set(marks) {
      try {
        const empty = STATUSES.every(
          (status) => !marks[status]?.normal.length && !marks[status]?.strong.length,
        )
        if (empty) return clear()
        sheet ??= surface.sheet(RULES)
        // The page may have replaced its sheets since.
        if (!doc.adoptedStyleSheets.includes(sheet)) {
          doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
        }
        for (const status of STATUSES) {
          const { normal = [], strong = [] } = marks[status] ?? {}
          for (const [ranges, strongly] of [
            [normal, false],
            [strong, true],
          ] as const) {
            if (ranges.length) highlights.set(name(status, strongly), surface.highlight(ranges))
            else highlights.delete(name(status, strongly))
          }
        }
      } catch {
        // A page that broke the registry or its sheets: no shading, the pins stay.
      }
    },
    stop() {
      try {
        clear()
        if (sheet) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet)
      } catch {
        // Gone with the page already.
      }
    },
  }
}
