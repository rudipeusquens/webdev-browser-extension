import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import type { Browser } from 'wxt/browser'
import { useVoice } from '@/composables/use-voice'
import { type FakePort, fakePort } from './helpers/fake-ports'

function setup() {
  const ports: FakePort[] = []
  const connect = vi.fn(() => {
    const port = fakePort('voice', {})
    ports.push(port)
    return port as unknown as Browser.runtime.Port
  })
  let voice!: ReturnType<typeof useVoice>
  const host = mount(
    defineComponent({
      setup() {
        voice = useVoice(connect)
        return () => null
      },
    }),
  )
  const port = () => ports.at(-1) as FakePort
  return { voice, host, connect, ports, port }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useVoice', () => {
  it('connects on the first dictation only, and starts', () => {
    const { voice, connect, port } = setup()
    expect(connect).not.toHaveBeenCalled()
    expect(voice.state.value).toEqual({ state: 'idle' })
    voice.toggle()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(port().posted).toEqual([{ type: 'start' }])
    expect(voice.state.value).toEqual({ state: 'starting' })
    expect(voice.busy.value).toBe(true)
  })

  it('counts the seconds of a recording and stops it', async () => {
    const { voice, port } = setup()
    voice.toggle()
    port().receive({ state: 'recording', limit: 120_000 })
    expect(voice.seconds.value).toBe(0)
    await vi.advanceTimersByTimeAsync(2_100)
    expect(voice.seconds.value).toBe(2)
    voice.toggle()
    expect(port().posted.at(-1)).toEqual({ type: 'stop' })
    port().receive({ state: 'transcribing' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(voice.seconds.value).toBe(2)
    expect(voice.busy.value).toBe(true)
  })

  it('does nothing on a toggle while starting or transcribing', () => {
    const { voice, port } = setup()
    voice.toggle()
    voice.toggle()
    port().receive({ state: 'transcribing' })
    voice.toggle()
    expect(port().posted).toEqual([{ type: 'start' }])
  })

  it('hands the text over once and is ready for the next dictation', () => {
    const { voice, port, connect } = setup()
    const text = vi.fn()
    voice.onText(text)
    voice.toggle()
    port().receive({ state: 'done', text: 'Make it wider.', atLimit: true })
    expect(text).toHaveBeenCalledTimes(1)
    expect(text).toHaveBeenCalledWith('Make it wider.', true)
    expect(voice.busy.value).toBe(false)
    voice.toggle()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(port().posted.at(-1)).toEqual({ type: 'start' })
  })

  it('sends cancel and retry when they apply', () => {
    const { voice, port } = setup()
    voice.cancel()
    voice.retry()
    voice.toggle()
    voice.cancel()
    expect(port().posted).toEqual([{ type: 'start' }, { type: 'cancel' }])
    port().receive({ state: 'failed', error: 'offline', retry: true })
    voice.retry()
    expect(port().posted.at(-1)).toEqual({ type: 'retry' })
    expect(voice.state.value).toEqual({ state: 'transcribing' })
    port().receive({ state: 'failed', error: 'no-speech', retry: false })
    voice.retry()
    expect(port().posted).toHaveLength(3)
  })

  it('takes a dictation that fails while held as interrupted when the line breaks', () => {
    const { voice, port, connect } = setup()
    voice.toggle()
    port().receive({ state: 'recording', limit: 120_000 })
    port().close()
    expect(voice.state.value).toEqual({ state: 'failed', error: 'interrupted', retry: false })
    expect(voice.busy.value).toBe(false)
    voice.toggle()
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('ignores a broken line while idle, and malformed states', () => {
    const { voice, port } = setup()
    voice.toggle()
    port().receive({ state: 'done', text: 'Done.', atLimit: false })
    port().receive({ state: 'recording' })
    port().receive({ state: 'failed', error: 'oops', retry: true })
    expect(voice.state.value).toEqual({ state: 'done', text: 'Done.', atLimit: false })
    port().close()
    expect(voice.state.value).toEqual({ state: 'done', text: 'Done.', atLimit: false })
  })

  it('lets go of the line when its popover goes', async () => {
    const { voice, port, host } = setup()
    voice.toggle()
    port().receive({ state: 'recording', limit: 120_000 })
    host.unmount()
    expect(port().disconnected).toBe(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(voice.seconds.value).toBe(0)
  })
})
