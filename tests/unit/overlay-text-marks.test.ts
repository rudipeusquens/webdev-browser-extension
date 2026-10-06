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

const none = { normal: [], strong: [] }

describe('text marks', () => {
  it('registers the pinned texts of each status and the stronger ones, with their rules', () => {
    const { s, doc, names } = surface()
    const marks = createTextMarks(s)
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(range)
    marks.set({
      open: { normal: [a!], strong: [b!] },
      done: { normal: [c!], strong: [] },
      deleted: { normal: [], strong: [d!] },
    })
    expect(names('webdev-pins-open')).toEqual([a])
    expect(names('webdev-pins-open-strong')).toEqual([b])
    expect(names('webdev-pins-done')).toEqual([c])
    expect(names('webdev-pins-deleted-strong')).toEqual([d])
    expect(doc.adoptedStyleSheets).toHaveLength(1)
    const rules = JSON.stringify(doc.adoptedStyleSheets[0])
    for (const name of ['open', 'done', 'deleted']) {
      expect(rules).toContain(`::highlight(webdev-pins-${name})`)
      expect(rules).toContain(`::highlight(webdev-pins-${name}-strong)`)
    }
  })

  it('adds its rules again when the page dropped them, and only once', () => {
    const { s, doc } = surface()
    const marks = createTextMarks(s)
    marks.set({ open: { normal: [range('a')], strong: [] } })
    marks.set({ open: { normal: [range('a')], strong: [] } })
    expect(doc.adoptedStyleSheets).toHaveLength(1)
    doc.adoptedStyleSheets = []
    marks.set({ open: { normal: [range('a')], strong: [] } })
    expect(doc.adoptedStyleSheets).toHaveLength(1)
  })

  it('removes its highlights and rules when nothing is marked or it stops', () => {
    const { s, doc, registry } = surface()
    const marks = createTextMarks(s)
    const own = { page: 'sheet' } as never
    doc.adoptedStyleSheets = [own]
    marks.set({ done: { normal: [range('a')], strong: [] } })
    marks.set({ open: none, done: none })
    expect(registry.size).toBe(0)
    marks.set({
      open: { normal: [range('a')], strong: [range('b')] },
      deleted: { normal: [range('c')], strong: [] },
    })
    marks.stop()
    expect(registry.size).toBe(0)
    expect(doc.adoptedStyleSheets).toEqual([own])
  })

  it('does nothing in a browser without highlights', () => {
    const marks = createTextMarks(undefined)
    expect(() => marks.set({ open: { normal: [range('a')], strong: [] } })).not.toThrow()
    expect(() => marks.stop()).not.toThrow()
  })
})
