import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import CommentPopover from '@/entrypoints/overlay.content/CommentPopover.vue'
import type { Status } from '@/lib/collection/model'
import type { JobView } from '@/lib/voice/jobs'
import type { RecordingState } from '@/lib/voice/protocol'

const rect = { x: 10, y: 10, width: 100, height: 20 }
const IDLE: RecordingState = { state: 'idle' }

interface Props {
  rect?: typeof rect
  label?: string
  initial?: string
  number?: number
  status?: Status
  draft?: boolean
  error?: string
  busy?: boolean
  nudge?: number
  voice?: RecordingState
  clock?: string
  job?: JobView
}

const props = (extra: Props = {}) => ({
  rect,
  label: 'button',
  voice: IDLE,
  clock: '0:00',
  ...extra,
})

/** Synthetic events are never trusted; the popover acts on trusted ones only. */
function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, 'isTrusted', { get: () => true })
  return event
}
/** A typed edit as the browser makes it, at the caret: a trusted beforeinput, then the input. */
async function type(field: HTMLTextAreaElement, inputType: string, data: string | null) {
  const init = { bubbles: true, cancelable: true, inputType, data }
  field.dispatchEvent(trusted(new InputEvent('beforeinput', init)))
  const { value, selectionStart: start, selectionEnd: end } = field
  const deleting = inputType.startsWith('delete')
  const from = deleting && start === end ? start - 1 : start
  field.value = value.slice(0, from) + (deleting ? '' : (data ?? '')) + value.slice(end)
  const caret = from + (deleting ? 0 : (data ?? '').length)
  field.setSelectionRange(caret, caret)
  field.dispatchEvent(trusted(new InputEvent('input', init)))
  await nextTick()
}
const click = (el: Element) => el.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })))
const press = (el: Element, init: KeyboardEventInit) => {
  const event = trusted(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  el.dispatchEvent(event)
  return event
}

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
    const wrapper = mount(CommentPopover, { props: props({ rect: low }) })
    await nextTick()
    await nextTick()
    const card = wrapper.get('[data-testid="overlay-popover"]')
    expect(card.attributes('style')).toContain(`top: ${500 + 20 + 8}px`)
    Object.defineProperty(card.element, 'offsetHeight', { value: 300, configurable: true })
    resized?.()
    await nextTick()
    expect(card.attributes('style')).toContain(`top: ${500 - 8 - 300}px`)
  })

  it('disables Save until there is a comment, or a dictation runs', () => {
    const save = (extra: Props) =>
      mount(CommentPopover, { props: props(extra) })
        .get('[data-testid="overlay-save"]')
        .attributes('disabled')
    expect(save({})).toBeDefined()
    expect(save({ initial: '  ' })).toBeDefined()
    expect(save({ initial: 'Wider' })).toBeUndefined()
    expect(save({ voice: { state: 'recording', limit: 300_000, elapsed: 0 } })).toBeUndefined()
    expect(save({ initial: 'Wider', job: { state: 'transcribing' } })).toBeDefined()
  })

  // A synthetic input event is exactly what a page-driven edit looks like to the field:
  // no trusted beforeinput announced it.
  it('restores the text and warns after an edit nobody announced', async () => {
    const wrapper = mount(CommentPopover, { props: props({ initial: 'Mine' }) })
    await wrapper.get('textarea').setValue('Theirs')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Mine')
    expect(wrapper.get('[data-testid="overlay-warning"]').text()).toContain(
      'This page tried to change your comment',
    )
  })

  it('hands over its own text, not what a page put into the field', () => {
    const wrapper = mount(CommentPopover, { props: props({ initial: 'Mine' }) })
    const field = wrapper.get('textarea').element as HTMLTextAreaElement
    field.value = 'Theirs'
    expect((wrapper.vm as unknown as { snapshot(): string }).snapshot()).toBe('Mine')
    expect(field.value).toBe('Mine')
  })

  it('prefills an existing comment and names the pin, a draft as such', () => {
    const wrapper = mount(CommentPopover, {
      props: props({ initial: 'Old text', number: 3, status: 'open' }),
    })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Old text')
    expect(wrapper.text()).toContain('Pin 3')
    expect(wrapper.text()).not.toContain('Draft')
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Edit pin 3')
    expect(wrapper.get('[data-testid="overlay-delete"]').attributes('aria-label')).toBe(
      'Delete pin 3',
    )
    const draft = mount(CommentPopover, {
      props: props({ number: 4, status: 'open', draft: true }),
    })
    expect(draft.text()).toContain('Pin 4· Draft')
  })

  it('calls a new one New pin, and Restore names the pin', () => {
    const fresh = mount(CommentPopover, { props: props() })
    expect(fresh.text()).toContain('New pin')
    expect(fresh.get('[role="dialog"]').attributes('aria-label')).toBe('New pin')
    const deleted = mount(CommentPopover, { props: props({ number: 4, status: 'deleted' }) })
    expect(deleted.get('[data-testid="overlay-restore"]').attributes('aria-label')).toBe(
      'Restore pin 4',
    )
  })

  it('shows an error and keeps the text', () => {
    const wrapper = mount(CommentPopover, {
      props: props({ initial: 'Keep me', error: 'Could not save.' }),
    })
    expect(wrapper.text()).toContain('Could not save.')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Keep me')
  })

  // The ellipsis takes the color of the element that cuts the text.
  it('cuts a long target with an ellipsis in the color of the target', () => {
    const label = `"${'very long selected text '.repeat(3)}"`
    const wrapper = mount(CommentPopover, { props: props({ label }) })
    const cut = wrapper.findAll('*').filter((w) => w.classes().includes('truncate'))
    expect(cut).toHaveLength(1)
    expect(cut[0]?.text()).toBe(label)
    expect(cut[0]?.classes()).toContain('text-muted-foreground')
  })

  it('takes the focus back when nudged', async () => {
    const wrapper = mount(CommentPopover, {
      props: props({ initial: 'Mine' }),
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
    const wrapper = mount(CommentPopover, { props: props({ label: '<img src=x>' }) })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x>')
  })

  it('follows the stored comment while the field holds no edit of its own', async () => {
    const wrapper = mount(CommentPopover, { props: props({ initial: 'Typed' }) })
    const field = wrapper.get('textarea').element as HTMLTextAreaElement
    await wrapper.setProps({ initial: 'Typed and dictated.' })
    expect(field.value).toBe('Typed and dictated.')
    await type(field, 'insertText', '!')
    await wrapper.setProps({ initial: 'Something else.' })
    expect(field.value).toBe('Typed and dictated.!')
  })
})

