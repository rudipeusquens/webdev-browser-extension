import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SelectionChip from '@/entrypoints/overlay.content/SelectionChip.vue'

describe('SelectionChip', () => {
  it('offers a pin for the selection', () => {
    const wrapper = mount(SelectionChip, {
      props: { line: { x: 10, y: 10, width: 80, height: 16 } },
    })
    expect(wrapper.text()).toBe('Pin')
    expect(wrapper.get('[data-testid="overlay-chip"]').attributes('title')).toBe('Pin this text')
  })
})
