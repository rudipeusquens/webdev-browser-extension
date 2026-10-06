import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { isBlocked, isFailed, markBlocked, markFailed } from '@/lib/background/tab-status'
import { loadMissing } from '@/lib/background/anchor-status'
import { loadSettings, SETTINGS_KEY } from '@/lib/settings'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { collectionKey, LEGACY_KEY, loadSite } from '@/lib/collection/store'
import background from '@/entrypoints/background'
import { vueOrigins } from '@/lib/capture/origin-bridge'
import { elementInput, legacyOf } from './helpers/collection'
import { fakeContextMenus } from './helpers/fake-context-menus'
import { fakePorts } from './helpers/fake-ports'
import { fakeSites } from './helpers/fake-sites'

const tab = { id: 5, windowId: 1 } as Parameters<
  Parameters<typeof fakeBrowser.action.onClicked.addListener>[0]
>[0]
const flush = () => new Promise((done) => setTimeout(done, 0))

/** The overlay in the top frame of `tab`, on the page `url`. */
const pageSender = (url: string, frameId = 0) => ({
  id: fakeBrowser.runtime.id,
  tab,
  frameId,
  url,
  documentId: 'doc-1',
})
const panelSender = {
  id: fakeBrowser.runtime.id,
  url: fakeBrowser.runtime.getURL('/sidepanel.html'),
}

/** No side panel is open: nothing answers a message from the background. */
const noPanel = () =>
  vi
    .spyOn(fakeBrowser.runtime, 'sendMessage')
    .mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'))

