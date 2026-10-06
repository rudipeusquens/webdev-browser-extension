import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { isBlocked, markBlocked } from '@/lib/background/tab-status'
import { loadMissing } from '@/lib/background/anchor-status'
import { loadSettings, SETTINGS_KEY } from '@/lib/settings'
import { loadCollection } from '@/lib/collection/store'
import background from '@/entrypoints/background'
import { vueOrigins } from '@/lib/capture/origin-bridge'
import { elementInput } from './helpers/collection'
import { fakeSites } from './helpers/fake-sites'

const tab = { id: 5, windowId: 1 } as Parameters<
  Parameters<typeof fakeBrowser.action.onClicked.addListener>[0]
>[0]
const flush = () => new Promise((done) => setTimeout(done, 0))

describe('background', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    fakeSites()
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

describe('background: code origins', () => {
  const contentScript = { id: fakeBrowser.runtime.id, tab, frameId: 0, documentId: 'doc-1' }
  const read = { type: 'origin:read', selectors: ['#save', 'main'] }
  const card = { name: 'Card', file: '/srv/app/src/components/Card.vue' }

  beforeEach(() => {
    fakeBrowser.reset()
    fakeSites()
    background.main()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("reads them in the page's own world, in the document that asked", async () => {
    const run = vi
      .spyOn(fakeBrowser.scripting, 'executeScript')
      .mockResolvedValue([
        { result: [{ chain: [card] }, null], documentId: 'doc-1', frameId: 0 },
      ] as never)
    expect(await send(read, contentScript)).toEqual({
      ok: true,
      origins: [{ framework: 'vue', chain: [card] }, null],
    })
    expect(run).toHaveBeenCalledWith({
      target: { tabId: 5, documentIds: ['doc-1'] },
      world: 'MAIN',
      func: vueOrigins,
      args: [['#save', 'main']],
    })
  })

  it('answers only the top frame of a tab', async () => {
    const run = vi.spyOn(fakeBrowser.scripting, 'executeScript')
    const panel = { id: fakeBrowser.runtime.id }
    for (const sender of [
      panel,
      { ...contentScript, frameId: 3 },
      { ...contentScript, documentId: undefined },
    ]) {
      expect(await send(read, sender)).toMatchObject({ ok: false })
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('gives no origins when the page refuses, answers garbage or takes too long', async () => {
    const run = vi.spyOn(fakeBrowser.scripting, 'executeScript')
    run.mockRejectedValueOnce(new Error('Frame with ID 0 was removed.'))
    expect(await send(read, contentScript)).toEqual({ ok: true, origins: [null, null] })
    for (const result of [
      'nope',
      [{ chain: [card] }],
      [{ chain: 'x' }, { chain: [{ file: 7 }] }],
    ]) {
      run.mockResolvedValueOnce([{ result, documentId: 'doc-1', frameId: 0 }] as never)
      expect(await send(read, contentScript)).toEqual({ ok: true, origins: [null, null] })
    }
    vi.useFakeTimers()
    run.mockReturnValueOnce(new Promise(() => undefined) as never)
    const slow = send(read, contentScript)
    await vi.advanceTimersByTimeAsync(1500)
    expect(await slow).toEqual({ ok: true, origins: [null, null] })
  })
})

describe('background: items not found', () => {
  const contentScript = { id: fakeBrowser.runtime.id, tab, frameId: 0, documentId: 'doc-1' }
  const A = 'http://x.test/a'
  const B = 'http://x.test/b'
  const report = (pageKey: string, found: string[], missing: string[]) => ({
    type: 'anchors:report',
    pageKey,
    found,
    missing,
  })

  beforeEach(async () => {
    fakeBrowser.reset()
    fakeSites()
    background.main()
    for (const [id, url] of [
      ['a1', A],
      ['a2', A],
      ['b1', B],
    ] as const) {
      await send({ type: 'annotation:add', ...elementInput(id, url) }, contentScript)
    }
  })

  afterEach(() => vi.restoreAllMocks())

  it("keeps the missing items of the reporting page's own items only", async () => {
    expect(await send(report(A, ['a1'], ['a2', 'b1', 'zz']), contentScript)).toEqual({ ok: true })
    expect([...(await loadMissing())]).toEqual(['a2'])
    await send(report(B, [], ['b1']), contentScript)
    expect([...(await loadMissing())].sort()).toEqual(['a2', 'b1'])
    await send(report(A, ['a2'], []), contentScript)
    expect([...(await loadMissing())]).toEqual(['b1'])
  })

  it('accepts reports from pages only, and forgets everything on Clear all', async () => {
    expect(await send(report(A, [], ['a1']), { id: fakeBrowser.runtime.id })).toMatchObject({
      ok: false,
    })
    expect((await loadMissing()).size).toBe(0)
    await send(report(A, [], ['a1']), contentScript)
    expect((await loadMissing()).size).toBe(1)
    await send({ type: 'collection:clear' }, { id: fakeBrowser.runtime.id })
    expect((await loadMissing()).size).toBe(0)
  })
})

describe('background: remembered sites', () => {
  const A = 'http://localhost:3000'
  const panel = { id: fakeBrowser.runtime.id }
  let fake: ReturnType<typeof fakeSites>

  beforeEach(() => {
    fakeBrowser.reset()
    fake = fakeSites([`${A}/*`])
    background.main()
  })

  afterEach(() => vi.restoreAllMocks())

  it('remembers and forgets a site for the panel', async () => {
    expect(await send({ type: 'site:remember', origin: A }, panel)).toEqual({ ok: true })
    expect((await loadSettings()).rememberedOrigins).toEqual([A])
    expect(await send({ type: 'site:forget', origin: A }, panel)).toEqual({ ok: true })
    expect((await loadSettings()).rememberedOrigins).toEqual([])
  })

  it('refuses site changes from a page', async () => {
    expect(await send({ type: 'site:remember', origin: A }, { ...panel, tab })).toMatchObject({
      ok: false,
    })
    expect((await loadSettings()).rememberedOrigins).toEqual([])
  })

  it('forgets a site whose access was revoked in chrome://extensions', async () => {
    await send({ type: 'site:remember', origin: A }, panel)
    fake.revoke(`${A}/*`)
    await vi.waitFor(async () => expect((await loadSettings()).rememberedOrigins).toEqual([]))
    expect(fake.state.scripts.size).toBe(0)
  })

  it('rewrites the registration after an update and starts the overlay in open tabs', async () => {
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { rememberedOrigins: [A] } })
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 7 }, { id: 8 }] as never)
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update' } as never)
    await vi.waitFor(() => expect(inject).toHaveBeenCalledTimes(2))
    expect(fakeBrowser.tabs.query).toHaveBeenCalledWith({ url: [`${A}/*`] })
    expect(inject).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['/content-scripts/overlay.js'],
    })
    expect(fake.state.scripts.get('overlay')?.matches).toEqual([`${A}/*`])
  })

  it('rewrites the registration when the browser starts', async () => {
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { rememberedOrigins: [A] } })
    await fakeBrowser.runtime.onStartup.trigger()
    await vi.waitFor(() => expect(fake.state.scripts.get('overlay')?.matches).toEqual([`${A}/*`]))
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
