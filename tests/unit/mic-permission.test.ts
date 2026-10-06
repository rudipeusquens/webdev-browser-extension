import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import App from '@/entrypoints/mic-permission/App.vue'
import { askMicrophone } from '@/entrypoints/mic-permission/ask'

function stream() {
  const track = { stop: vi.fn() }
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream }
}

function stubMicrophone(getUserMedia: () => Promise<MediaStream>) {
  const fn = vi.fn(getUserMedia)
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: fn },
    configurable: true,
  })
  return fn
}

const refuse = (name: string) => async () => {
  throw new DOMException('no', name)
}

describe('askMicrophone', () => {
  it('asks for audio only and lets the microphone go at once', async () => {
    const { track, stream: s } = stream()
    const getUserMedia = vi.fn(async () => s)
    expect(await askMicrophone({ getUserMedia })).toBe('allowed')
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(track.stop).toHaveBeenCalled()
  })

  it.each([
    ['NotAllowedError', 'blocked'],
    ['SecurityError', 'blocked'],
    ['NotFoundError', 'missing'],
    ['OverconstrainedError', 'missing'],
    ['NotReadableError', 'failed'],
  ])('maps %s to %s', async (name, result) => {
    expect(await askMicrophone({ getUserMedia: refuse(name) })).toBe(result)
  })
})

describe('the microphone page', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeBrowser.reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('asks on load, says it worked and closes its tab', async () => {
    const { track, stream: s } = stream()
    const getUserMedia = stubMicrophone(async () => s)
    vi.spyOn(fakeBrowser.tabs, 'getCurrent').mockResolvedValue({ id: 9 } as never)
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined)
    const page = mount(App)
    await flushPromises()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalled()
    expect(page.text()).toContain('Microphone allowed. You can close this tab.')
    expect(remove).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(remove).toHaveBeenCalledWith(9)
    page.unmount()
  })

  it('explains a refusal and asks again on Try again', async () => {
    const getUserMedia = stubMicrophone(refuse('NotAllowedError'))
    const page = mount(App)
    await flushPromises()
    expect(page.text()).toContain('Chrome did not allow the microphone')
    expect(page.text()).toMatch(/site settings/)
    const retry = page.find('[data-testid="mic-retry"]')
    await retry.trigger('click')
    await flushPromises()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    page.unmount()
  })

  it.each([
    ['NotFoundError', 'No microphone found.'],
    ['NotReadableError', 'The microphone could not start.'],
  ])('says what %s means', async (name, text) => {
    stubMicrophone(refuse(name))
    const page = mount(App)
    await flushPromises()
    expect(page.text()).toContain(text)
    page.unmount()
  })

  it('says what the recording is for before Chrome asks', async () => {
    stubMicrophone(() => new Promise(() => undefined))
    const page = mount(App)
    await flushPromises()
    expect(page.text()).toMatch(/only while you dictate/i)
    expect(page.text()).toContain('OpenRouter')
    page.unmount()
  })
})
