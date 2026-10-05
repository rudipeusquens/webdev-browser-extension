import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import App from '@/entrypoints/sidepanel/App.vue'
import { markBlocked } from '@/lib/background/tab-status'
import type { Collection } from '@/lib/collection/model'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { COLLECTION_KEY } from '@/lib/collection/store'
import { formatCollection } from '@/lib/format/markdown'
import type { OverlayStatus } from '@/lib/messages'
import { elementInput, page, snapshot } from './helpers/collection'

const A = 'http://localhost:3000/a'
const B = 'http://localhost:3000/b'
const active: OverlayStatus = { host: 'localhost:3000', pageKey: B, mode: 'browse' }

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

    it('says when the page refused the overlay', async () => {
      await markBlocked(1)
      await render()
      expect(byTestId('tab-status').textContent).toContain("Can't run on this page")
    })

    it('explains how to activate otherwise', async () => {
      await render()
      expect(byTestId('tab-status').textContent).toContain(
        'Not active on this page. Click the toolbar icon or press Alt+Shift+A.',
      )
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
