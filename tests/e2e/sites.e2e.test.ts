import type { Page } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, launch, serviceWorker, type Session, startFixtureServer } from './harness'
import {
  markElement,
  overlayMounted,
  sleep,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

// Two dev servers side by side: each site has its own feedback (spec section 5).
describe('one collection per site', () => {
  let one: Awaited<ReturnType<typeof startFixtureServer>>
  let two: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    one = await startFixtureServer()
    two = await startFixtureServer()
    session = await launch()
    await session.browser
      .defaultBrowserContext()
      .overridePermissions(`chrome-extension://${session.extensionId}`, [
        'clipboard-read',
        'clipboard-sanitized-write',
      ])
  })

  afterAll(async () => {
    await session?.browser.close()
    await one?.close()
    await two?.close()
  })

  async function save(selector: string, comment: string) {
    await markElement(session, selector)
    await session.page.keyboard.type(comment)
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, '[data-testid="overlay-popover"]', false)
  }

  /** The comments the panel lists, in order. */
  const listed = () =>
    panel.$$eval('[data-testid="item"]', (items) =>
      items.map((item) => item.querySelector('.line-clamp-2')?.textContent?.trim()),
    )

  async function waitForListed(expected: string[]) {
    for (let i = 0; i < 50; i++) {
      if (JSON.stringify(await listed()) === JSON.stringify(expected)) return
      await sleep(100)
    }
    expect(await listed()).toEqual(expected)
  }

  it('keeps items, numbers and the copy of each site apart', async () => {
    await session.page.goto(`${one.origin}/plain/`)
    panel = await clickAction(session)
    await overlayMounted(session)
    await save('h1', 'On the first site')
    await waitForItems(panel, 1)

    await session.page.goto(`${two.origin}/plain/`)
    // Another origin: the grant of the first click is gone; a toolbar click starts it here.
    panel = await clickAction(session)
    await overlayMounted(session)
    await waitForListed([])
    await save('h1', 'On the second site')
    await waitForListed(['On the second site'])

    const first = await storedCollection(panel, one.origin)
    const second = await storedCollection(panel, two.origin)
    expect(first?.items.map((i) => [i.comment, i.number])).toEqual([['On the first site', 1]])
    expect(second?.items.map((i) => [i.comment, i.number])).toEqual([['On the second site', 1]])

    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('::-p-text(Copied 1 pin)')
    const clipboard = await panel.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toContain('On the second site')
    expect(clipboard).not.toContain('On the first site')

    await session.page.goto(`${one.origin}/plain/`)
    panel = await clickAction(session)
    await overlayMounted(session)
    await waitForListed(['On the first site'])
  })

  it('splits the collection of an older version by site when the extension starts', async () => {
    const page = (origin: string) => ({
      url: `${origin}/plain/`,
      title: 'Plain',
      viewport: { width: 1280, height: 800 },
      colorScheme: 'light',
    })
    const item = (id: string, number: number, origin: string) => ({
      id,
      number,
      pageKey: `${origin}/plain/`,
      comment: `Old ${id}`,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      target: {
        kind: 'element',
        element: {
          selector: 'h1',
          openingTag: '<h1>',
          text: 'Plain page',
          box: { x: 0, y: 0, width: 100, height: 40 },
          styles: {},
        },
      },
    })
    const legacy = {
      version: 1,
      nextNumber: 3,
      pages: {
        [`${one.origin}/plain/`]: page(one.origin),
        [`${two.origin}/plain/`]: page(two.origin),
      },
      items: [item('old1', 1, one.origin), item('old2', 2, two.origin)],
    }
    await panel.evaluate(async (value) => {
      await chrome.storage.local.clear()
      await chrome.storage.local.set({ collection: value })
    }, legacy)

    // A new version starts with a new service worker.
    await (await serviceWorker(session)).close()
    await panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'overlay:failed' }).catch(() => 0),
    )
    const storedKeys = () =>
      panel.evaluate(async () => Object.keys(await chrome.storage.local.get()))
    for (let i = 0; i < 50 && (await storedKeys()).includes('collection'); i++) await sleep(100)
    const keys = await storedKeys()
    expect(keys.sort()).toEqual([`collection:${one.origin}`, `collection:${two.origin}`].sort())
    const first = await storedCollection(panel, one.origin)
    expect(first?.items.map((i) => [i.id, i.number, i.status])).toEqual([['old1', 1, 'open']])
    expect(first?.nextNumber).toBe(3)
    await waitForListed(['Old old1'])
  })

  it('undoes and redoes a deletion from another tab of the same site', async () => {
    // Left by the last test: "Old old1" open on the first site, its overlay in session.page.
    await waitForListed(['Old old1'])
    await panel.click('[aria-label="Delete pin 1"]')
    await waitForListed([])
    await panel.waitForSelector('[data-testid="undo"][title="Undo: Delete pin 1 (Ctrl+Z)"]')

    const second = await session.browser.newPage()
    await second.goto(`${one.origin}/plain/text.html`)
    await second.bringToFront()
    await clickAction({ ...session, page: second })
    await overlayMounted({ ...session, page: second })
    await panel.waitForSelector('[data-testid="undo"]:not([disabled])')
    await panel.click('[data-testid="undo"]')
    await waitForListed(['Old old1'])
    await panel.waitForSelector('[data-testid="redo"][title="Redo: Delete pin 1 (Ctrl+Shift+Z)"]')
    // The panel's own key, outside any field.
    await panel.focus('body')
    await panel.keyboard.down('Control')
    await panel.keyboard.down('Shift')
    await panel.keyboard.press('KeyZ')
    await panel.keyboard.up('Shift')
    await panel.keyboard.up('Control')
    await waitForListed([])

    await session.page.bringToFront()
    await panel.waitForSelector('[data-testid="redo"][disabled]')
    await panel.waitForSelector('[data-testid="undo"]:not([disabled])')
    const first = await storedCollection(panel, one.origin)
    expect(first?.items.map((i) => [i.id, i.status])).toEqual([['old1', 'deleted']])
    await second.close()
  })
})
