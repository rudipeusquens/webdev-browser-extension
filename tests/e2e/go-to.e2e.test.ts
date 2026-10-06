import type { Page } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import { markElement, overlayMounted, sleep, waitForItems, waitInOverlay } from './overlay-helpers'

const POPOVER = '[data-testid="overlay-popover"]'

describe('the panel and the pages of the collection', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  async function mark(selector: string, comment: string, count: number) {
    await markElement(session, selector)
    await session.page.keyboard.type(comment)
    await session.page.keyboard.press('Enter')
    await waitForItems(panel, count)
    await waitInOverlay(session, POPOVER, false)
    await session.page.keyboard.press('Escape')
  }

  async function inOverlay(selector: string) {
    const realm = await contentRealm(session)
    return realm.evaluate(
      (sel) => !!globalThis.__webdevOverlay?.shadow?.querySelector(sel),
      selector,
    )
  }

  it('opens another page of the collection with Go to, with the overlay running', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    await mark('h1', 'On the plain page', 1)
    await session.page.goto(`${server.origin}/plain/text.html`)
    panel = await clickAction(session)
    await overlayMounted(session)
    await mark('h1', 'On the text page', 2)

    const go = await panel.waitForSelector('[data-testid="page-group"] [data-testid="go-to"]')
    await go?.click()
    await session.page.waitForFunction(
      (url) => location.href === url,
      { timeout: 10_000 },
      `${server.origin}/plain/`,
    )
    await overlayMounted(session)
    for (let i = 0; i < 30 && !(await inOverlay('[data-testid="overlay-pin"]')); i++)
      await sleep(100)
    expect(await inOverlay('[data-testid="overlay-pin"]')).toBe(true)
    await panel.waitForFunction(() =>
      [...document.querySelectorAll('[data-testid="page-group"]')][0]?.textContent?.includes(
        'This page',
      ),
    )
  })

  it('drops the highlight when the panel closes', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    await mark('h1', 'Highlight me', 1)
    await panel.hover('[data-testid="item"]')
    for (let i = 0; i < 30 && !(await inOverlay('[data-testid="overlay-highlight"]')); i++) {
      await sleep(100)
    }
    expect(await inOverlay('[data-testid="overlay-highlight"]')).toBe(true)
    await panel.close()
    for (let i = 0; i < 30 && (await inOverlay('[data-testid="overlay-highlight"]')); i++) {
      await sleep(100)
    }
    expect(await inOverlay('[data-testid="overlay-highlight"]')).toBe(false)
  })

  it('drops the highlight when the panel closes after a second toolbar click', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    await mark('h1', 'Highlight me again', 1)
    // The overlay starts again on the same tab while the panel stays open.
    panel = await clickAction(session)
    await overlayMounted(session)
    await sleep(500)
    await panel.hover('[data-testid="item"]')
    for (let i = 0; i < 30 && !(await inOverlay('[data-testid="overlay-highlight"]')); i++) {
      await sleep(100)
    }
    expect(await inOverlay('[data-testid="overlay-highlight"]')).toBe(true)
    await panel.close()
    for (let i = 0; i < 30 && (await inOverlay('[data-testid="overlay-highlight"]')); i++) {
      await sleep(100)
    }
    expect(await inOverlay('[data-testid="overlay-highlight"]')).toBe(false)
  })
})
