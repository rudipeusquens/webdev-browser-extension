import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import App from '@/entrypoints/sidepanel/App.vue'
import { MISSING_KEY } from '@/lib/background/anchor-status'
import { SETTINGS_KEY } from '@/lib/settings'
import { markBlocked, markFailed } from '@/lib/background/tab-status'
import type { Collection } from '@/lib/collection/model'
import { addAnnotation, emptyCollection, markCopied, pick, setStatus } from '@/lib/collection/ops'
import { collectionKey } from '@/lib/collection/store'
import { formatCollection } from '@/lib/format/markdown'
import type { OverlayStatus } from '@/lib/messages'
import { elementInput, page, snapshot } from './helpers/collection'
import { fakeSites } from './helpers/fake-sites'

const SITE = 'http://localhost:3000'
const A = 'http://localhost:3000/a'
const B = 'http://localhost:3000/b'
const active: OverlayStatus = {
  host: 'localhost:3000',
  pageKey: B,
  mode: 'browse',
  pins: true,
  instance: 'one',
}

function twoPages(): Collection {
  let c = addAnnotation(emptyCollection(SITE), elementInput('a1', A, 'First on A'), 'T')
  c = addAnnotation(
    c,
    {
      ...elementInput('b1', B, 'On B <b>not bold</b>'),
      page: page(B, { title: '<img src=x onerror=alert(1)>' }),
    },
    'T',
  )
  return c
}

/** The panel's end of a line to an overlay, with a way to receive what the overlay posts. */
function panelPort() {
  const listeners: ((message: unknown) => void)[] = []
  return {
    name: 'panel',
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: { addListener: vi.fn() },
    onMessage: { addListener: (fn: (message: unknown) => void) => void listeners.push(fn) },
    receive: (message: unknown) => listeners.forEach((fn) => fn(message)),
  }
}

/** The shortcut Chrome reports for the toolbar action. */
const shortcutIs = (shortcut: string) =>
  vi
    .spyOn(fakeBrowser.commands, 'getAll')
    .mockResolvedValue([{ name: '_execute_action', shortcut, description: '' }] as never)

let wrapper: VueWrapper | undefined
let overlayReply: unknown
const writeText = vi.fn()

async function render(collection?: Collection) {
  if (collection)
    await fakeBrowser.storage.local.set({ [collectionKey(collection.site)]: collection })
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

const body = () => document.body.textContent ?? ''
const byTestId = (id: string) => {
  const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`no ${id}`)
  return el
}