describe('background', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    fakeSites()
    fakeContextMenus()
    noPanel()
    vi.spyOn(fakeBrowser.sidePanel, 'open').mockResolvedValue(undefined)
    fakePorts()
    background.main()
  })

  afterEach(() => vi.restoreAllMocks())

  it('opens the panel before anything is awaited and injects the overlay', async () => {
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    const clicked = fakeBrowser.action.onClicked.trigger(tab)
    // Synchronously, inside the click: Chrome refuses sidePanel.open() after an await.
    expect(fakeBrowser.sidePanel.open).toHaveBeenCalledWith({ windowId: 1 })
    await clicked
    await vi.waitFor(() =>
      expect(inject).toHaveBeenCalledWith({
        target: { tabId: 5 },
        files: ['/content-scripts/overlay.js'],
      }),
    )
  })

  it('leaves the page alone when the open panel closes on a click', async () => {
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    const asked = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValue({ closing: true } as never)
    const clicked = fakeBrowser.action.onClicked.trigger(tab)
    expect(fakeBrowser.sidePanel.open).toHaveBeenCalledWith({ windowId: 1 })
    await clicked
    await flush()
    expect(asked).toHaveBeenCalledWith({ type: 'panel:toggle', windowId: 1, tabId: 5 })
    expect(inject).not.toHaveBeenCalled()
  })

  it.each([
    ['the open panel stays open', { closing: false }],
    ['nothing answers', undefined],
    ['the answer is malformed', { closing: 'yes' }],
  ])('activates the page when %s', async (_, reply) => {
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(reply as never)
    await fakeBrowser.action.onClicked.trigger(tab)
    await vi.waitFor(() => expect(inject).toHaveBeenCalled())
  })

  it('starts the overlay on a tab for the panel only', async () => {
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    const start = { type: 'tab:start', tabId: 7 }
    expect(await send(start, pageSender('http://localhost:3000/'))).toMatchObject({ ok: false })
    expect(await send(start, { id: fakeBrowser.runtime.id })).toMatchObject({ ok: false })
    expect(inject).not.toHaveBeenCalled()
    await markFailed(7)
    expect(await send(start, panelSender)).toEqual({ ok: true })
    expect(inject).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['/content-scripts/overlay.js'],
    })
    expect(await isFailed(7)).toBe(false)
  })

  it('says when Chrome gives the panel no access to the tab, and marks nothing', async () => {
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockRejectedValue(
      new Error('Cannot access contents of the page.'),
    )
    const reply = await send({ type: 'tab:start', tabId: 7 }, panelSender)
    expect(reply).toMatchObject({ ok: false })
    expect((reply as { error: string }).error).toContain('toolbar icon')
    expect(await isBlocked(7)).toBe(false)
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

  it('records an overlay that did not start, for its tab, from the top frame only', async () => {
    const top = { id: fakeBrowser.runtime.id, tab, frameId: 0 }
    expect(await send({ type: 'overlay:failed' }, { ...top, frameId: 2 })).toMatchObject({
      ok: false,
    })
    expect(await send({ type: 'overlay:failed' }, { id: fakeBrowser.runtime.id })).toMatchObject({
      ok: false,
    })
    expect(await isFailed(5)).toBe(false)
    expect(await send({ type: 'overlay:failed' }, top)).toEqual({ ok: true })
    expect(await isFailed(5)).toBe(true)
  })

  it('forgets a failed start when the tab navigates, closes or is activated again', async () => {
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    await markFailed(5)
    await fakeBrowser.tabs.onUpdated.trigger(5, { status: 'loading' }, tab as never)
    await flush()
    expect(await isFailed(5)).toBe(false)
    await markFailed(5)
    await fakeBrowser.tabs.onRemoved.trigger(5, { windowId: 1, isWindowClosing: false })
    await flush()
    expect(await isFailed(5)).toBe(false)
    await markFailed(5)
    await fakeBrowser.action.onClicked.trigger(tab)
    await flush()
    expect(await isFailed(5)).toBe(false)
  })

  it('writes an annotation sent from a content script, to the site of its page', async () => {
    const reply = await send(
      { type: 'annotation:add', ...elementInput('a1', 'http://x.test/a') },
      pageSender('http://x.test/b'),
    )
    expect(reply).toEqual({ ok: true })
    expect((await loadSite('http://x.test')).items).toHaveLength(1)
  })

  it('ignores other senders, invalid messages and adds without a tab', async () => {
    const message = { type: 'annotation:add', ...elementInput('a1', 'http://x.test/') }
    expect(await send(message, { id: 'other-extension', tab })).toBeUndefined()
    expect(
      await send({ type: 'annotation:nope' }, { id: fakeBrowser.runtime.id, tab }),
    ).toBeUndefined()
    expect(await send(message, { id: fakeBrowser.runtime.id })).toMatchObject({ ok: false })
    expect(await send(message, panelSender)).toMatchObject({ ok: false })
    expect((await loadSite('http://x.test')).items).toHaveLength(0)
  })

  it('takes copies and reopens from the panel only, restores from the page or the panel', async () => {
    const site = 'http://x.test'
    const status = async () => (await loadSite(site)).items[0]?.status
    await send(
      { type: 'annotation:add', ...elementInput('a1', `${site}/`) },
      pageSender(`${site}/`),
    )
    const copied = { type: 'collection:copied', site, ids: ['a1'] }
    const reopen = { type: 'annotation:reopen', site, id: 'a1' }
    const restore = { type: 'annotation:restore', site, id: 'a1' }
    expect(await send(copied, pageSender(`${site}/`))).toMatchObject({ ok: false })
    expect(await send(copied, { id: fakeBrowser.runtime.id })).toMatchObject({ ok: false })
    expect(await status()).toBe('open')
    expect(await send(copied, panelSender)).toEqual({ ok: true })
    expect(await status()).toBe('done')
    expect(await send(reopen, pageSender(`${site}/`))).toMatchObject({ ok: false })
    expect(await status()).toBe('done')
    expect(await send(reopen, panelSender)).toEqual({ ok: true })
    expect(await status()).toBe('open')
    await send({ type: 'annotation:remove', site, id: 'a1' }, pageSender(`${site}/`))
    expect(await status()).toBe('deleted')
    expect(await send(restore, pageSender('http://y.test/'))).toMatchObject({ ok: false })
    expect(await status()).toBe('deleted')
    expect(await send(restore, pageSender(`${site}/other`))).toEqual({ ok: true })
    expect(await status()).toBe('open')
    await send({ type: 'annotation:remove', site, id: 'a1' }, panelSender)
    expect(await send(restore, panelSender)).toEqual({ ok: true })
    expect(await status()).toBe('open')
  })

  it('undoes and redoes for the panel only', async () => {
    const site = 'http://x.test'
    const status = async () => (await loadSite(site)).items[0]?.status
    await send(
      { type: 'annotation:add', ...elementInput('a1', `${site}/`) },
      pageSender(`${site}/`),
    )
    await send({ type: 'annotation:remove', site, id: 'a1' }, panelSender)
    const undo = { type: 'history:undo', site }
    expect(await send(undo, pageSender(`${site}/`))).toMatchObject({ ok: false })
    expect(await status()).toBe('deleted')
    expect(await send(undo, panelSender)).toEqual({ ok: true })
    expect(await status()).toBe('open')
    expect(await send({ type: 'history:redo', site }, pageSender(`${site}/`))).toMatchObject({
      ok: false,
    })
    expect(await send({ type: 'history:redo', site }, panelSender)).toEqual({ ok: true })
    expect(await status()).toBe('deleted')
  })

  it('keeps the filter the panel chose, for every page to read', async () => {
    expect(
      await send({ type: 'view:set', filter: 'all' }, pageSender('http://x.test/')),
    ).toMatchObject({ ok: false })
    expect((await fakeBrowser.storage.local.get('view')).view).toBeUndefined()
    expect(await send({ type: 'view:set', filter: 'all' }, panelSender)).toEqual({ ok: true })
    expect((await fakeBrowser.storage.local.get('view')).view).toEqual({ filter: 'all' })
  })

  it('refuses items for another site than the page that sends them', async () => {
    const message = { type: 'annotation:add', ...elementInput('a1', 'http://x.test/') }
    for (const sender of [
      pageSender('http://y.test/'),
      pageSender('https://x.test/'),
      pageSender('http://x.test/', 2),
      { id: fakeBrowser.runtime.id, tab, frameId: 0 },
    ]) {
      expect(await send(message, sender)).toMatchObject({ ok: false })
    }
    expect(await fakeBrowser.storage.local.get(null)).toEqual({})
  })

  it('changes items only for the site of the page or for the panel', async () => {
    const site = 'http://x.test'
    await send(
      { type: 'annotation:add', ...elementInput('a1', `${site}/`) },
      pageSender(`${site}/`),
    )
    const update = { type: 'annotation:update', site, id: 'a1', comment: 'Changed' }
    const remove = { type: 'annotation:remove', site, id: 'a1' }
    const clear = { type: 'collection:clear', site }
    for (const message of [update, remove, clear]) {
      expect(await send(message, pageSender('http://y.test/'))).toMatchObject({ ok: false })
      expect(await send(message, pageSender(`${site}/`, 1))).toMatchObject({ ok: false })
    }
    expect(await send(clear, pageSender(`${site}/`))).toMatchObject({ ok: false })
    expect(await send(update, panelSender)).toMatchObject({ ok: false })
    expect((await loadSite(site)).items).toHaveLength(1)
    expect(await send(update, pageSender(`${site}/other`))).toEqual({ ok: true })
    expect(await send(remove, panelSender)).toEqual({ ok: true })
    expect(await send(clear, panelSender)).toEqual({ ok: true })
    expect((await loadSite(site)).items).toEqual([])
  })
})

