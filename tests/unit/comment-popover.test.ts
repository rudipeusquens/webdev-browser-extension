import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import type { Status } from '@/lib/collection/model'
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

  it('prefills an existing comment and names the pin', () => {
    const wrapper = mount(CommentPopover, {
      props: { rect, label: 'button', initial: 'Old text', number: 3, status: 'open' },
    })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Old text')
    expect(wrapper.text()).toContain('Pin 3')
    expect(wrapper.text()).not.toContain('Item')
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Edit pin 3')
    expect(wrapper.get('[data-testid="overlay-delete"]').attributes('aria-label')).toBe(
      'Delete pin 3',
    )
  })

  it('calls a new one New pin, and Restore names the pin', () => {
    const fresh = mount(CommentPopover, { props: { rect, label: 'button' } })
    expect(fresh.text()).toContain('New pin')
    expect(fresh.text()).not.toContain('Comment')
    expect(fresh.get('[role="dialog"]').attributes('aria-label')).toBe('New pin')
    const deleted = mount(CommentPopover, {
      props: { rect, label: 'button', number: 4, status: 'deleted' },
    })
    expect(deleted.get('[data-testid="overlay-restore"]').attributes('aria-label')).toBe(
      'Restore pin 4',
    )
  })

  it('shows an error and keeps the text', () => {
    const wrapper = mount(CommentPopover, {
      props: { rect, label: 'button', initial: 'Keep me', error: 'Could not save.' },
    })
    expect(wrapper.text()).toContain('Could not save.')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Keep me')
  })

  // The ellipsis takes the color of the element that cuts the text.
  it('cuts a long target with an ellipsis in the color of the target', () => {
    const label = `"${'very long selected text '.repeat(3)}"`
    const wrapper = mount(CommentPopover, { props: { rect, label } })
    const cut = wrapper.findAll('*').filter((w) => w.classes().includes('truncate'))
    expect(cut).toHaveLength(1)
    expect(cut[0]?.text()).toBe(label)
    expect(cut[0]?.classes()).toContain('text-muted-foreground')
    expect(wrapper.text()).toContain('New pin')
  })

  it('reports unsaved text: any for a new pin, a change for an existing one', async () => {
    const fresh = mount(CommentPopover, { props: { rect, label: 'button' } })
    await nextTick()
    expect(fresh.emitted('unsaved')?.at(-1)).toEqual([false])
    await type(fresh.get('textarea').element as HTMLTextAreaElement, 'insertText', ' ')
    expect(fresh.emitted('unsaved')?.at(-1)).toEqual([false])
    await type(fresh.get('textarea').element as HTMLTextAreaElement, 'insertText', 'W')
    expect(fresh.emitted('unsaved')?.at(-1)).toEqual([true])

    const edit = mount(CommentPopover, { props: { rect, label: 'button', initial: 'Old' } })
    await nextTick()
    const field = edit.get('textarea').element as HTMLTextAreaElement
    expect(edit.emitted('unsaved')?.at(-1)).toEqual([false])
    await type(field, 'insertText', ' ')
    expect(edit.emitted('unsaved')?.at(-1)).toEqual([false])
    await type(field, 'insertText', '!')
    expect(edit.emitted('unsaved')?.at(-1)).toEqual([true])
    await type(field, 'deleteContentBackward', null)
    expect(field.value).toBe('Old ')
    expect(edit.emitted('unsaved')?.at(-1)).toEqual([false])
  })

  it('takes the focus back when nudged', async () => {
    const wrapper = mount(CommentPopover, {
      props: { rect, label: 'button', initial: 'Mine' },
      attachTo: document.body,
    })
    await nextTick()
    await nextTick()
    ;(wrapper.get('[data-testid="overlay-save"]').element as HTMLElement).focus()
    await wrapper.setProps({ nudge: 1 })
    expect(document.activeElement).toBe(wrapper.get('textarea').element)
    wrapper.unmount()
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
/** A typed edit as the browser makes it: a trusted beforeinput, then the input. */
async function type(field: HTMLTextAreaElement, inputType: string, data: string | null) {
  const init = { bubbles: true, cancelable: true, inputType, data }
  field.dispatchEvent(trusted(new InputEvent('beforeinput', init)))
  field.value = inputType.startsWith('delete') ? field.value.slice(0, -1) : field.value + data
  field.dispatchEvent(trusted(new InputEvent('input', init)))
  await nextTick()
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

  function open(props: { initial?: string; number?: number; status?: Status } = {}) {
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

  it('offers Delete for an existing item, Restore for a deleted one, neither for a new one', () => {
    const shown = (props: object) => {
      const { wrapper } = open(props)
      const result = ['overlay-delete', 'overlay-restore'].filter((id) =>
        wrapper.find(`[data-testid="${id}"]`).exists(),
      )
      wrapper.unmount()
      return result
    }
    expect(shown({})).toEqual([])
    expect(shown({ number: 3, status: 'open' })).toEqual(['overlay-delete'])
    expect(shown({ number: 3, status: 'done' })).toEqual(['overlay-delete'])
    expect(shown({ number: 3, status: 'deleted' })).toEqual(['overlay-restore'])
  })

  it('no longer says Enter to save', () => {
    const { wrapper } = open({ number: 3, status: 'open' })
    expect(wrapper.text()).not.toContain('Enter to save')
    const { wrapper: fresh } = open()
    expect(fresh.text()).not.toContain('Enter to save')
  })

  it('deletes and restores on trusted clicks only', async () => {
    const { wrapper, get } = open({ number: 3, status: 'open' })
    await get('overlay-delete').trigger('click')
    expect(wrapper.emitted('remove')).toBeUndefined()
    click(get('overlay-delete').element)
    expect(wrapper.emitted('remove')).toHaveLength(1)
    const deleted = open({ number: 4, status: 'deleted' })
    await deleted.get('overlay-restore').trigger('click')
    expect(deleted.wrapper.emitted('restore')).toBeUndefined()
    click(deleted.get('overlay-restore').element)
    expect(deleted.wrapper.emitted('restore')).toHaveLength(1)
  })

  it('shows the dictation instead of Delete while it runs', async () => {
    const { wrapper, get, receive } = open({ number: 3, status: 'open', initial: 'Wider' })
    click(get('overlay-mic').element)
    await receive({ state: 'recording', limit: 120_000 })
    expect(wrapper.find('[data-testid="overlay-delete"]').exists()).toBe(false)
    expect(get('overlay-voice-status').text()).toContain('0:00')
    await receive({ state: 'idle' })
    expect(wrapper.find('[data-testid="overlay-delete"]').exists()).toBe(true)
  })

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
    expect(get('overlay-mic').attributes('aria-disabled')).toBe('true')
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

  it('reports a running dictation and a held recording as unsaved', async () => {
    const { get, wrapper, receive } = open({ initial: 'Keep' })
    await nextTick()
    const last = () => wrapper.emitted('unsaved')?.at(-1)
    expect(last()).toEqual([false])
    click(get('overlay-mic').element)
    await receive({ state: 'recording', limit: 120_000 })
    expect(last()).toEqual([true])
    await receive({ state: 'failed', error: 'offline', retry: true })
    expect(last()).toEqual([true])
    await receive({ state: 'failed', error: 'no-speech', retry: false })
    expect(last()).toEqual([false])
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

  // A disabled button loses the focus to the page, where Escape closes the whole comment.
  it('keeps the focus on the mic button while it starts and transcribes', async () => {
    const { get, receive } = open()
    const mic = get('overlay-mic').element as HTMLButtonElement
    // The popover focuses its field a tick after it opens.
    await nextTick()
    await nextTick()
    mic.focus()
    click(mic)
    await nextTick()
    expect(mic.disabled).toBe(false)
    expect(mic.getAttribute('aria-disabled')).toBe('true')
    await receive({ state: 'recording', limit: 120_000 })
    await receive({ state: 'transcribing' })
    expect(mic.disabled).toBe(false)
    expect(document.activeElement).toBe(mic)
    click(mic)
    expect(port?.posted).toEqual([{ type: 'start' }])
  })

  it('moves the focus to the field when Retry goes away', async () => {
    const { get, field, receive } = open()
    click(get('overlay-mic').element)
    await receive({ state: 'failed', error: 'offline', retry: true })
    const retry = get('overlay-voice-retry').element as HTMLElement
    retry.focus()
    click(retry)
    await nextTick()
    expect(document.activeElement).toBe(field())
  })

  it('saves on Enter in the field, but lets Enter press a focused button', async () => {
    const { get, field, wrapper, receive } = open({ initial: 'Typed text' })
    click(get('overlay-mic').element)
    await receive({ state: 'failed', error: 'offline', retry: true })
    const retry = get('overlay-voice-retry').element
    const onButton = trusted(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
    retry.dispatchEvent(onButton)
    expect(onButton.defaultPrevented).toBe(false)
    expect(wrapper.emitted('save')).toBeUndefined()
    press(field(), { key: 'Enter' })
    expect(wrapper.emitted('save')).toEqual([['Typed text']])
  })

  it('tells screen readers what changes, not every second of the clock', async () => {
    const { get, wrapper, receive } = open()
    const spoken = () =>
      wrapper
        .findAll('[aria-live], [role="status"], [role="alert"]')
        .map((el) => el.text())
        .join(' | ')
    click(get('overlay-mic').element)
    await receive({ state: 'recording', limit: 120_000 })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(get('overlay-voice-status').text()).toContain('0:02')
    expect(spoken()).not.toMatch(/\d:\d\d/)
    expect(spoken()).toContain('Recording')
    await receive({ state: 'transcribing' })
    expect(spoken()).toContain('Transcribing')
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
