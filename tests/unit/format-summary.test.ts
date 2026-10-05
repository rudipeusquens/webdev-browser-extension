import { describe, expect, it } from 'vitest'
import { targetSummary } from '@/lib/format/summary'
import { snapshot } from './helpers/collection'

describe('targetSummary', () => {
  it('names the tag and the text of an element', () => {
    expect(targetSummary({ kind: 'element', element: snapshot() })).toBe('button "Save changes"')
    expect(targetSummary({ kind: 'element', element: snapshot({ text: '' }) })).toBe('button')
  })

  it('puts the innermost component first when known', () => {
    const element = snapshot({
      origin: {
        framework: 'vue',
        chain: [
          { name: 'App', file: '/a' },
          { name: 'Form', file: '/b' },
        ],
      },
    })
    expect(targetSummary({ kind: 'element', element })).toBe('Form · button "Save changes"')
  })

  it('shortens long text', () => {
    const summary = targetSummary({ kind: 'element', element: snapshot({ text: 'x'.repeat(100) }) })
    expect(summary).toBe(`button "${'x'.repeat(39)}…"`)
  })

  it('describes text and area targets', () => {
    expect(
      targetSummary({
        kind: 'text',
        selected: 'Email notifcations',
        before: '',
        after: '',
        container: snapshot(),
      }),
    ).toBe('"Email notifcations"')
    expect(
      targetSummary({
        kind: 'area',
        rect: { x: 0, y: 0, width: 1, height: 1 },
        container: snapshot(),
        elements: [snapshot()],
        moreCount: 2,
      }),
    ).toBe('Area with 3 elements')
  })
})