describe('background: code origins', () => {
  const contentScript = { id: fakeBrowser.runtime.id, tab, frameId: 0, documentId: 'doc-1' }
  const read = { type: 'origin:read', selectors: ['#save', 'main'] }
  const card = { name: 'Card', file: '/srv/app/src/components/Card.vue' }

  beforeEach(() => {
    fakeBrowser.reset()
    fakeSites()
    fakeContextMenus()
    fakePorts()
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
  const contentScript = pageSender('http://x.test/a')
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
    fakeContextMenus()
    fakePorts()
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

  it('accepts reports from pages only, and forgets the site on Clear all', async () => {
    expect(await send(report(A, [], ['a1']), { id: fakeBrowser.runtime.id })).toMatchObject({
      ok: false,
    })
    expect((await loadMissing()).size).toBe(0)
    await send(report(A, [], ['a1']), contentScript)
    expect((await loadMissing()).size).toBe(1)
    await send({ type: 'collection:clear', site: 'http://x.test' }, panelSender)
    expect((await loadMissing()).size).toBe(0)
  })

  it('counts a report only for the site of the page that sent it', async () => {
    const other = 'http://y.test/a'
    await send({ type: 'annotation:add', ...elementInput('y1', other) }, pageSender(other))
    expect(await send(report(other, [], ['y1']), contentScript)).toMatchObject({ ok: false })
    expect((await loadMissing()).size).toBe(0)
    await send(report(other, [], ['y1']), pageSender(other))
    // Clearing one site keeps what another site's pages reported.
    await send({ type: 'collection:clear', site: 'http://x.test' }, panelSender)
    expect([...(await loadMissing())]).toEqual(['y1'])
  })
})

describe('background: remembered sites', () => {
  const A = 'http://localhost:3000'
  const panel = { id: fakeBrowser.runtime.id }
  let fake: ReturnType<typeof fakeSites>

  beforeEach(() => {
    fakeBrowser.reset()
    fake = fakeSites([`${A}/*`])
    fakeContextMenus()
    fakePorts()
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

  it('sets an option for the panel only, and keeps the remembered sites', async () => {
    await send({ type: 'site:remember', origin: A }, panel)
    const set = { type: 'settings:set', key: 'pageTitles', value: true }
    expect(await send(set, pageSender(`${A}/`))).toMatchObject({ ok: false })
    expect(await send(set, { id: fakeBrowser.runtime.id })).toMatchObject({ ok: false })
    expect((await loadSettings()).pageTitles).toBe(false)
    expect(await send(set, panelSender)).toEqual({ ok: true })
    expect(await loadSettings()).toEqual({
      rememberedOrigins: [A],
      pageTitles: true,
      contextMenu: false,
    })
  })

  it('writes options and remembered sites one after another', async () => {
    const on = { type: 'settings:set', key: 'contextMenu', value: true }
    await Promise.all([
      send({ type: 'site:remember', origin: A }, panel),
      send(on, panelSender),
      send({ type: 'settings:set', key: 'pageTitles', value: true }, panelSender),
    ])
    expect(await loadSettings()).toEqual({
      rememberedOrigins: [A],
      pageTitles: true,
      contextMenu: true,
    })
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

  it('rewrites the registration even when the context menu cannot be written', async () => {
    vi.spyOn(fakeBrowser.contextMenus, 'removeAll').mockImplementation(() => {
      throw new Error('contextMenus is not available')
    })
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { rememberedOrigins: [A] } })
    await fakeBrowser.runtime.onStartup.trigger().catch(() => undefined)
    await fakeBrowser.runtime.onInstalled
      .trigger({ reason: 'update' } as never)
      .catch(() => undefined)
    await vi.waitFor(() => expect(fake.state.scripts.get('overlay')?.matches).toEqual([`${A}/*`]))
  })
})

describe('background: go to a page of the collection', () => {
  const panel = { id: fakeBrowser.runtime.id }
  const page = 'http://localhost:3000/settings'

  beforeEach(async () => {
    fakeBrowser.reset()
    fakeSites()
    fakeContextMenus()
    fakePorts()
    background.main()
    await send({ type: 'annotation:add', ...elementInput('a1', page) }, pageSender(page))
    const file = 'file:///srv/app/index.html'
    await send({ type: 'annotation:add', ...elementInput('f1', file) }, pageSender(file))
    vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never)
  })

  afterEach(() => vi.restoreAllMocks())

  it('opens a page of the collection in the tab', async () => {
    const going = send({ type: 'tab:go', tabId: 9, pageKey: page }, panel)
    await vi.waitFor(() => expect(fakeBrowser.tabs.update).toHaveBeenCalledWith(9, { url: page }))
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    await fakeBrowser.tabs.onUpdated.trigger(9, { status: 'complete' }, { id: 9 } as never)
    expect(await going).toEqual({ ok: true })
  })

  it('refuses pages outside the collection, file pages and requests from a tab', async () => {
    for (const [pageKey, sender] of [
      ['http://localhost:3000/other', panel],
      ['file:///srv/app/index.html', panel],
      [page, { ...panel, tab }],
    ] as const) {
      expect(await send({ type: 'tab:go', tabId: 9, pageKey }, sender)).toMatchObject({ ok: false })
    }
    expect(fakeBrowser.tabs.update).not.toHaveBeenCalled()
  })
})

describe('background: the collection of milestones 2–5', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is split by site when the background starts, before any write', async () => {
    fakeBrowser.reset()
    fakeSites()
    fakeContextMenus()
    fakePorts()
    const a = addAnnotation(
      emptyCollection('http://x.test'),
      elementInput('a1', 'http://x.test/'),
      'T',
    )
    const b = addAnnotation(
      emptyCollection('http://y.test'),
      elementInput('b1', 'http://y.test/'),
      'T',
    )
    await fakeBrowser.storage.local.set({ [LEGACY_KEY]: legacyOf(a, b) })
    background.main()
    const reply = await send(
      { type: 'annotation:add', ...elementInput('a2', 'http://x.test/') },
      pageSender('http://x.test/'),
    )
    expect(reply).toEqual({ ok: true })
    const stored = await fakeBrowser.storage.local.get(null)
    expect(Object.keys(stored).sort()).toEqual([
      collectionKey('http://x.test'),
      collectionKey('http://y.test'),
    ])
    // a1 was 1 and b1 2 in the old collection: every site goes on at 3.
    expect((await loadSite('http://x.test')).items.map((i) => [i.id, i.number])).toEqual([
      ['a1', 1],
      ['a2', 3],
    ])
  })
})

