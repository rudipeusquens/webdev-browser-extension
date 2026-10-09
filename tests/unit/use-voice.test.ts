import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import type { Browser } from 'wxt/browser'
import { ASK_WAIT, useVoice, type VoiceHandlers } from '@/composables/use-voice'
import { type FakePort, fakePort } from './helpers/fake-ports'

function setup(handlers: VoiceHandlers = {}) {
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
        voice = useVoice(handlers, connect)
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
    voice.start()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(port().posted).toEqual([{ type: 'start' }])
    expect(voice.state.value).toEqual({ state: 'starting' })
    expect(voice.busy.value).toBe(true)
  })

  it('counts the seconds of a recording, also across a pause', async () => {
    const { voice, port } = setup()
    voice.start()
    port().receive({ state: 'recording', limit: 300_000, elapsed: 0 })
    await vi.advanceTimersByTimeAsync(2_100)
    expect(voice.clock.value).toBe('0:02')
    port().receive({ state: 'paused', elapsed: 300_000 })
    expect(voice.clock.value).toBe('5:00')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(voice.clock.value).toBe('5:00')
    port().receive({ state: 'recording', limit: 300_000, elapsed: 300_000 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(voice.clock.value).toBe('5:01')
  })

  it('stops into a pin or a note, and is idle once the background took it', () => {
    const handed = vi.fn()
    const { voice, port } = setup({ handed })
    voice.start()
    port().receive({ state: 'recording', limit: 300_000, elapsed: 0 })
    expect(voice.stop({ pin: 'a1' })).toBe(true)
    expect(port().posted.at(-1)).toEqual({ type: 'stop', keep: { pin: 'a1' } })
    port().receive({ state: 'handed', to: { pin: 'a1' } })
    expect(handed).toHaveBeenCalledWith({ pin: 'a1' })
    expect(voice.state.value).toEqual({ state: 'idle' })
    expect(voice.busy.value).toBe(false)
  })

  it('hands over a recording that ended by itself, for Retry', () => {
    const { voice, port } = setup()
    voice.start()
    port().receive({ state: 'failed', error: 'mic-lost', retry: true })
    expect(voice.holds.value).toBe(true)
    expect(voice.stop({ note: true })).toBe(true)
    expect(port().posted.at(-1)).toEqual({ type: 'stop', keep: { note: true } })
  })

  it('cancels instead of stopping while the microphone starts: nothing was recorded', () => {
    const { voice, port } = setup()
    voice.start()
    expect(voice.stop({ pin: 'a1' })).toBe(false)
    expect(port().posted.at(-1)).toEqual({ type: 'cancel' })
  })

  it('has nothing to stop while idle', () => {
    const { voice, connect } = setup()
    expect(voice.stop({ pin: 'a1' })).toBe(false)
    expect(connect).not.toHaveBeenCalled()
  })

  it('asks at the limit; without an answer it stops after a minute', async () => {
    const timedOut = vi.fn()
    const { voice, port } = setup({ timedOut })
    voice.start()
    port().receive({ state: 'paused', elapsed: 300_000 })
    expect(voice.paused.value).toBe(true)
    expect(ASK_WAIT).toBe(60_000)
    await vi.advanceTimersByTimeAsync(ASK_WAIT - 1)
    expect(timedOut).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(timedOut).toHaveBeenCalledTimes(1)
  })

  it('stops waiting for the answer once the developer gave one', async () => {
    const timedOut = vi.fn()
    const { voice, port } = setup({ timedOut })
    voice.start()
    port().receive({ state: 'paused', elapsed: 300_000 })
    voice.resume()
    expect(port().posted.at(-1)).toEqual({ type: 'resume' })
    port().receive({ state: 'recording', limit: 300_000, elapsed: 300_000 })
    await vi.advanceTimersByTimeAsync(ASK_WAIT)
    expect(timedOut).not.toHaveBeenCalled()
  })

  it('passes a request to hand over on', () => {
    const yielded = vi.fn()
    const { voice, port } = setup({ yielded })
    voice.start()
    port().receive({ state: 'yield' })
    expect(yielded).toHaveBeenCalledTimes(1)
  })

  it('sends cancel while busy only', () => {
    const { voice, port } = setup()
    voice.start()
    voice.cancel()
    expect(port().posted.at(-1)).toEqual({ type: 'cancel' })
    port().receive({ state: 'idle' })
    voice.cancel()
    expect(port().posted).toHaveLength(2)
  })

  it('forgets a failure that is over, never one that holds a recording', () => {
    const { voice, port } = setup()
    voice.start()
    port().receive({ state: 'failed', error: 'no-key', retry: false })
    voice.clear()
    expect(voice.state.value).toEqual({ state: 'idle' })
    voice.start()
    port().receive({ state: 'failed', error: 'mic-lost', retry: true })
    voice.clear()
    expect(voice.holds.value).toBe(true)
  })

  it('takes a recording as interrupted when the line breaks', () => {
    const { voice, port } = setup()
    voice.start()
    port().receive({ state: 'recording', limit: 300_000, elapsed: 0 })
    port().close()
    expect(voice.state.value).toEqual({ state: 'failed', error: 'interrupted', retry: false })
  })

  it('ignores a broken line while idle, and malformed states', () => {
    const { voice, port } = setup()
    voice.start()
    port().receive({ state: 'idle' })
    port().receive({ state: 'recording' })
    port().receive({ state: 'transcribing' })
    port().close()
    expect(voice.state.value).toEqual({ state: 'idle' })
  })

  it('lets go of the line when its owner goes', async () => {
    const { voice, host, port } = setup()
    voice.start()
    const line = port()
    host.unmount()
    expect(line.disconnected).toBe(true)
  })
})
