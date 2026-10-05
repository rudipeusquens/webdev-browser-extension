import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CommentPopover from '@/entrypoints/overlay.content/CommentPopover.vue'

const rect = { x: 10, y: 10, width: 100, height: 20 }

describe('CommentPopover', () => {
  it('disables Save until there is a comment', async () => {
    const wrapper = mount(CommentPopover, { props: { rect, label: 'button' } })
    const save = wrapper.get('[data-testid="overlay-save"]')
    expect(save.attributes('disabled')).toBeDefined()
    await wrapper.get('textarea').setValue('  ')
    expect(save.attributes('disabled')).toBeDefined()
    await wrapper.get('textarea').setValue('Wider')
    expect(save.attributes('disabled')).toBeUndefined()
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