describe('background: the page context menu', () => {
  let menus: ReturnType<typeof fakeContextMenus>

  beforeEach(() => {
    fakeBrowser.reset()
    fakeSites()
    menus = fakeContextMenus()
    vi.spyOn(fakeBrowser.sidePanel, 'open').mockResolvedValue(undefined)
    fakePorts()
    background.main()
  })

  afterEach(() => vi.restoreAllMocks())

  const menuOn = () =>
    fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: { rememberedOrigins: [], pageTitles: false, contextMenu: true },
    })

  it('has no entry while the option is off, and removes one an older version left', async () => {
    menus.entries.set('annotate', { id: 'annotate' } as never)
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update' } as never)
    await flush()
    expect([...menus.entries.keys()]).toEqual([])
    await fakeBrowser.runtime.onStartup.trigger()
    await flush()
    expect([...menus.entries.keys()]).toEqual([])
  })

  it('adds and removes the entry when the panel turns the option on and off', async () => {
    const set = (value: boolean) =>
      send({ type: 'settings:set', key: 'contextMenu', value }, panelSender)
    expect(await set(true)).toEqual({ ok: true })
    await vi.waitFor(() => expect([...menus.entries.keys()]).toEqual(['annotate']))
    expect(await set(false)).toEqual({ ok: true })
    await vi.waitFor(() => expect([...menus.entries.keys()]).toEqual([]))
    expect(menus.duplicates).toEqual([])
  })

  it('offers "Annotate this page" on pages once installed, and still once after an update', async () => {
    await menuOn()
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' } as never)
    await flush()
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update' } as never)
    await flush()
    expect([...menus.entries.values()]).toEqual([
      {
        id: 'annotate',
        title: 'Annotate this page',
        contexts: ['page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio'],
        documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'],
      },
    ])
    expect(menus.duplicates).toEqual([])
  })

  it('writes the entry again when the browser starts', async () => {
    // Chrome restores it from its own storage; a lost one comes back with the next start.
    await menuOn()
    await fakeBrowser.runtime.onStartup.trigger()
    await flush()
    expect([...menus.entries.keys()]).toEqual(['annotate'])
  })

  it('opens the panel before anything is awaited and injects the overlay', async () => {
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as never)
    // The entry only ever opens: an open panel is not asked to close.
    const asked = vi.spyOn(fakeBrowser.runtime, 'sendMessage')
    menus.click('annotate', tab)
    // Synchronously, inside the click: Chrome refuses sidePanel.open() after an await.
    expect(fakeBrowser.sidePanel.open).toHaveBeenCalledWith({ windowId: 1 })
    await flush()
    expect(inject).toHaveBeenCalledWith({
      target: { tabId: 5 },
      files: ['/content-scripts/overlay.js'],
    })
    expect(asked).not.toHaveBeenCalled()
  })

  it('ignores other entries and clicks outside a tab', async () => {
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript')
    menus.click('other', tab)
    menus.click('annotate', undefined)
    await flush()
    expect(fakeBrowser.sidePanel.open).not.toHaveBeenCalled()
    expect(inject).not.toHaveBeenCalled()
  })

  it('injects nothing for a page that is not in a tab', async () => {
    // Chrome reports tab id -1 for a frame in another extension's panel, for example.
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript')
    menus.click('annotate', { ...tab, id: -1 })
    await flush()
    expect(inject).not.toHaveBeenCalled()
    expect(await isBlocked(-1)).toBe(false)
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
