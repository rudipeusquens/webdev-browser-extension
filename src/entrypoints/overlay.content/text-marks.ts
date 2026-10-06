// Pinned texts are marked by the browser itself (CSS Custom Highlight API): the shading is
// painted with the text, so nothing moves while the page scrolls and scroll containers cut it
// like the text. Boxes drawn by the overlay cost a style, layout and paint pass on every frame,
// too much on a huge page (spec section 8).
//
// The rules sit in one style sheet adopted by the page's document, under names no page uses.
// The page can see and remove them: that only removes the shading, the pins stay. Text inside
// the page's own shadow roots is not shaded, since the rules do not reach into them.

const NORMAL = 'webdev-pins'
const STRONG = 'webdev-pins-strong'
const RULES =
  `::highlight(${NORMAL}) { background-color: rgb(37 99 235 / 0.15); }\n` +
  `::highlight(${STRONG}) { background-color: rgb(37 99 235 / 0.3); }`

/** What the marks use of the page; tests pass plain objects. */
export interface MarkSurface {
  doc: { adoptedStyleSheets: CSSStyleSheet[] }
  highlights: { set(name: string, highlight: Highlight): unknown; delete(name: string): unknown }
  highlight(ranges: Range[]): Highlight
  sheet(rules: string): CSSStyleSheet
}

export interface TextMarks {
  /** Marks `normal` texts, and `strong` ones stronger (their pin is hovered). */
  set(normal: Range[], strong: Range[]): void
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
    highlights.delete(NORMAL)
    highlights.delete(STRONG)
  }

  return {
    set(normal, strong) {
      try {
        if (normal.length === 0 && strong.length === 0) return clear()
        sheet ??= surface.sheet(RULES)
        // The page may have replaced its sheets since.
        if (!doc.adoptedStyleSheets.includes(sheet)) {
          doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
        }
        highlights.set(NORMAL, surface.highlight(normal))
        highlights.set(STRONG, surface.highlight(strong))
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
