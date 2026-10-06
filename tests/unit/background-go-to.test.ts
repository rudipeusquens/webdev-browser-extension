import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { goTo, LOAD_TIMEOUT } from '@/lib/background/go-to'

const complete = (tabId: number) =>
  fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId } as never)

describe('goTo', () => {
  beforeEach(() => fakeBrowser.reset())

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens the page in the tab and starts the overlay once it has loaded', async () => {
    const update = vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never)
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    const going = goTo(3, 'http://localhost:3000/settings', false)
    await vi.waitFor(() =>
      expect(update).toHaveBeenCalledWith(3, {
        url: 'http://localhost:3000/settings',
      }),
    )
    expect(inject).not.toHaveBeenCalled()
    await complete(4)
    expect(inject).not.toHaveBeenCalled()
    await complete(3)
    expect(await going).toEqual({ ok: true })
    expect(inject).toHaveBeenCalledWith({
      target: { tabId: 3 },
      files: ['/content-scripts/overlay.js'],
    })
  })

  it('leaves the overlay to a remembered site', async () => {
    vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never)
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript')
    const going = goTo(3, 'http://localhost:3000/', true)
    await vi.waitFor(() => expect(fakeBrowser.tabs.update).toHaveBeenCalled())
    await complete(3)
    expect(await going).toEqual({ ok: true })
    expect(inject).not.toHaveBeenCalled()
  })

  it('still tries the overlay when the page takes too long, and survives a refusal', async () => {
    vi.useFakeTimers()
    vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never)
    const inject = vi
      .spyOn(fakeBrowser.scripting, 'executeScript')
      .mockRejectedValue(new Error('Cannot access contents of the page.'))
    const going = goTo(3, 'https://example.com/', false)
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT)
    expect(await going).toEqual({ ok: true })
    expect(inject).toHaveBeenCalled()
  })

  it('reports a tab that cannot be opened', async () => {
    vi.spyOn(fakeBrowser.tabs, 'update').mockRejectedValue(new Error('No tab with id: 3.'))
    expect(await goTo(3, 'http://localhost:3000/', false)).toMatchObject({ ok: false })
  })
})
