import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { isBlocked, markBlocked } from '@/lib/background/tab-status'
import { loadCollection } from '@/lib/collection/store'
import background from '@/entrypoints/background'
import { elementInput } from './helpers/collection'

const tab = { id: 5, windowId: 1 } as Parameters<
  Parameters<typeof fakeBrowser.action.onClicked.addListener>[0]
>[0]
const flush = () => new Promise((done) => setTimeout(done, 0))

describe('background', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.spyOn(fakeBrowser.sidePanel, 'open').mockResolvedValue(undefined)
    background.main()
  })

  afterEach(() => vi.restoreAllMocks())

  it('opens the panel before anything is awaited and injects the overlay', async () => {
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    await fakeBrowser.action.onClicked.trigger(tab)
    expect(fakeBrowser.sidePanel.open).toHaveBeenCalledWith({ windowId: 1 })
    expect(inject).toHaveBeenCalledWith({
      target: { tabId: 5 },
      files: ['/content-scripts/overlay.js'],
    })
  })

  it('marks a tab that refuses injection and clears it after a later success', async () => {
    const inject = vi
      .spyOn(fakeBrowser.scripting, 'executeScript')
      .mockRejectedValueOnce(new Error('Cannot access a chrome:// URL'))
      .mockResolvedValueOnce([] as never)
    await fakeBrowser.action.onClicked.trigger(tab)
    await flush()
    expect(await isBlocked(5)).toBe(true)
    await fakeBrowser.action.onClicked.trigger(tab)
    await flush()
    expect(await isBlocked(5)).toBe(false)
    expect(inject).toHaveBeenCalledTimes(2)
  })

  it('survives a side panel that fails to open', async () => {
    vi.spyOn(fakeBrowser.sidePanel, 'open').mockRejectedValue(new Error('no window'))
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    await fakeBrowser.action.onClicked.trigger(tab)
    await flush()
    expect(inject).toHaveBeenCalled()
  })

  it('clears the blocked flag when the tab navigates or closes', async () => {
    await markBlocked(5)
    await fakeBrowser.tabs.onUpdated.trigger(5, { status: 'loading' }, tab as never)
    await flush()
    expect(await isBlocked(5)).toBe(false)
    await markBlocked(5)
    await fakeBrowser.tabs.onRemoved.trigger(5, { windowId: 1, isWindowClosing: false })
    await flush()
    expect(await isBlocked(5)).toBe(false)
  })

  it('writes an annotation sent from a content script', async () => {
    const reply = await send(
      { type: 'annotation:add', ...elementInput('a1', 'http://x.test/') },
      {
        id: fakeBrowser.runtime.id,
        tab,
      },
    )
    expect(reply).toEqual({ ok: true })
    expect((await loadCollection()).items).toHaveLength(1)
  })

  it('ignores other senders, invalid messages and adds without a tab', async () => {
    const message = { type: 'annotation:add', ...elementInput('a1', 'http://x.test/') }
    expect(await send(message, { id: 'other-extension', tab })).toBeUndefined()
    expect(
      await send({ type: 'annotation:nope' }, { id: fakeBrowser.runtime.id, tab }),
    ).toBeUndefined()
    expect(await send(message, { id: fakeBrowser.runtime.id })).toMatchObject({ ok: false })
    expect((await loadCollection()).items).toHaveLength(0)
  })
})

/** Delivers `message` to the background's onMessage listeners; resolves with the reply. */
async function send(message: unknown, sender: object): Promise<unknown> {
  let reply: unknown
  const responded = new Promise<void>((done) => {
    void fakeBrowser.runtime.onMessage
      .trigger(message, sender, (value: unknown) => {
        reply = value
        done()
      })
      .then((results: unknown[]) => {
        if (!results.includes(true)) done()
      })
  })
  await responded
  return reply
}
