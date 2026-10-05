import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CommentPopover from '@/entrypoints/overlay.content/CommentPopover.vue'

const rect = { x: 10, y: 10, width: 100, height: 20 }

describe('CommentPopover', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('moves when it grows and would no longer fit below its target', async () => {
    let resized: (() => void) | undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    const low = { x: 10, y: 500, width: 100, height: 20 }
    const wrapper = mount(CommentPopover, { props: { rect: low, label: 'button' } })
    await nextTick()
    await nextTick()
    const card = wrapper.get('[data-testid="overlay-popover"]')
    expect(card.attributes('style')).toContain(`top: ${500 + 20 + 8}px`)
    Object.defineProperty(card.element, 'offsetHeight', { value: 300, configurable: true })
    resized?.()
    await nextTick()
    expect(card.attributes('style')).toContain(`top: ${500 - 8 - 300}px`)
  })

  it('disables Save until there is a comment', () => {
    const empty = mount(CommentPopover, { props: { rect, label: 'button' } })
    expect(empty.get('[data-testid="overlay-save"]').attributes('disabled')).toBeDefined()
    const blank = mount(CommentPopover, { props: { rect, label: 'button', initial: '  ' } })
    expect(blank.get('[data-testid="overlay-save"]').attributes('disabled')).toBeDefined()
    const filled = mount(CommentPopover, { props: { rect, label: 'button', initial: 'Wider' } })
    expect(filled.get('[data-testid="overlay-save"]').attributes('disabled')).toBeUndefined()
  })

  // A synthetic input event is exactly what a page-driven edit looks like to the field:
  // no trusted beforeinput announced it.
  it('restores the text and warns after an edit nobody announced', async () => {
    const wrapper = mount(CommentPopover, { props: { rect, label: 'button', initial: 'Mine' } })
    await wrapper.get('textarea').setValue('Theirs')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Mine')
    expect(wrapper.get('[data-testid="overlay-warning"]').text()).toContain(
      'This page tried to change your comment',
    )
  })

  it('prefills an existing comment and names the item', () => {
    const wrapper = mount(CommentPopover, {
      props: { rect, label: 'button', initial: 'Old text', number: 3 },
    })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Old text')
    expect(wrapper.text()).toContain('Item 3')
  })

  it('shows an error and keeps the text', () => {
    const wrapper = mount(CommentPopover, {
      props: { rect, label: 'button', initial: 'Keep me', error: 'Could not save.' },
    })
    expect(wrapper.text()).toContain('Could not save.')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Keep me')
  })

  it('renders the target label as text', () => {
    const wrapper = mount(CommentPopover, { props: { rect, label: '<img src=x>' } })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x>')
  })
})