describe('CommentPopover: keys and buttons', () => {
  let sendMessage: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    fakeBrowser.reset()
    sendMessage = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockImplementation((async (message: { type: string }) =>
        message.type === 'voice:ready' ? { ok: true, ready: true } : { ok: true }) as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  async function open(extra: Props = {}) {
    const wrapper = mount(CommentPopover, { props: props(extra), attachTo: document.body })
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    const get = (id: string) => wrapper.get(`[data-testid="${id}"]`)
    const has = (id: string) => wrapper.find(`[data-testid="${id}"]`).exists()
    const field = () => wrapper.get('textarea').element as HTMLTextAreaElement
    return { wrapper, get, has, field }
  }

  const RECORDING: RecordingState = { state: 'recording', limit: 300_000, elapsed: 0 }

  it('offers Delete for a pin or a new one, Restore for a deleted one, neither while it records', async () => {
    const shown = async (extra: Props) => {
      const { wrapper, has } = await open(extra)
      const result = ['overlay-delete', 'overlay-restore'].filter(has)
      wrapper.unmount()
      return result
    }
    expect(await shown({})).toEqual(['overlay-delete'])
    expect(await shown({ number: 3, status: 'open' })).toEqual(['overlay-delete'])
    expect(await shown({ number: 3, status: 'done' })).toEqual(['overlay-delete'])
    expect(await shown({ number: 3, status: 'deleted' })).toEqual(['overlay-restore'])
    expect(await shown({ number: 3, status: 'open', voice: RECORDING })).toEqual([])
  })

  it('deletes a pin, discards a new one, restores and closes on trusted clicks only', async () => {
    const pin = await open({ number: 3, status: 'open' })
    await pin.get('overlay-delete').trigger('click')
    expect(pin.wrapper.emitted('remove')).toBeUndefined()
    click(pin.get('overlay-delete').element)
    expect(pin.wrapper.emitted('remove')).toHaveLength(1)
    const fresh = await open()
    click(fresh.get('overlay-delete').element)
    expect(fresh.wrapper.emitted('discard')).toHaveLength(1)
    expect(fresh.wrapper.emitted('remove')).toBeUndefined()
    const deleted = await open({ number: 4, status: 'deleted' })
    click(deleted.get('overlay-restore').element)
    expect(deleted.wrapper.emitted('restore')).toHaveLength(1)
    const close = fresh.wrapper.get('[aria-label="Close"]')
    await close.trigger('click')
    expect(fresh.wrapper.emitted('close')).toBeUndefined()
    click(close.element)
    expect(fresh.wrapper.emitted('close')).toHaveLength(1)
  })

  it('saves on Enter in the field, trimmed, but lets Enter press a focused button', async () => {
    const { wrapper, field } = await open({ initial: '  Typed text ' })
    const button = wrapper.get('[aria-label="Close"]').element
    const onButton = press(button, { key: 'Enter' })
    expect(onButton.defaultPrevented).toBe(false)
    expect(wrapper.emitted('save')).toBeUndefined()
    press(field(), { key: 'Enter' })
    expect(wrapper.emitted('save')).toEqual([['Typed text']])
  })

  it('saves on Enter while a dictation records, also with an empty field: it stops first', async () => {
    const { wrapper, field } = await open({ voice: RECORDING })
    press(field(), { key: 'Enter' })
    expect(wrapper.emitted('save')).toEqual([['']])
  })

  it('closes on Esc, or ends a running dictation first', async () => {
    const { wrapper, field } = await open({ initial: 'Keep' })
    press(field(), { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ voice: RECORDING })
    press(field(), { key: 'Escape' })
    await wrapper.setProps({ voice: { state: 'starting' } })
    press(field(), { key: 'Escape' })
    expect(wrapper.emitted('voice-cancel')).toHaveLength(2)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('dictates on Alt+V, but not while the pin is transcribed', async () => {
    const { wrapper, field } = await open()
    press(field(), { key: 'v', code: 'KeyV', altKey: true })
    expect(wrapper.emitted('dictate')).toHaveLength(1)
    await wrapper.setProps({ job: { state: 'transcribing' } })
    press(field(), { key: 'v', code: 'KeyV', altKey: true })
    expect(wrapper.emitted('dictate')).toHaveLength(1)
  })

  describe('Space', () => {
    it('starts a dictation in an empty field once it knows a key is saved', async () => {
      const { wrapper, field, get } = await open()
      expect(sendMessage).toHaveBeenCalledWith({ type: 'voice:ready' })
      expect(get('overlay-popover').attributes('data-voice-ready')).toBe('')
      const space = press(field(), { key: ' ', code: 'Space' })
      expect(space.defaultPrevented).toBe(true)
      expect(wrapper.emitted('dictate')).toHaveLength(1)
    })

    it('types a space without a key, in a field with text, or while the pin is transcribed', async () => {
      sendMessage.mockImplementation((async () => ({ ok: true, ready: false })) as never)
      const noKey = await open()
      expect(noKey.get('overlay-popover').attributes('data-voice-ready')).toBeUndefined()
      expect(press(noKey.field(), { key: ' ' }).defaultPrevented).toBe(false)
      sendMessage.mockImplementation((async () => ({ ok: true, ready: true })) as never)
      const typed = await open({ initial: 'Some' })
      expect(press(typed.field(), { key: ' ' }).defaultPrevented).toBe(false)
      const busy = await open({ job: { state: 'transcribing' } })
      expect(press(busy.field(), { key: ' ' }).defaultPrevented).toBe(false)
      for (const each of [noKey, typed, busy])
        expect(each.wrapper.emitted('dictate')).toBeUndefined()
    })

    it('stops a recording while the field is still empty, and types once text was typed', async () => {
      const { wrapper, field } = await open({ voice: RECORDING })
      press(field(), { key: ' ' })
      expect(wrapper.emitted('dictate')).toHaveLength(1)
      await type(field(), 'insertText', 'Note')
      expect(press(field(), { key: ' ' }).defaultPrevented).toBe(false)
      expect(wrapper.emitted('dictate')).toHaveLength(1)
    })

    it('is swallowed while the microphone starts', async () => {
      const { wrapper, field } = await open({ voice: { state: 'starting' } })
      expect(press(field(), { key: ' ' }).defaultPrevented).toBe(true)
      expect(wrapper.emitted('dictate')).toBeUndefined()
    })
  })

  it('puts the mic button right before Save, and dictates on a trusted click only', async () => {
    const { wrapper, get } = await open()
    expect(get('overlay-mic').element.nextElementSibling).toBe(get('overlay-save').element)
    expect(get('overlay-mic').attributes('aria-label')).toBe('Dictate (Alt+V)')
    await get('overlay-mic').trigger('click')
    expect(wrapper.emitted('dictate')).toBeUndefined()
    click(get('overlay-mic').element)
    expect(wrapper.emitted('dictate')).toHaveLength(1)
  })

  it('shows the running time, and which key stops it', async () => {
    const { wrapper, get, field } = await open({ voice: RECORDING, clock: '0:03' })
    expect(get('overlay-mic').attributes('aria-label')).toBe('Stop dictating (Alt+V)')
    expect(get('overlay-voice-status').text()).toContain('0:03')
    expect(get('overlay-voice-status').text()).toContain('Space to stop')
    await type(field(), 'insertText', 'Note')
    expect(get('overlay-voice-status').text()).toContain('Alt+V to stop')
    void wrapper
  })

  it('asks at the limit: Keep goes on, Stop hands it over', async () => {
    const { wrapper, get } = await open({
      voice: { state: 'paused', elapsed: 300_000 },
      clock: '5:00',
    })
    expect(get('overlay-voice-limit').text()).toContain('Paused at 5:00. Keep recording?')
    click(get('overlay-voice-keep').element)
    expect(wrapper.emitted('resume')).toHaveLength(1)
    click(get('overlay-voice-stop').element)
    expect(wrapper.emitted('dictate')).toHaveLength(1)
  })

  it('waits while the pin is transcribed: the field is read-only, the mic only looks disabled', async () => {
    const { get, field } = await open({ initial: 'Typed', job: { state: 'transcribing' } })
    expect(field().readOnly).toBe(true)
    expect(get('overlay-voice-status').text()).toContain('Transcribing…')
    const mic = get('overlay-mic').element as HTMLButtonElement
    expect(mic.disabled).toBe(false)
    expect(mic.getAttribute('aria-disabled')).toBe('true')
    expect(get('overlay-save').attributes('disabled')).toBeDefined()
  })

  it("shows a failed transcription with Retry and Dismiss, and OpenRouter's reason as text", async () => {
    const { wrapper, get } = await open({
      job: { state: 'failed', error: 'rejected', detail: '<b>Unknown model</b>', retry: true },
    })
    expect(get('overlay-voice-message').text()).toContain(
      'Transcription failed: <b>Unknown model</b>',
    )
    expect(wrapper.find('b').exists()).toBe(false)
    click(get('overlay-voice-retry').element)
    expect(wrapper.emitted('job-retry')).toHaveLength(1)
    click(get('overlay-voice-dismiss').element)
    expect(wrapper.emitted('job-dismiss')).toHaveLength(1)
    click(get('overlay-voice-settings').element)
    expect(sendMessage).toHaveBeenCalledWith({ type: 'voice:settings' })
  })

  it('says when the dictation was too long for the pin', async () => {
    const { wrapper, get } = await open({ initial: 'Long', job: { state: 'cut' } })
    expect(get('overlay-voice-notice').text()).toContain('the full text is in Rec')
    click(get('overlay-voice-dismiss').element)
    expect(wrapper.emitted('job-dismiss')).toHaveLength(1)
  })

  it('hands over a recording that ended by itself on Retry', async () => {
    const { wrapper, get, field } = await open({
      voice: { state: 'failed', error: 'mic-lost', retry: true },
    })
    const retry = get('overlay-voice-retry').element as HTMLElement
    retry.focus()
    click(retry)
    expect(wrapper.emitted('dictate')).toHaveLength(1)
    await nextTick()
    expect(document.activeElement).toBe(field())
  })

  it.each(['mic-not-granted', 'mic-blocked'] as const)('offers Grant for %s', async (error) => {
    const { get } = await open({ voice: { state: 'failed', error, retry: false } })
    click(get('overlay-voice-grant').element)
    expect(sendMessage).toHaveBeenCalledWith({ type: 'voice:grant' })
  })

  it('opens the settings when there is no key', async () => {
    const { get } = await open({ voice: { state: 'failed', error: 'no-key', retry: false } })
    expect(get('overlay-voice-message').text()).toContain('Add an OpenRouter API key in settings.')
    await get('overlay-voice-settings').trigger('click')
    expect(sendMessage).not.toHaveBeenCalledWith({ type: 'voice:settings' })
    click(get('overlay-voice-settings').element)
    expect(sendMessage).toHaveBeenCalledWith({ type: 'voice:settings' })
  })

  it('tells screen readers what changes, not every second of the clock', async () => {
    const { wrapper } = await open({ voice: RECORDING, clock: '0:02' })
    const spoken = () =>
      wrapper
        .findAll('[aria-live]')
        .map((el) => el.text())
        .join(' | ')
    expect(spoken()).toBe('Recording. Alt+V stops it.')
    await wrapper.setProps({ voice: { state: 'paused', elapsed: 300_000 } })
    expect(spoken()).toContain('Keep recording?')
    expect(spoken()).not.toMatch(/\d:\d\d/)
  })
})
