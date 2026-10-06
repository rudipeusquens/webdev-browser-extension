import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import CommentPopover from '@/entrypoints/overlay.content/CommentPopover.vue'
import { type FakePort, fakePort } from './helpers/fake-ports'

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

/** Synthetic events are never trusted; the popover acts on trusted ones only. */
function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, 'isTrusted', { get: () => true })
  return event
}
const click = (el: Element) => el.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })))
const press = (el: Element, init: KeyboardEventInit) =>
  el.dispatchEvent(
    trusted(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })),
  )

describe('CommentPopover: dictation', () => {
  let port: FakePort | undefined
  let sendMessage: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    fakeBrowser.reset()
    port = undefined
    vi.spyOn(fakeBrowser.runtime, 'connect').mockImplementation((() => {
      port = fakePort('voice', {})
      return port
    }) as never)
    sendMessage = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValue({ ok: true } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  function open(props: { initial?: string } = {}) {
    const wrapper = mount(CommentPopover, {
      props: { rect, label: 'button', ...props },
      attachTo: document.body,
    })
    const get = (id: string) => wrapper.get(`[data-testid="${id}"]`)
    const field = () => wrapper.get('textarea').element as HTMLTextAreaElement
    const receive = async (state: unknown) => {
      port?.receive(state)
      await nextTick()
    }
    return { wrapper, get, field, receive }
  }

  it('puts the mic button right before Save', () => {
    const { get } = open()
    expect(get('overlay-mic').element.nextElementSibling).toBe(get('overlay-save').element)
    expect(get('overlay-mic').attributes('aria-label')).toBe('Dictate (Alt+V)')
  })

  it('starts on a trusted click only and shows the running time', async () => {
    const { get, wrapper, receive } = open()
    await get('overlay-mic').trigger('click')
    expect(port).toBeUndefined()
    click(get('overlay-mic').element)
    expect(port?.posted).toEqual([{ type: 'start' }])
    await receive({ state: 'recording', limit: 120_000 })
    expect(get('overlay-mic').attributes('aria-label')).toBe('Stop dictating (Alt+V)')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(get('overlay-voice-status').text()).toContain('0:03')
    click(get('overlay-mic').element)
    expect(port?.posted.at(-1)).toEqual({ type: 'stop' })
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('keeps Save waiting while it records or transcribes', async () => {
    const { get, receive } = open({ initial: 'Wider' })
    const save = () => get('overlay-save').attributes('disabled')
    expect(save()).toBeUndefined()
    click(get('overlay-mic').element)
    await receive({ state: 'recording', limit: 120_000 })
    expect(save()).toBeDefined()
    await receive({ state: 'transcribing' })
    expect(get('overlay-voice-status').text()).toContain('Transcribing…')
    expect(get('overlay-mic').attributes('disabled')).toBeDefined()
    expect(save()).toBeDefined()
    await receive({ state: 'done', text: 'and taller.', atLimit: false })
    expect(save()).toBeUndefined()
  })

  it('inserts the text at the caret, focuses the field and saves it', async () => {
    const { get, field, wrapper, receive } = open({ initial: 'Fix this, please' })
    field().setSelectionRange(8, 8)
    click(get('overlay-mic').element)
    ;(get('overlay-mic').element as HTMLElement).focus()
    await receive({ state: 'done', text: 'and that', atLimit: false })
    expect(field().value).toBe('Fix this and that, please')
    expect(document.activeElement).toBe(field())
    expect(field().selectionStart).toBe(17)
    click(get('overlay-save').element)
    expect(wrapper.emitted('save')).toEqual([['Fix this and that, please']])
  })

  it('cancels a running recording on Esc and keeps the comment open', async () => {
    const { get, wrapper, receive } = open({ initial: 'Keep me' })
    click(get('overlay-mic').element)
    await receive({ state: 'recording', limit: 120_000 })
    press(get('overlay-popover').element, { key: 'Escape' })
    expect(port?.posted.at(-1)).toEqual({ type: 'cancel' })
    expect(wrapper.emitted('cancel')).toBeUndefined()
    await receive({ state: 'idle' })
    press(get('overlay-popover').element, { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('starts and stops on Alt+V', async () => {
    const { get, receive } = open()
    const card = get('overlay-popover').element
    press(card, { key: 'v', code: 'KeyV', altKey: true })
    expect(port?.posted).toEqual([{ type: 'start' }])
    await receive({ state: 'recording', limit: 120_000 })
    press(card, { key: '√', code: 'KeyV', altKey: true })
    expect(port?.posted.at(-1)).toEqual({ type: 'stop' })
  })

  it('offers Retry after a failed request', async () => {
    const { get, wrapper, receive } = open()
    click(get('overlay-mic').element)
    await receive({ state: 'failed', error: 'invalid-key', retry: true })
    expect(get('overlay-voice-message').text()).toContain('Invalid API key.')
    expect(wrapper.find('[data-testid="overlay-voice-grant"]').exists()).toBe(false)
    await get('overlay-voice-retry').trigger('click')
    expect(port?.posted.at(-1)).toEqual({ type: 'start' })
    click(get('overlay-voice-retry').element)
    expect(port?.posted.at(-1)).toEqual({ type: 'retry' })
  })

  it('opens the settings when there is no key', async () => {
    const { get, receive } = open()
    click(get('overlay-mic').element)
    await receive({ state: 'failed', error: 'no-key', retry: false })
    expect(get('overlay-voice-message').text()).toContain('Add an OpenRouter API key in settings.')
    await get('overlay-voice-settings').trigger('click')
    expect(sendMessage).not.toHaveBeenCalled()
    click(get('overlay-voice-settings').element)
    expect(sendMessage).toHaveBeenCalledWith({ type: 'voice:settings' })
  })

  it.each(['mic-not-granted', 'mic-blocked'])('offers Grant for %s', async (error) => {
    const { get, receive } = open()
    click(get('overlay-mic').element)
    await receive({ state: 'failed', error, retry: false })
    await get('overlay-voice-grant').trigger('click')
    expect(sendMessage).not.toHaveBeenCalled()
    click(get('overlay-voice-grant').element)
    expect(sendMessage).toHaveBeenCalledWith({ type: 'voice:grant' })
  })

  it("shows OpenRouter's reason as text", async () => {
    const { get, wrapper, receive } = open()
    click(get('overlay-mic').element)
    await receive({ state: 'failed', error: 'rejected', detail: '<img src=x> nope', retry: true })
    expect(get('overlay-voice-message').text()).toContain('Transcription failed: <img src=x> nope')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('says when the recording stopped at its limit', async () => {
    const { get, receive } = open()
    click(get('overlay-mic').element)
    await receive({ state: 'done', text: 'Long story.', atLimit: true })
    expect(get('overlay-voice-notice').text()).toContain('Recording stopped after 2 minutes.')
  })

  it('says when the dictation did not fit', async () => {
    const { get, field, receive } = open({ initial: 'x'.repeat(4995) })
    field().setSelectionRange(4995, 4995)
    click(get('overlay-mic').element)
    await receive({ state: 'done', text: 'more words than fit', atLimit: false })
    expect([...field().value]).toHaveLength(5000)
    expect(get('overlay-voice-notice').text()).toContain('did not fit')
  })

  it('lets go of the line when it closes', async () => {
    const { get, wrapper, receive } = open()
    click(get('overlay-mic').element)
    await receive({ state: 'recording', limit: 120_000 })
    wrapper.unmount()
    expect(port?.disconnected).toBe(true)
  })
})
