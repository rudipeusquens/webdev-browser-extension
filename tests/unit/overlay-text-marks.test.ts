import { describe, expect, it } from 'vitest'
import { createTextMarks, type MarkSurface } from '@/entrypoints/overlay.content/text-marks'

/** The page's highlight registry and adopted style sheets, as plain objects. */
function surface() {
  const registry = new Map<string, { ranges: Range[] }>()
  const doc = { adoptedStyleSheets: [] as CSSStyleSheet[] }
  const s: MarkSurface = {
    doc,
    highlights: {
      set: (name, highlight) => void registry.set(name, highlight as never),
      delete: (name) => registry.delete(name),
    },
    highlight: (ranges) => ({ ranges }) as never,
    sheet: (rules) => ({ rules }) as never,
  }
  const names = (name: string) => registry.get(name)?.ranges ?? null
  return { s, doc, registry, names }
}

const range = (text: string) => ({ toString: () => text }) as unknown as Range

describe('text marks', () => {
  it('registers the pinned texts and the stronger one, with the rules for both', () => {
    const { s, doc, names } = surface()
    const marks = createTextMarks(s)
    const a = range('a')
    const b = range('b')
    marks.set([a], [b])
    expect(names('webdev-pins')).toEqual([a])
    expect(names('webdev-pins-strong')).toEqual([b])
    expect(doc.adoptedStyleSheets).toHaveLength(1)
    expect(JSON.stringify(doc.adoptedStyleSheets[0])).toContain('::highlight(webdev-pins)')
  })

  it('adds its rules again when the page dropped them, and only once', () => {
    const { s, doc } = surface()
    const marks = createTextMarks(s)
    marks.set([range('a')], [])
    marks.set([range('a')], [])
    expect(doc.adoptedStyleSheets).toHaveLength(1)
    doc.adoptedStyleSheets = []
    marks.set([range('a')], [])
    expect(doc.adoptedStyleSheets).toHaveLength(1)
  })

  it('removes its highlights and rules when nothing is marked or it stops', () => {
    const { s, doc, registry } = surface()
    const marks = createTextMarks(s)
    const own = { page: 'sheet' } as never
    doc.adoptedStyleSheets = [own]
    marks.set([range('a')], [])
    marks.set([], [])
    expect(registry.size).toBe(0)
    marks.set([range('a')], [range('b')])
    marks.stop()
    expect(registry.size).toBe(0)
    expect(doc.adoptedStyleSheets).toEqual([own])
  })

  it('does nothing in a browser without highlights', () => {
    const marks = createTextMarks(undefined)
    expect(() => marks.set([range('a')], [])).not.toThrow()
    expect(() => marks.stop()).not.toThrow()
  })
})
