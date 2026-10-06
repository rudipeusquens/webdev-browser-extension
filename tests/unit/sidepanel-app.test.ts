import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import App from '@/entrypoints/sidepanel/App.vue'
import { MISSING_KEY } from '@/lib/background/anchor-status'
import { SETTINGS_KEY } from '@/lib/settings'
import { markBlocked, markFailed } from '@/lib/background/tab-status'
import type { Collection } from '@/lib/collection/model'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { COLLECTION_KEY } from '@/lib/collection/store'
import { formatCollection } from '@/lib/format/markdown'
import type { OverlayStatus } from '@/lib/messages'
import { elementInput, page, snapshot } from './helpers/collection'
import { fakeSites } from './helpers/fake-sites'

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
  let c = addAnnotation(emptyCollection(), elementInput('a1', A, 'First on A'), 'T')
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

/** The shortcut Chrome reports for the toolbar action. */
const shortcutIs = (shortcut: string) =>
  vi
    .spyOn(fakeBrowser.commands, 'getAll')
    .mockResolvedValue([{ name: '_execute_action', shortcut, description: '' }] as never)

let wrapper: VueWrapper | undefined
let overlayReply: unknown
const writeText = vi.fn()

async function render(collection?: Collection) {
  if (collection) await fakeBrowser.storage.local.set({ [COLLECTION_KEY]: collection })
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
    await render(twoPages())
    expect(document.querySelector('main img')).toBeNull()
    expect(document.querySelector('main b')).toBeNull()
    expect(body()).toContain('<img src=x onerror=alert(1)>')
    expect(body()).toContain('<b>not bold</b>')
  })

  it('copies the formatted prompt and says how many items', async () => {
    const c = twoPages()
    await render(c)
    byTestId('copy-prompt').click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(formatCollection(c))
    expect(byTestId('copy-status').textContent).toBe('Copied 2 items')
  })

  it('offers the text for manual copying when the clipboard fails', async () => {
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
    await render(twoPages())
    byTestId('clear-all').click()
    await flushPromises()
    expect(body()).toContain('2 items on 2 pages')
    byTestId('clear-cancel').click()
    await flushPromises()
    expect(fakeBrowser.runtime.sendMessage).not.toHaveBeenCalled()
    byTestId('clear-all').click()
    await flushPromises()
    byTestId('clear-confirm').click()
    await flushPromises()
    expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'collection:clear' })
  })

  it('deletes a single item', async () => {
    await render(twoPages())
    document.querySelector<HTMLElement>('[aria-label="Delete item 1"]')?.click()
    await flushPromises()
    expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'annotation:remove',
      id: 'a1',
    })
  })

  it('updates when the collection changes', async () => {
    await render()
    await fakeBrowser.storage.local.set({ [COLLECTION_KEY]: twoPages() })
    await flushPromises()
    expect(document.querySelectorAll('[data-testid="item"]')).toHaveLength(2)
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
      { type: 'overlay:changed' },
      { id: fakeBrowser.runtime.id },
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
        expect.stringContaining(ORIGIN),
        expect.stringContaining('https://staging.example.com'),
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

    it('says when no site is remembered', async () => {
      await render()
      byTestId('open-settings').click()
      await flushPromises()
      expect(body()).toContain('No remembered sites yet')
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
    let c = twoPages()
    c = addAnnotation(c, elementInput('f1', 'file:///srv/app/index.html', 'Local'), 'T')
    overlayReply = active
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
      const port = {
        name: 'panel',
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onDisconnect: { addListener: vi.fn() },
      }
      ports.push(port)
      return port
    }) as never)
    overlayReply = active
    await render()
    expect(connect).toHaveBeenCalledWith(1, { name: 'panel' })
    // A second toolbar click: a new overlay on the same tab tells the panel.
    overlayReply = { ...active, instance: 'two' }
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'overlay:changed' },
      { id: fakeBrowser.runtime.id },
      () => undefined,
    )
    await flushPromises()
    expect(connect).toHaveBeenCalledTimes(2)
    // Leaving, not closing: the overlay keeps its mode.
    expect(ports[0]?.postMessage).toHaveBeenCalledWith({ type: 'panel:leave' })
    expect(ports[0]?.disconnect).toHaveBeenCalled()
    expect(ports[0]?.postMessage.mock.invocationCallOrder[0]).toBeLessThan(
      ports[0]?.disconnect.mock.invocationCallOrder[0] ?? 0,
    )
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
        expect.stringContaining(ORIGIN),
        expect.stringContaining('https://staging.example.com'),
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

    it('says when no site is remembered', async () => {
      await render()
      byTestId('open-settings').click()
      await flushPromises()
      expect(body()).toContain('No remembered sites yet')
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
    let c = twoPages()
    c = addAnnotation(c, elementInput('f1', 'file:///srv/app/index.html', 'Local'), 'T')
    overlayReply = active
    await render(c)
    const local = [...document.querySelectorAll('[data-testid="page-group"]')].find((g) =>
      g.textContent?.includes('Local'),
    )
    expect(local?.querySelector('[data-testid="go-to"]')).toBeNull()
  })

  it('keeps a line open to the overlay of the active tab', async () => {
    const connect = vi.spyOn(fakeBrowser.tabs, 'connect').mockReturnValue({
      name: 'panel',
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onDisconnect: { addListener: vi.fn() },
    } as never)
    overlayReply = active
    await render()
    expect(connect).toHaveBeenCalledWith(1, { name: 'panel' })
  })

  it('marks items that were not found and copies the prompt with them', async () => {
    const c = twoPages()
    await fakeBrowser.storage.session.set({ [MISSING_KEY]: ['a1'] })
    await render(c)
    const entries = [...document.querySelectorAll('[data-testid="item"]')]
    const marked = entries.filter((e) => e.querySelector('[data-testid="not-found"]'))
    expect(marked.map((e) => e.textContent)).toEqual([expect.stringContaining('First on A')])
    byTestId('copy-prompt').click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(formatCollection(c, { missing: new Set(['a1']) }))

    await fakeBrowser.storage.session.set({ [MISSING_KEY]: [] })
    await flushPromises()
    expect(document.querySelector('[data-testid="not-found"]')).toBeNull()
  })

  it('shows the target summary of an entry', async () => {
    await render(
      addAnnotation(
        emptyCollection(),
        elementInput('a1', A, 'x', snapshot({ openingTag: '<a href="/x">', text: 'Docs' })),
        'T',
      ),
    )
    expect(body()).toContain('a "Docs"')
  })
})
