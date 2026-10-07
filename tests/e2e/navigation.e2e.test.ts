import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Collection } from '../../src/lib/collection/model'
import { formatCollection } from '../../src/lib/format/markdown'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import {
  markElement,
  overlayMounted,
  sleep,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const PIN = '[data-testid="overlay-pin"]'
const POPOVER = '[data-testid="overlay-popover"]'

describe('client-side navigation', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/spa/?page=a`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  const url = (page: string) => `${server.origin}/spa/?page=${page}`

  async function mark(selector: string, comment: string, count: number) {
    await markElement(session, selector)
    await session.page.keyboard.type(comment)
    await session.page.keyboard.press('Enter')
    await waitForItems(panel, count)
    // Stored before the overlay hears back: Escape would only close the popover.
    await waitInOverlay(session, POPOVER, false)
    await session.page.keyboard.press('Escape')
  }

  /** Clicks the app's own link to `page`: pushState, no reload. */
  async function follow(page: string) {
    await session.page.click(`a[data-page="${page}"]`)
    await session.page.waitForSelector(`#${page}-button`)
  }

  async function pinCount() {
    const realm = await contentRealm(session)
    return realm.evaluate(
      (sel) => globalThis.__webdevOverlay?.shadow?.querySelectorAll(sel).length ?? 0,
      PIN,
    )
  }

  async function waitForPins(count: number) {
    for (let i = 0; i < 30; i++) {
      if ((await pinCount()) === count) return
      await sleep(100)
    }
    throw new Error(`pins never reached ${count}, now ${await pinCount()}`)
  }

  async function currentGroup() {
    return panel.evaluate(() => {
      const group = [...document.querySelectorAll('[data-testid="page-group"]')].find((g) =>
        g.textContent?.includes('This page'),
      )
      return group?.querySelector('h2')?.getAttribute('title') ?? null
    })
  }

  it('switches pins and the current group with the URL, and groups the prompt by page', async () => {
    await mark('#a-button', 'On page A', 1)
    await waitForPins(1)
    await follow('b')
    await waitForPins(0)
    await mark('#b-button', 'On page B', 2)
    await waitForPins(1)
    await panel.waitForFunction(
      (key) =>
        [...document.querySelectorAll('[data-testid="page-group"]')]
          .find((g) => g.textContent?.includes('This page'))
          ?.querySelector('h2')
          ?.getAttribute('title') === key,
      {},
      url('b'),
    )
    expect(await currentGroup()).toBe(url('b'))

    const prompt = formatCollection((await storedCollection(panel)) as unknown as Collection)
    expect(prompt.indexOf(`## <${url('a')}>`)).toBeGreaterThan(0)
    expect(prompt.indexOf(`## <${url('a')}>`)).toBeLessThan(prompt.indexOf(`## <${url('b')}>`))

    await session.page.goBack()
    await session.page.waitForSelector('#a-button')
    await waitForPins(1)
    await panel.waitForFunction(
      (key) =>
        [...document.querySelectorAll('[data-testid="page-group"]')]
          .find((g) => g.textContent?.includes('This page'))
          ?.querySelector('h2')
          ?.getAttribute('title') === key,
      {},
      url('a'),
    )
  })

  it('saves an item under the page where it was marked when the app navigates meanwhile (review focus 4)', async () => {
    await follow('b')
    await markElement(session, '#b-button')
    await session.page.keyboard.type('Marked on B')
    // The app moves on by itself while the comment is open.
    await session.page.evaluate(() =>
      (window as unknown as { navigateTo(name: string): void }).navigateTo('c'),
    )
    await session.page.waitForSelector('#c-button')
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, POPOVER, false)
    const stored = (await waitForItems(panel, 1)) as unknown as Collection
    expect(stored.items[0]?.pageKey).toBe(url('b'))
    expect(Object.keys(stored.pages)).toEqual([url('b')])
    expect(stored.pages[url('b')]?.title).toBe('Page B')
  })

  it('shows the pins of the last page after quick navigations', async () => {
    await mark('#a-button', 'On A', 1)
    await follow('b')
    await mark('#b-button', 'On B', 2)
    await session.page.evaluate(() => {
      const go = (window as unknown as { navigateTo(name: string): void }).navigateTo
      for (const name of ['a', 'b', 'a', 'c', 'b', 'a']) go(name)
    })
    await session.page.waitForSelector('#a-button')
    await waitForPins(1)
    await sleep(300)
    expect(await pinCount()).toBe(1)
  })
})
