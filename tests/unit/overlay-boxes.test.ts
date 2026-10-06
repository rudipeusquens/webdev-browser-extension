import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HoverBox from '@/entrypoints/overlay.content/HoverBox.vue'
import TextHighlight from '@/entrypoints/overlay.content/TextHighlight.vue'

const rect = { x: 10, y: 40, width: 100, height: 20 }

// A saved pin is marked in its status color everywhere (spec section 8).
describe('the markings of a pin', () => {
  it.each([
    [undefined, 'blue-600'],
    ['open', 'blue-600'],
    ['done', 'green-700'],
    ['deleted', 'red-600'],
  ] as const)('outline and label a %s pin in %s', (status, tone) => {
    const box = mount(HoverBox, { props: { rect, label: 'Pin 1', status } })
    const classes = box.get('[data-testid="overlay-hover"]').classes()
    expect(classes).toContain(`outline-${tone}`)
    expect(classes).toContain(`bg-${tone}/10`)
    expect(box.get('[data-testid="overlay-hover-label"]').classes()).toContain(`bg-${tone}`)
    for (const other of ['blue-600', 'green-700', 'red-600'].filter((t) => t !== tone)) {
      expect(box.html()).not.toContain(other)
    }
  })

  it('keeps the tone of a selected target and an area in the status color', () => {
    const selected = mount(HoverBox, { props: { rect, tone: 'selected', status: 'done' } })
    expect(selected.classes()).toContain('bg-green-700/5')
    expect(selected.classes()).toContain('outline-solid')
    const area = mount(HoverBox, { props: { rect, tone: 'area', status: 'deleted' } })
    expect(area.classes()).toContain('outline-red-600')
    expect(area.classes()).toContain('outline-dashed')
  })

  it.each([
    [undefined, 'bg-blue-600/25'],
    ['done', 'bg-green-700/25'],
    ['deleted', 'bg-red-600/25'],
  ] as const)('shades the lines of a %s text with %s', (status, shade) => {
    const text = mount(TextHighlight, { props: { boxes: [rect], status } })
    expect(text.get('[data-testid="overlay-text-highlight"] > div').classes()).toContain(shade)
  })
})
