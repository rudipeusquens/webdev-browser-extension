import type { Page } from 'puppeteer'
import { describe, expect, it } from 'vitest'
import { contentRealm, startOverlayAgain, useBrowser, useFixtureServer } from './harness'
import {
  inOverlay,
  markAndStore,
  overlayMounted,
  PIN,
  POPOVER,
  sleep,
  startOverlay,
} from './overlay-helpers'

const HIGHLIGHT = '[data-testid="overlay-highlight"]'

describe('the panel and the pages of the collection', () => {
  const server = useFixtureServer()
  const session = useBrowser()
  let panel: Page
  it('opens another page of the collection with Go to, with the overlay running', async () => {
    panel = await startOverlay(session, `${server.origin}/plain/`)
    await markAndStore(session, panel, 'h1', 'On the plain page', 1)
    panel = await startOverlay(session, `${server.origin}/plain/text.html`, { clear: false })
    await markAndStore(session, panel, 'h1', 'On the text page', 2)

    const go = await panel.waitForSelector('[data-testid="page-group"] [data-testid="page-link"]')
    await go?.click()
    await session.page.waitForFunction(
      (url) => location.href === url,
      { timeout: 10_000 },
      `${server.origin}/plain/`,
    )
    await overlayMounted(session)
    for (let i = 0; i < 30 && !(await inOverlay(session, PIN)); i++) await sleep(100)
    expect(await inOverlay(session, PIN)).toBe(true)
    await panel.waitForFunction(() =>
      [...document.querySelectorAll('[data-testid="page-group"]')][0]?.textContent?.includes(
        'This page',
      ),
    )
  })

  it('jumps from an entry to its item on another page: opens it, scrolls, opens its popover', async () => {
    panel = await startOverlay(session, `${server.origin}/plain/`)
    await markAndStore(session, panel, 'button[type="submit"]', 'Make the button wider', 1)
    panel = await startOverlay(session, `${server.origin}/plain/text.html`, { clear: false })
    await session.page.waitForFunction(() => document.readyState === 'complete')

    const entry = await panel.waitForSelector(
      '[data-testid="item"] ::-p-text(Make the button wider)',
    )
    await entry?.click()
    await session.page.waitForFunction(
      (url) => location.href === url,
      { timeout: 10_000 },
      `${server.origin}/plain/`,
    )
    await overlayMounted(session)
    for (let i = 0; i < 50 && !(await inOverlay(session, POPOVER)); i++) await sleep(100)
    expect(await inOverlay(session, POPOVER)).toBe(true)
    const realm = await contentRealm(session)
    expect(
      await realm.evaluate(
        () =>
          globalThis.__webdevOverlay?.shadow?.querySelector<HTMLTextAreaElement>(
            '[data-testid="overlay-comment"]',
          )?.value,
      ),
    ).toBe('Make the button wider')
    // The panel marks the open item's entry.
    await panel.waitForSelector('[data-testid="item"][data-pointed="open"]')
    await session.page.keyboard.press('Escape')
  })

  it('drops the highlight when the panel closes', async () => {
    panel = await startOverlay(session, `${server.origin}/plain/`)
    await markAndStore(session, panel, 'h1', 'Highlight me', 1)
    await panel.hover('[data-testid="item"]')
    for (let i = 0; i < 30 && !(await inOverlay(session, HIGHLIGHT)); i++) {
      await sleep(100)
    }
    expect(await inOverlay(session, HIGHLIGHT)).toBe(true)
    await panel.close()
    for (let i = 0; i < 30 && (await inOverlay(session, HIGHLIGHT)); i++) {
      await sleep(100)
    }
    expect(await inOverlay(session, HIGHLIGHT)).toBe(false)
  })

  it('drops the highlight when the panel closes after a second toolbar click', async () => {
    panel = await startOverlay(session, `${server.origin}/plain/`)
    await markAndStore(session, panel, 'h1', 'Highlight me again', 1)
    // The overlay starts again on the same tab while the panel stays open, as the page's
    // context menu entry does it (a second toolbar click closes the panel).
    await startOverlayAgain(session)
    await overlayMounted(session)
    await sleep(500)
    await panel.hover('[data-testid="item"]')
    for (let i = 0; i < 30 && !(await inOverlay(session, HIGHLIGHT)); i++) {
      await sleep(100)
    }
    expect(await inOverlay(session, HIGHLIGHT)).toBe(true)
    await panel.close()
    for (let i = 0; i < 30 && (await inOverlay(session, HIGHLIGHT)); i++) {
      await sleep(100)
    }
    expect(await inOverlay(session, HIGHLIGHT)).toBe(false)
  })
})