describe('side panel', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    overlayReply = undefined
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 1 }] as never)
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation((async () => {
      if (overlayReply === undefined) throw new Error('Could not establish connection.')
      return overlayReply
    }) as never)
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({ ok: true } as never)
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('shows the empty state and disabled buttons', async () => {
    overlayReply = active
    await render()
    expect(body()).toContain('No feedback yet: pick an element, drag an area, or select text.')
    expect(byTestId('copy-prompt').hasAttribute('disabled')).toBe(true)
    expect(byTestId('clear-all').hasAttribute('disabled')).toBe(true)
  })

  it('groups items by page with the current page first', async () => {
    overlayReply = active
    await render(twoPages())
    const groups = [...document.querySelectorAll('[data-testid="page-group"]')]
    expect(groups).toHaveLength(2)
    expect(groups[0]?.textContent).toContain('This page')
    expect(groups[0]?.textContent).toContain('On B')
    expect(groups[1]?.textContent).toContain('First on A')
    expect(byTestId('item-count').textContent).toBe('2')
    expect(groups[1]?.querySelector('[data-testid="item-number"]')?.textContent).toBe('1')
  })

  it('renders page-derived strings and comments as text only', async () => {
    overlayReply = active
    await render(twoPages())
    expect(document.querySelector('main img')).toBeNull()
    expect(document.querySelector('main b')).toBeNull()
    expect(body()).toContain('<img src=x onerror=alert(1)>')
    expect(body()).toContain('<b>not bold</b>')
  })

  it('copies the formatted prompt and says how many items', async () => {
    overlayReply = active
    const c = twoPages()
    await render(c)
    byTestId('copy-prompt').click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(formatCollection(c))
    expect(byTestId('copy-status').textContent).toBe('Copied 2 items')
  })

  it('offers the text for manual copying when the clipboard fails', async () => {
    overlayReply = active
    const c = twoPages()
    writeText.mockRejectedValue(new DOMException('Document is not focused.'))
    await render(c)
    byTestId('copy-prompt').click()
    await flushPromises()
    const field = byTestId('copy-fallback-text') as HTMLTextAreaElement
    expect(field.value).toBe(formatCollection(c))
    expect(field.readOnly).toBe(true)
  })

  it('clears everything only after confirmation', async () => {
    overlayReply = active
    await render(twoPages())
    byTestId('clear-all').click()
    await flushPromises()
    expect(body()).toContain('2 items on 2 pages of localhost:3000')
    byTestId('clear-cancel').click()
    await flushPromises()
    expect(fakeBrowser.runtime.sendMessage).not.toHaveBeenCalled()
    byTestId('clear-all').click()
    await flushPromises()
    byTestId('clear-confirm').click()
    await flushPromises()
    expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'collection:clear',
      site: SITE,
    })
  })

  it('deletes a single item', async () => {
    overlayReply = active
    await render(twoPages())
    document.querySelector<HTMLElement>('[aria-label="Delete item 1"]')?.click()
    await flushPromises()
    expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'annotation:remove',
      site: SITE,
      id: 'a1',
    })
  })

  it('updates when the collection changes', async () => {
    overlayReply = active
    await render()
    await fakeBrowser.storage.local.set({ [collectionKey(SITE)]: twoPages() })
    await flushPromises()
    expect(document.querySelectorAll('[data-testid="item"]')).toHaveLength(2)
  })

  describe('statuses, copying and the filter', () => {
    /** a1 open, a2 done, a3 deleted on A; b1 open on B (the active page). */
    function mixed() {
      let c = twoPages()
      c = addAnnotation(c, elementInput('a2', A, 'Second on A'), 'T')
      c = addAnnotation(c, elementInput('a3', A, 'Third on A'), 'T')
      c = markCopied(c, ['a2'], 'T')
      return setStatus(c, 'a3', 'deleted', 'T')
    }
    const comments = () =>
      [...document.querySelectorAll('[data-testid="item"] .line-clamp-2')].map((e) =>
        e.textContent?.trim(),
      )
    const sent = () => vi.mocked(fakeBrowser.runtime.sendMessage).mock.calls.map(([m]) => m)

    it('copies only the open items, then marks exactly those done', async () => {
      overlayReply = active
      const c = mixed()
      await render(c)
      expect(byTestId('item-count').textContent).toBe('2')
      byTestId('copy-prompt').click()
      await flushPromises()
      expect(writeText).toHaveBeenCalledWith(formatCollection(pick(c, new Set(['a1', 'b1']))))
      expect(sent()).toContainEqual({ type: 'collection:copied', site: SITE, ids: ['a1', 'b1'] })
      expect(byTestId('copy-status').textContent).toBe('Copied 2 items')
    })

    it('marks them done also when the clipboard fails and the text is offered', async () => {
      overlayReply = active
      writeText.mockRejectedValue(new DOMException('Document is not focused.'))
      await render(mixed())
      byTestId('copy-prompt').click()
      await flushPromises()
      expect(byTestId('copy-fallback-text')).toBeTruthy()
      expect(sent()).toContainEqual({ type: 'collection:copied', site: SITE, ids: ['a1', 'b1'] })
    })

    it('cannot copy without open items', async () => {
      overlayReply = active
      await render(markCopied(twoPages(), ['a1', 'b1'], 'T'))
      expect(byTestId('copy-prompt').hasAttribute('disabled')).toBe(true)
    })

    it('copies the last copy again, without what was deleted since, and changes nothing', async () => {
      overlayReply = active
      let c = markCopied(mixed(), ['a1', 'a2', 'a3'], 'T')
      c = setStatus(c, 'a1', 'deleted', 'T')
      await render(c)
      const again = byTestId('copy-again')
      expect(again.hasAttribute('disabled')).toBe(false)
      expect(byTestId('copy-prompt').compareDocumentPosition(again)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
      expect(again.compareDocumentPosition(byTestId('clear-all'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
      again.click()
      await flushPromises()
      expect(writeText).toHaveBeenCalledWith(formatCollection(pick(c, new Set(['a2']))))
      expect(sent()).toEqual([])
      expect(byTestId('copy-status').textContent).toBe('Copied 1 item again')
    })

    it('cannot copy again before a copy', async () => {
      overlayReply = active
      await render(twoPages())
      expect(byTestId('copy-again').hasAttribute('disabled')).toBe(true)
    })

    it('shows open items first, then done ones with All, and deleted ones too', async () => {
      overlayReply = active
      await render(mixed())
      expect(comments()).toEqual(['On B <b>not bold</b>', 'First on A'])
      expect(byTestId('filter-open').textContent).toContain('2')
      expect(byTestId('filter-all').textContent).toContain('3')
      expect(byTestId('filter-with-deleted').textContent).toContain('1')
      byTestId('filter-all').click()
      await flushPromises()
      expect(sent()).toContainEqual({ type: 'view:set', filter: 'all' })
      expect(comments()).toEqual(['On B <b>not bold</b>', 'First on A', 'Second on A'])
      byTestId('filter-with-deleted').click()
      await flushPromises()
      expect(comments()).toHaveLength(4)
    })

    it('follows the filter chosen in another panel', async () => {
      overlayReply = active
      await render(mixed())
      await fakeBrowser.storage.local.set({ view: { filter: 'with-deleted' } })
      await flushPromises()
      expect(comments()).toHaveLength(4)
      expect(byTestId('filter-with-deleted').getAttribute('data-state')).toBe('on')
    })

    it('colors numbers by status and strikes deleted comments through', async () => {
      overlayReply = active
      await fakeBrowser.storage.local.set({ view: { filter: 'with-deleted' } })
      await render(mixed())
      const numbers = [...document.querySelectorAll<HTMLElement>('[data-testid="item-number"]')]
      const tone = (n: string) => numbers.find((e) => e.textContent === n)?.className ?? ''
      expect(tone('1')).toContain('bg-blue-600')
      expect(tone('3')).toContain('bg-green-700')
      expect(tone('4')).toContain('bg-red-600')
      const deleted = [...document.querySelectorAll('[data-testid="item"]')].find((e) =>
        e.textContent?.includes('Third on A'),
      )
      expect(deleted?.querySelector('.line-through')).not.toBeNull()
    })

    it('offers Delete for open and done items, Reopen for done, Restore for deleted', async () => {
      overlayReply = active
      await fakeBrowser.storage.local.set({ view: { filter: 'with-deleted' } })
      await render(mixed())
      const button = (label: string) =>
        document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
      expect(button('Delete item 1')).not.toBeNull()
      expect(button('Delete item 3')).not.toBeNull()
      expect(button('Delete item 4')).toBeNull()
      expect(button('Reopen item 1')).toBeNull()
      expect(button('Restore item 3')).toBeNull()
      button('Reopen item 3')?.click()
      button('Restore item 4')?.click()
      button('Delete item 1')?.click()
      await flushPromises()
      expect(sent()).toEqual([
        { type: 'annotation:reopen', site: SITE, id: 'a2' },
        { type: 'annotation:restore', site: SITE, id: 'a3' },
        { type: 'annotation:remove', site: SITE, id: 'a1' },
      ])
    })

    it('says how many items the filter hides when it hides them all', async () => {
      overlayReply = active
      await render(markCopied(twoPages(), ['a1', 'b1'], 'T'))
      expect(document.querySelector('[data-testid="item"]')).toBeNull()
      expect(byTestId('filter-hides').textContent).toContain('2 items')
      expect(body()).not.toContain('No feedback yet')
    })

    it('asks before clearing every item of the site', async () => {
      overlayReply = active
      await render(mixed())
      byTestId('clear-all').click()
      await flushPromises()
      expect(body()).toContain('4 items on 2 pages of localhost:3000')
    })
  })

  describe('undo and redo', () => {
    const labels = (value: object) =>
      fakeBrowser.storage.session.set({ [`historyLabels:${SITE}`]: value })
    const sent = () => vi.mocked(fakeBrowser.runtime.sendMessage).mock.calls.map(([m]) => m)
    const key = (init: KeyboardEventInit, target: EventTarget = document.body) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
      )

    it('are disabled until there is a step, and name it', async () => {
      overlayReply = active
      await render(twoPages())
      expect(byTestId('undo').hasAttribute('disabled')).toBe(true)
      expect(byTestId('redo').hasAttribute('disabled')).toBe(true)
      await labels({ undo: 'Delete item 2', redo: 'Mark 3 items done' })
      await flushPromises()
      expect(byTestId('undo').hasAttribute('disabled')).toBe(false)
      expect(byTestId('undo').title).toBe('Undo: Delete item 2 (Ctrl+Z)')
      expect(byTestId('redo').title).toBe('Redo: Mark 3 items done (Ctrl+Shift+Z)')
      byTestId('undo').click()
      byTestId('redo').click()
      await flushPromises()
      expect(sent()).toEqual([
        { type: 'history:undo', site: SITE },
        { type: 'history:redo', site: SITE },
      ])
    })

    it('sit in the title row, before the gear', async () => {
      overlayReply = active
      await render(twoPages())
      const row = byTestId('title-row')
      expect(byTestId('undo').closest('[data-testid="title-row"]')).toBe(row)
      expect(
        byTestId('redo').compareDocumentPosition(byTestId('open-settings')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('answer Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y outside text fields', async () => {
      overlayReply = active
      await labels({ undo: 'Add item 1', redo: 'Add item 2' })
      await render(twoPages())
      key({ key: 'z', ctrlKey: true })
      key({ key: 'Z', ctrlKey: true, shiftKey: true })
      key({ key: 'y', ctrlKey: true })
      await flushPromises()
      expect(sent()).toEqual([
        { type: 'history:undo', site: SITE },
        { type: 'history:redo', site: SITE },
        { type: 'history:redo', site: SITE },
      ])
      const field = document.createElement('input')
      document.body.append(field)
      key({ key: 'z', ctrlKey: true }, field)
      key({ key: 'z', metaKey: true })
      await flushPromises()
      expect(sent()).toHaveLength(3)
    })

    it('take no keys while Settings is open', async () => {
      overlayReply = active
      await labels({ undo: 'Add item 1' })
      await render(twoPages())
      byTestId('open-settings').click()
      await flushPromises()
      expect(document.querySelector('[data-testid="undo"]')).toBeNull()
      key({ key: 'z', ctrlKey: true })
      await flushPromises()
      expect(sent()).toEqual([])
    })

    it('say that Clear all can be undone', async () => {
      overlayReply = active
      await render(twoPages())
      byTestId('clear-all').click()
      await flushPromises()
      expect(body()).toContain('Undo brings them back until the browser closes.')
      expect(body()).not.toContain("can't be undone")
    })
  })

  describe('the page and the list point at each other', () => {
    let ports: ReturnType<typeof panelPort>[]
    let scrolled: string[]

    beforeEach(() => {
      ports = []
      scrolled = []
      vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({ id: 1 } as never)
      vi.spyOn(fakeBrowser.tabs, 'connect').mockImplementation(((tab: number) => {
        const port = Object.assign(panelPort(), { tab })
        ports.push(port)
        return port
      }) as never)
      Element.prototype.scrollIntoView = function () {
        scrolled.push(this.textContent ?? '')
      }
    })

    const entry = (text: string) =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="item"]')].find((e) =>
        e.textContent?.includes(text),
      )
    const pointed = () =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="item"][data-pointed]')].map((e) => [
        e.querySelector('.line-clamp-2')?.textContent?.trim(),
        e.dataset.pointed,
      ])

    it('marks the entry of the pin hovered or open on the page, and scrolls to it', async () => {
      overlayReply = active
      await render(twoPages())
      ports[0]?.receive({ type: 'pins:pointed', hovered: 'a1', open: null })
      await flushPromises()
      expect(pointed()).toEqual([['First on A', 'hovered']])
      expect(scrolled.at(-1)).toContain('First on A')
      ports[0]?.receive({ type: 'pins:pointed', hovered: null, open: 'b1' })
      await flushPromises()
      expect(pointed()).toEqual([['On B <b>not bold</b>', 'open']])
      ports[0]?.receive({ type: 'pins:pointed', hovered: 'a1', open: 'b1' })
      await flushPromises()
      expect(pointed()).toEqual([
        ['On B <b>not bold</b>', 'open'],
        ['First on A', 'hovered'],
      ])
      ports[0]?.receive({ type: 'pins:pointed', hovered: '<b>', open: null, more: 1 })
      await flushPromises()
      expect(pointed()).toHaveLength(2)
    })

    it('ignores the pins of tabs it does not show, and forgets the mark on another tab', async () => {
      overlayReply = active
      await render(twoPages())
      await fakeBrowser.runtime.onMessage.trigger(
        { type: 'overlay:changed', instance: 'other' },
        { id: fakeBrowser.runtime.id, tab: { id: 2, windowId: 1 } as never, frameId: 0 },
        () => undefined,
      )
      await flushPromises()
      const other = ports.find((p) => (p as { tab?: number }).tab === 2)
      other?.receive({ type: 'pins:pointed', hovered: 'a1', open: null })
      await flushPromises()
      expect(pointed()).toEqual([])
      ports[0]?.receive({ type: 'pins:pointed', hovered: 'a1', open: null })
      await flushPromises()
      expect(pointed()).toHaveLength(1)
      vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([{ id: 2 }] as never)
      overlayReply = { ...active, instance: 'other' }
      await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 })
      await flushPromises()
      expect(pointed()).toEqual([])
    })

    it('goes to an entry of another page, then shows it once that page is ready', async () => {
      overlayReply = active
      await render(twoPages())
      entry('First on A')?.querySelector<HTMLElement>('button')?.click()
      await flushPromises()
      expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'tab:go',
        tabId: 1,
        pageKey: A,
      })
      const reveal = () =>
        vi
          .mocked(fakeBrowser.tabs.sendMessage)
          .mock.calls.filter(([, m]) => (m as { type: string }).type === 'overlay:reveal')
      expect(reveal()).toEqual([])
      overlayReply = { ...active, pageKey: A, instance: 'two' }
      await fakeBrowser.runtime.onMessage.trigger(
        { type: 'overlay:changed', instance: 'two' },
        { id: fakeBrowser.runtime.id, tab: { id: 1, windowId: 1 } as never, frameId: 0 },
        () => undefined,
      )
      await flushPromises()
      expect(reveal()).toEqual([[1, { type: 'overlay:reveal', id: 'a1' }]])
      // Once only.
      await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 })
      await flushPromises()
      expect(reveal()).toHaveLength(1)
    })

    it('gives the jump up when something else is clicked, or after 30 seconds', async () => {
      overlayReply = active
      await render(twoPages())
      const reveals = () =>
        vi
          .mocked(fakeBrowser.tabs.sendMessage)
          .mock.calls.filter(([, m]) => (m as { type: string }).type === 'overlay:reveal')
          .map(([, m]) => (m as { id: string }).id)
      entry('First on A')?.querySelector<HTMLElement>('button')?.click()
      await flushPromises()
      entry('On B')?.querySelector<HTMLElement>('button')?.click()
      await flushPromises()
      expect(reveals()).toEqual(['b1'])
      overlayReply = { ...active, pageKey: A, instance: 'two' }
      await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 })
      await flushPromises()
      expect(reveals()).toEqual(['b1'])

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        overlayReply = active
        await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 })
        await flushPromises()
        entry('First on A')?.querySelector<HTMLElement>('button')?.click()
        await flushPromises()
        await vi.advanceTimersByTimeAsync(30_000)
        overlayReply = { ...active, pageKey: A, instance: 'three' }
        await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 })
        await flushPromises()
        expect(reveals()).toEqual(['b1'])
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('one site at a time', () => {
    const OTHER = 'http://localhost:5173'
    const onOther = () =>
      addAnnotation(emptyCollection(OTHER), elementInput('o1', `${OTHER}/`, 'On the other'), 'T')

    it('lists only the items of the active site, numbered on their own', async () => {
      await fakeBrowser.storage.local.set({ [collectionKey(OTHER)]: onOther() })
      overlayReply = active
      await render(twoPages())
      expect(body()).toContain('First on A')
      expect(body()).not.toContain('On the other')
      overlayReply = { ...active, host: 'localhost:5173', pageKey: `${OTHER}/`, instance: 'two' }
      await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 })
      await flushPromises()
      expect(body()).toContain('On the other')
      expect(body()).not.toContain('First on A')
      expect(byTestId('item-number').textContent).toBe('1')
      byTestId('copy-prompt').click()
      await flushPromises()
      expect(writeText).toHaveBeenCalledWith(formatCollection(onOther()))
    })

    it('names the site in the title row, with its full origin as tooltip', async () => {
      overlayReply = active
      await render(twoPages())
      expect(byTestId('title-site').textContent?.trim()).toBe('localhost:3000')
      expect(byTestId('title-site').title).toBe(SITE)
    })

    it('heads each page with its title and its path', async () => {
      overlayReply = active
      const c = addAnnotation(twoPages(), elementInput('q1', `${SITE}/settings?tab=2#top`), 'T')
      await render(c)
      const headings = [...document.querySelectorAll('[data-testid="page-group"] h2')]
      const paths = headings.map((h) => h.querySelector('[data-testid="page-path"]')?.textContent)
      expect(paths).toEqual(['/b', '/a', '/settings?tab=2'])
      expect(headings[1]?.textContent).toContain('Example')
    })

    it('shows no list while the tab has no active overlay', async () => {
      await render(twoPages())
      expect(body()).not.toContain('First on A')
      expect(document.querySelector('[data-testid="item"]')).toBeNull()
      expect(byTestId('no-site').textContent).toContain('Feedback is kept per site.')
      expect(body()).not.toContain('No feedback yet')
      expect(byTestId('tab-status').textContent).toContain('Not active on this page')
      expect(byTestId('copy-prompt').hasAttribute('disabled')).toBe(true)
      expect(byTestId('clear-all').hasAttribute('disabled')).toBe(true)
    })

    it('follows changes of its own site only', async () => {
      overlayReply = active
      await render(twoPages())
      await fakeBrowser.storage.local.set({ [collectionKey(OTHER)]: onOther() })
      await flushPromises()
      expect(document.querySelectorAll('[data-testid="item"]')).toHaveLength(2)
      await fakeBrowser.storage.local.remove(collectionKey(SITE))
      await flushPromises()
      expect(document.querySelector('[data-testid="item"]')).toBeNull()
    })
  })

  describe('tab status', () => {
    it('names the host when the overlay answers', async () => {
      overlayReply = active
      await render()
      expect(byTestId('tab-status').textContent).toContain('Active on localhost:3000')
    })

    it('says when the overlay did not start, and where to look', async () => {
      await markFailed(1)
      await render()
      expect(byTestId('tab-status').textContent).toContain(
        "Couldn't start on this page. Reload it and try again; the page's console has details.",
      )
    })

    it('shows a failed start as soon as it is recorded', async () => {
      await render()
      expect(byTestId('tab-status').textContent).toContain('Not active on this page')
      await markFailed(1)
      await flushPromises()
      expect(byTestId('tab-status').textContent).toContain("Couldn't start on this page")
    })

    it('says when the page refused the overlay', async () => {
      await markBlocked(1)
      await render()
      expect(byTestId('tab-status').textContent).toContain("Can't run on this page")
    })

    it('explains how to activate otherwise, with the shortcut Chrome assigned', async () => {
      shortcutIs('Ctrl+Shift+K')
      await render()
      expect(byTestId('tab-status').textContent).toContain(
        'Not active on this page. Click the toolbar icon, press Ctrl+Shift+K or right-click ' +
          'the page and choose "Annotate this page".',
      )
    })

    it.each([
      ['there is none', () => shortcutIs('')],
      ['it cannot be read', () => undefined],
    ])('names no shortcut when %s', async (_, setUp) => {
      setUp()
      await render()
      expect(byTestId('tab-status').textContent).toContain(
        'Not active on this page. Click the toolbar icon or right-click the page and choose ' +
          '"Annotate this page".',
      )
    })

    it('reads the shortcut again when a tab becomes active', async () => {
      // It changes in chrome://extensions/shortcuts, a tab of its own.
      shortcutIs('')
      await render()
      shortcutIs('Alt+Shift+K')
      await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 })
      await flushPromises()
      expect(byTestId('tab-status').textContent).toContain('press Alt+Shift+K')
    })

    it('keeps the newest shortcut when an older read answers last', async () => {
      let answerOld: (value: unknown) => void = () => undefined
      const old = new Promise((done) => (answerOld = done))
      vi.spyOn(fakeBrowser.commands, 'getAll')
        .mockReturnValueOnce(old as never)
        .mockResolvedValueOnce([{ name: '_execute_action', shortcut: 'Alt+Shift+K' }] as never)
      await render()
      await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 })
      await flushPromises()
      answerOld([{ name: '_execute_action', shortcut: 'Ctrl+Shift+K' }])
      await flushPromises()
      expect(byTestId('tab-status').textContent).toContain('press Alt+Shift+K')
    })

    it('ignores a malformed overlay reply', async () => {
      overlayReply = { host: 'x', mode: 'element' }
      await render()
      expect(byTestId('tab-status').textContent).toContain('Not active on this page')
    })
  })

  it('names the keys on the page, P for the pins too', async () => {
    overlayReply = active
    await render()
    const keys = [...byTestId('page-keys').querySelectorAll('kbd')].map((k) => k.textContent)
    expect(keys).toEqual(['E', 'A', 'P', 'Esc'])
    expect(byTestId('page-keys').title).toContain('P to show or hide the pins')
    expect(byTestId('toggle-pins').title).toBe('Hide pins on the page (P)')
  })

  describe('Edit and Settings', () => {
    const exists = (id: string) => document.querySelector(`[data-testid="${id}"]`) !== null
    const before = (a: string, b: string) =>
      (byTestId(a).compareDocumentPosition(byTestId(b)) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const EDIT_ONLY = ['mode-browse', 'toggle-pins', 'tab-status', 'page-keys', 'copy-prompt']

    it('is titled Edit, with the buttons above the texts', async () => {
      overlayReply = active
      await render(twoPages())
      expect(byTestId('panel-title').textContent).toBe('Edit')
      expect(before('mode-browse', 'tab-status')).toBe(true)
      expect(before('toggle-pins', 'tab-status')).toBe(true)
      expect(before('tab-status', 'page-keys')).toBe(true)
      expect(before('page-keys', 'item')).toBe(true)
    })

    it('swaps to Settings, the gear for a close button, and hides what belongs to Edit', async () => {
      overlayReply = active
      await render(twoPages())
      const row = byTestId('open-settings').closest('[data-testid="title-row"]')
      byTestId('open-settings').click()
      await flushPromises()
      expect(byTestId('panel-title').textContent).toBe('Settings')
      expect(exists('open-settings')).toBe(false)
      expect(byTestId('close-settings').closest('[data-testid="title-row"]')).toBe(row)
      expect(byTestId('close-settings').getAttribute('aria-label')).toBe('Close settings')
      for (const id of [...EDIT_ONLY, 'clear-all', 'item']) expect(exists(id)).toBe(false)
      byTestId('close-settings').click()
      await flushPromises()
      expect(byTestId('panel-title').textContent).toBe('Edit')
      for (const id of EDIT_ONLY) expect(exists(id)).toBe(true)
    })

    it('lists the keyboard shortcuts, with the toolbar shortcut Chrome assigned', async () => {
      shortcutIs('Ctrl+Shift+K')
      await render()
      byTestId('open-settings').click()
      await flushPromises()
      const list = byTestId('shortcut-list')
      const keys = [...list.querySelectorAll('kbd')].map((k) => k.textContent)
      expect(keys).toContain('Ctrl+Shift+K')
      for (const k of ['E', 'A', 'P', 'Esc', '↑', '↓', 'Enter', 'Shift+Enter', 'Alt+V']) {
        expect(keys).toContain(k)
      }
      expect(list.textContent).toContain('Start or stop dictation')
    })

    it('says when Chrome assigned no toolbar shortcut, and opens its shortcut page', async () => {
      shortcutIs('')
      const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never)
      await render()
      byTestId('open-settings').click()
      await flushPromises()
      expect(byTestId('shortcut-list').textContent).toContain('Not set')
      byTestId('change-shortcut').click()
      await flushPromises()
      expect(create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' })
    })

    it('writes the keys the way macOS does on a Mac', async () => {
      const platform = Object.getOwnPropertyDescriptor(navigator, 'platform')
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
      try {
        await render()
        byTestId('open-settings').click()
        await flushPromises()
        const keys = [...byTestId('shortcut-list').querySelectorAll('kbd')].map(
          (k) => k.textContent,
        )
        expect(keys).toContain('⌥V')
        expect(keys).not.toContain('Alt+V')
      } finally {
        if (platform) Object.defineProperty(navigator, 'platform', platform)
        else delete (navigator as { platform?: string }).platform
      }
    })
  })

  it('switches the overlay mode from the panel', async () => {
    overlayReply = active
    await render()
    byTestId('mode-element').click()
    await flushPromises()
    expect(fakeBrowser.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: 'overlay:set-mode',
      mode: 'element',
    })
  })

  it('switches to area mode from the panel', async () => {
    overlayReply = active
    await render()
    byTestId('mode-area').click()
    await flushPromises()
    expect(fakeBrowser.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: 'overlay:set-mode',
      mode: 'area',
    })
  })

  it('disables the mode switch while the page is not active', async () => {
    await render()
    expect(byTestId('mode-element').hasAttribute('disabled')).toBe(true)
    expect(byTestId('toggle-pins').hasAttribute('disabled')).toBe(true)
  })

  it('hides and shows the pins from the panel', async () => {
    overlayReply = active
    await render()
    const toggle = byTestId('toggle-pins')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    toggle.click()
    await flushPromises()
    expect(fakeBrowser.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: 'overlay:set-pins',
      visible: false,
    })
    // The overlay hid them and tells the panel.
    overlayReply = { ...active, pins: false }
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'overlay:changed', instance: 'one' },
      { id: fakeBrowser.runtime.id, tab: { id: 1, windowId: 1 } as never, frameId: 0 },
      () => undefined,
    )
    await flushPromises()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    toggle.click()
    await flushPromises()
    expect(fakeBrowser.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: 'overlay:set-pins',
      visible: true,
    })
  })

  describe('sites', () => {
    const ORIGIN = 'http://localhost:3000'
    let fake: ReturnType<typeof fakeSites>

    beforeEach(() => {
      fake = fakeSites()
    })

    it('offers Always enable here on an active page and asks Chrome before anything else', async () => {
      overlayReply = active
      await render()
      const calls: string[] = []
      vi.mocked(fakeBrowser.permissions.request).mockImplementation((async () => {
        calls.push('request')
        return true
      }) as never)
      vi.mocked(fakeBrowser.runtime.sendMessage).mockImplementation((async (m: {
        type: string
      }) => {
        calls.push(m.type)
        return { ok: true }
      }) as never)
      byTestId('remember-site').click()
      expect(calls).toEqual(['request'])
      expect(fakeBrowser.permissions.request).toHaveBeenCalledWith({ origins: [`${ORIGIN}/*`] })
      await flushPromises()
      expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'site:remember',
        origin: ORIGIN,
      })
    })

    it('does not remember the site when Chrome is not granted access', async () => {
      overlayReply = active
      await render()
      vi.mocked(fakeBrowser.permissions.request).mockResolvedValue(false as never)
      byTestId('remember-site').click()
      await flushPromises()
      expect(fakeBrowser.runtime.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'site:remember' }),
      )
    })

    it('says why a site could not be remembered', async () => {
      overlayReply = active
      await render()
      vi.mocked(fakeBrowser.runtime.sendMessage).mockResolvedValue({
        ok: false,
        error: 'You can remember up to 100 sites. Forget one first.',
      } as never)
      byTestId('remember-site').click()
      await flushPromises()
      expect(byTestId('site-error').textContent).toContain('up to 100 sites')
    })

    it('offers Forget this site on a remembered site', async () => {
      await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { rememberedOrigins: [ORIGIN] } })
      overlayReply = active
      await render()
      expect(document.querySelector('[data-testid="remember-site"]')).toBeNull()
      byTestId('forget-site').click()
      await flushPromises()
      expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'site:forget',
        origin: ORIGIN,
      })
    })

    it('offers nothing for an inactive tab or a file page', async () => {
      await render()
      expect(document.querySelector('[data-testid="remember-site"]')).toBeNull()
      wrapper?.unmount()
      overlayReply = { ...active, host: 'file', pageKey: 'file:///srv/app/index.html' }
      await render()
      expect(document.querySelector('[data-testid="remember-site"]')).toBeNull()
      expect(fake.state.granted.size).toBe(0)
    })

    it('lists remembered sites in the settings and forgets one', async () => {
      await fakeBrowser.storage.local.set({
        [SETTINGS_KEY]: { rememberedOrigins: [ORIGIN, 'https://staging.example.com'] },
      })
      await render()
      byTestId('open-settings').click()
      await flushPromises()
      const sites = [...document.querySelectorAll('[data-testid="site"]')].map(
        (el) => el.textContent,
      )
      expect(sites).toEqual([
        expect.stringContaining('localhost:3000'),
        expect.stringContaining('staging.example.com'),
      ])
      document
        .querySelector<HTMLElement>('[data-testid="site"] [data-testid="remove-site"]')
        ?.click()
      await flushPromises()
      expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'site:forget',
        origin: ORIGIN,
      })
      byTestId('close-settings').click()
      await flushPromises()
      expect(document.querySelector('[data-testid="site"]')).toBeNull()
    })

    it('says when there is no site yet', async () => {
      await render()
      byTestId('open-settings').click()
      await flushPromises()
      expect(body()).toContain('No sites yet')
    })
  })

  it('offers Go to for the other pages and opens them in the active tab', async () => {
    overlayReply = active
    await render(twoPages())
    const groups = [...document.querySelectorAll('[data-testid="page-group"]')]
    expect(groups[0]?.querySelector('[data-testid="go-to"]')).toBeNull()
    groups[1]?.querySelector<HTMLElement>('[data-testid="go-to"]')?.click()
    await flushPromises()
    expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'tab:go',
      tabId: 1,
      pageKey: A,
    })
  })

  it('offers no Go to for pages that are not on the web', async () => {
    let c = emptyCollection('file://')
    c = addAnnotation(c, elementInput('f1', 'file:///srv/app/index.html', 'Local'), 'T')
    c = addAnnotation(c, elementInput('f2', 'file:///srv/app/other.html', 'Here'), 'T')
    overlayReply = { ...active, host: 'file', pageKey: 'file:///srv/app/other.html' }
    await render(c)
    const local = [...document.querySelectorAll('[data-testid="page-group"]')].find((g) =>
      g.textContent?.includes('Local'),
    )
    expect(local?.querySelector('[data-testid="go-to"]')).toBeNull()
  })

  it('keeps a line open to the overlay of the active tab, and to a new one on the same tab', async () => {
    const ports: { postMessage: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] =
      []
    const connect = vi.spyOn(fakeBrowser.tabs, 'connect').mockImplementation((() => {
      const port = panelPort()
      ports.push(port)
      return port
    }) as never)
    overlayReply = active
    await render()
    expect(connect).toHaveBeenCalledWith(1, { name: 'panel' })
    // A second toolbar click: a new overlay on the same tab tells the panel.
    overlayReply = { ...active, instance: 'two' }
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'overlay:changed', instance: 'two' },
      { id: fakeBrowser.runtime.id, tab: { id: 1, windowId: 1 } as never, frameId: 0 },
      () => undefined,
    )
    await flushPromises()
    expect(connect).toHaveBeenCalledTimes(2)
    // The first overlay is gone: a new one started on the tab.
    expect(ports[0]?.disconnect).toHaveBeenCalled()
  })

  it('keeps the line to an overlay it moved away from, which drops its highlight', async () => {
    const ports: { postMessage: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] =
      []
    const connect = vi.spyOn(fakeBrowser.tabs, 'connect').mockImplementation((() => {
      const port = panelPort()
      ports.push(port)
      return port
    }) as never)
    overlayReply = active
    await render()
    // Another tab with an overlay of its own becomes active.
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([{ id: 2 }] as never)
    overlayReply = { ...active, instance: 'two' }
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 })
    await flushPromises()
    expect(connect).toHaveBeenLastCalledWith(2, { name: 'panel' })
    expect(ports[0]?.postMessage).toHaveBeenCalledWith({ type: 'panel:away' })
    // Kept: when the panel closes, this overlay goes back to Browse too.
    expect(ports[0]?.disconnect).not.toHaveBeenCalled()
    wrapper?.unmount()
    wrapper = undefined
    expect(ports[0]?.disconnect).toHaveBeenCalled()
    expect(ports[1]?.disconnect).toHaveBeenCalled()
  })

  describe('lines to the overlays of its window', () => {
    let connect: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({ id: 7 } as never)
      connect = vi
        .spyOn(fakeBrowser.tabs, 'connect')
        .mockImplementation((() => panelPort()) as never)
    })

    const announce = (tab: { id: number; windowId: number }) =>
      fakeBrowser.runtime.onMessage.trigger(
        { type: 'overlay:changed', instance: 'three' },
        { id: fakeBrowser.runtime.id, tab: tab as never, frameId: 0 },
        () => undefined,
      )

    it('keeps one to an overlay that announces itself, also on a tab it does not show', async () => {
      // So that closing the panel reaches it, however quickly the developer switched tabs.
      await render()
      await announce({ id: 3, windowId: 7 })
      await flushPromises()
      expect(connect).toHaveBeenCalledWith(3, { name: 'panel' })
    })

    it('leaves the overlays of other windows to their own panel', async () => {
      await render()
      await announce({ id: 3, windowId: 8 })
      await flushPromises()
      expect(connect).not.toHaveBeenCalledWith(3, { name: 'panel' })
    })

    it('finds the overlays already running in its window when it opens', async () => {
      vi.mocked(fakeBrowser.tabs.query).mockImplementation((async (q: { windowId?: number }) =>
        q.windowId === 7 ? [{ id: 1 }, { id: 3 }] : [{ id: 1 }]) as never)
      vi.mocked(fakeBrowser.tabs.sendMessage).mockImplementation((async (id: number) => {
        if (id !== 3) throw new Error('Could not establish connection.')
        return { ...active, instance: 'three' }
      }) as never)
      await render()
      expect(connect).toHaveBeenCalledWith(3, { name: 'panel' })
      expect(connect).not.toHaveBeenCalledWith(1, { name: 'panel' })
    })
  })

  describe('the toolbar toggles the panel', () => {
    /** Delivers `message` from `sender` to the panel; resolves with its answer, if any. */
    async function ask(message: object, sender: object = { id: fakeBrowser.runtime.id }) {
      let reply: unknown
      await fakeBrowser.runtime.onMessage.trigger(message, sender, (r: unknown) => (reply = r))
      await flushPromises()
      return reply
    }

    let close: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 1, windowId: 7 }] as never)
      vi.spyOn(fakeBrowser.tabs, 'connect').mockReturnValue({
        name: 'panel',
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onDisconnect: { addListener: vi.fn() },
      } as never)
      close = vi.spyOn(window, 'close').mockImplementation(() => undefined)
    })

    it('closes itself when its page is active on the tab the toolbar was used on', async () => {
      overlayReply = active
      await render()
      expect(await ask({ type: 'panel:toggle', windowId: 7, tabId: 1 })).toEqual({ closing: true })
      await vi.waitFor(() => expect(close).toHaveBeenCalled())
    })

    it('stays open for another tab of its window without an overlay', async () => {
      overlayReply = active
      await render()
      vi.mocked(fakeBrowser.tabs.sendMessage).mockImplementation((async (id: number) => {
        if (id !== 1) throw new Error('Could not establish connection.')
        return active
      }) as never)
      expect(await ask({ type: 'panel:toggle', windowId: 7, tabId: 2 })).toEqual({ closing: false })
      expect(close).not.toHaveBeenCalled()
    })

    it('asks the tab again instead of trusting what it showed a moment ago', async () => {
      // The tab navigated to another page; the click comes before the panel caught up.
      overlayReply = active
      await render()
      overlayReply = undefined
      expect(await ask({ type: 'panel:toggle', windowId: 7, tabId: 1 })).toEqual({ closing: false })
      expect(close).not.toHaveBeenCalled()
    })

    it('stays open when its page is not active', async () => {
      await render()
      expect(await ask({ type: 'panel:toggle', windowId: 7, tabId: 1 })).toEqual({ closing: false })
      expect(close).not.toHaveBeenCalled()
    })

    it('leaves other windows, pages and malformed requests unanswered', async () => {
      overlayReply = active
      await render()
      expect(await ask({ type: 'panel:toggle', windowId: 8, tabId: 1 })).toBeUndefined()
      expect(
        await ask(
          { type: 'panel:toggle', windowId: 7, tabId: 1 },
          { id: fakeBrowser.runtime.id, tab: { id: 1 } },
        ),
      ).toBeUndefined()
      expect(
        await ask({ type: 'panel:toggle', windowId: 7, tabId: 1 }, { id: 'other-extension' }),
      ).toBeUndefined()
      expect(await ask({ type: 'panel:toggle', windowId: '7', tabId: 1 })).toBeUndefined()
      expect(close).not.toHaveBeenCalled()
    })
  })

  it('marks items that were not found and copies the prompt with them', async () => {
    overlayReply = active
    const c = twoPages()
    await fakeBrowser.storage.session.set({ [MISSING_KEY]: ['a1'] })
    await render(c)
    const entries = [...document.querySelectorAll('[data-testid="item"]')]
    const marked = entries.filter((e) => e.querySelector('[data-testid="not-found"]'))
    expect(marked.map((e) => e.textContent)).toEqual([expect.stringContaining('First on A')])
    byTestId('copy-prompt').click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(
      formatCollection(pick(c, new Set(['a1', 'b1'])), { missing: new Set(['a1']) }),
    )

    await fakeBrowser.storage.session.set({ [MISSING_KEY]: [] })
    await flushPromises()
    expect(document.querySelector('[data-testid="not-found"]')).toBeNull()
  })

  it('shows the target summary of an entry', async () => {
    overlayReply = active
    await render(
      addAnnotation(
        emptyCollection(SITE),
        elementInput('a1', A, 'x', snapshot({ openingTag: '<a href="/x">', text: 'Docs' })),
        'T',
      ),
    )
    expect(body()).toContain('a "Docs"')
  })
})
