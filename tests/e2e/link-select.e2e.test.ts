import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import {
  centerOf,
  clickInOverlay,
  dragSelect,
  overlayMounted,
  sleep,
  textEnds,
  waitInOverlay,
} from './overlay-helpers'

const CHIP = '[data-testid="overlay-chip"]'
const POPOVER = '[data-testid="overlay-popover"]'

declare global {
  var linkClicks: number
  var cardClicks: number
}

describe('Ctrl+drag in Browse mode', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/plain/links.html`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  async function withCtrl(gesture: () => Promise<void>) {
    await session.page.keyboard.down('Control')
    try {
      await gesture()
    } finally {
      await session.page.keyboard.up('Control')
    }
  }

  const selection = () => session.page.evaluate(() => getSelection()?.toString() ?? '')
  const pages = async () => (await session.browser.pages()).length

  it('selects text inside a link, offers the chip and opens nothing', async () => {
    const before = await pages()
    await withCtrl(() => dragSelect(session.page, '#docs', 'details for'))
    expect(await selection()).toBe('details for')
    await waitInOverlay(session, CHIP)
    await sleep(300)
    expect(session.page.url()).toBe(`${server.origin}/plain/links.html`)
    expect(await pages()).toBe(before)
    expect(await session.page.evaluate(() => window.linkClicks)).toBe(0)
  })

  it('selects a word in a link with a double click', async () => {
    const { start } = await textEnds(session.page, '#docs', 'details')
    await withCtrl(() => session.page.mouse.click(start.x + 4, start.y, { count: 2 }))
    expect(await selection()).toBe('details')
    await waitInOverlay(session, CHIP)
    expect(await session.page.evaluate(() => window.linkClicks)).toBe(0)
  })

  it('selects the text of a link that starts with an image', async () => {
    await withCtrl(() => dragSelect(session.page, '#logo', 'home page'))
    expect(await selection()).toBe('home page')
    await waitInOverlay(session, CHIP)
  })

  it('pins the selection with Ctrl still held: the chip is the overlay, not the page', async () => {
    await withCtrl(async () => {
      await dragSelect(session.page, '#docs', 'pricing details')
      expect(await selection()).toBe('pricing details')
      await waitInOverlay(session, CHIP)
      await clickInOverlay(session, CHIP)
    })
    await waitInOverlay(session, POPOVER)
  })

  it('keeps a Ctrl+click from the page; a plain click reaches it', async () => {
    const card = await centerOf(session.page, '#card')
    await withCtrl(() => session.page.mouse.click(card.x, card.y))
    expect(await session.page.evaluate(() => window.cardClicks)).toBe(0)
    await session.page.mouse.click(card.x, card.y)
    expect(await session.page.evaluate(() => window.cardClicks)).toBe(1)
  })

  it('leaves Ctrl+click to the page and the browser once the panel is closed', async () => {
    await panel.close()
    // The overlay hears the line go and switches to Browse.
    const realm = await contentRealm(session)
    await realm.evaluate(() => new Promise((done) => setTimeout(done, 300)))
    const link = await centerOf(session.page, '#docs')
    const opened = session.browser.waitForTarget(
      (t) => t.type() === 'page' && t.url() === `${server.origin}/plain/text.html`,
      { timeout: 10_000 },
    )
    await withCtrl(() => session.page.mouse.click(link.x, link.y))
    const tab = await (await opened).asPage()
    expect(await session.page.evaluate(() => window.linkClicks)).toBe(1)
    expect(session.page.url()).toBe(`${server.origin}/plain/links.html`)
    await tab.close()
  })
})
