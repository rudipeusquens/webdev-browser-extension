import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from '@/entrypoints/sidepanel/App.vue'

describe('side panel', () => {
  it('shows the empty state and a disabled copy button', () => {
    const wrapper = mount(App)
    expect(wrapper.text()).toContain(
      'No feedback yet: pick an element, drag an area, or select text.',
    )
    const copy = wrapper.get('[data-testid="copy-prompt"]')
    expect(copy.text()).toBe('Copy as prompt')
    expect(copy.attributes('disabled')).toBeDefined()
  })
})
