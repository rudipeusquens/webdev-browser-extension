import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import {
  clickInOverlay,
  dragSelect,
  markElement,
  overlayMounted,
  sleep,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const PIN = '[data-testid="overlay-pin"]'
const POPOVER = '[data-testid="overlay-popover"]'

// Pins follow the element, not the document (plan Review Focus 5).
describe('pins in scroll containers and on sticky elements', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/plain/layout.html`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  async function mark(selector: string, count: number) {
    await markElement(session, selector)
    await session.page.keyboard.type(`Mark ${selector}`)
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, POPOVER, false)
    await waitForItems(panel, count)
    await session.page.keyboard.press('Escape')
  }

  /** The first pin's top-left corner, or null without pins. */
  async function pin(): Promise<{ x: number; y: number } | null> {
    await sleep(150)
    const realm = await contentRealm(session)
    return realm.evaluate((sel) => {
      const r = globalThis.__webdevOverlay?.shadow?.querySelector(sel)?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y } : null
    }, PIN)
  }

  const top = (selector: string) =>
    session.page.$eval(selector, (el) => el.getBoundingClientRect().top)

  it('moves a pin with its scroll container and hides it when the target leaves the box', async () => {
    await mark('#row-3', 1)
    const before = await pin()
    expect(before?.y).toBeCloseTo((await top('#row-3')) - 10, 0)

    await session.page.$eval('#list', (el) => (el.scrollTop = 30))
    const moved = await pin()
    expect(moved?.y).toBeCloseTo((before?.y ?? 0) - 30, 0)

    await session.page.$eval('#list', (el) => (el.scrollTop = 200))
    expect(await pin()).toBeNull()

    await session.page.$eval('#list', (el) => (el.scrollTop = 0))
    expect(await pin()).not.toBeNull()
  })

  it('keeps the pin inside the box while the target is half scrolled out', async () => {
    await mark('#row-2', 1)
    const box = await session.page.$eval('#list', (el) => el.getBoundingClientRect().top)
    await session.page.$eval('#list', (el) => (el.scrollTop = 60))
    const at = await pin()
    expect(at?.y).toBeGreaterThanOrEqual(box + 4 - 0.5)
  })

  it('hides the pin of text scrolled out of the box that holds it', async () => {
    await dragSelect(session.page, '#textbox', 'Line one')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.type('Text in a scroll box')
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, POPOVER, false)
    await waitForItems(panel, 1)
    expect(await pin()).not.toBeNull()
    await session.page.$eval('#textbox', (el) => (el.scrollTop = 200))
    expect(await pin()).toBeNull()
  })

  it('shows the pin of a positioned badge outside a clipping box it escapes', async () => {
    await mark('#badge', 1)
    const badge = await top('#badge')
    expect((await pin())?.y).toBeCloseTo(badge - 10, 0)
  })

  it('keeps the pin of a sticky header at the header while the page scrolls', async () => {
    await mark('#head', 1)
    const before = await pin()
    await session.page.evaluate(() => window.scrollTo(0, 800))
    const after = await pin()
    expect(after).toEqual(before)
    expect(await top('#head')).toBe(0)
  })

  it('hides and shows all pins from the panel', async () => {
    await mark('#head', 1)
    expect(await pin()).not.toBeNull()
    await panel.click('[data-testid="toggle-pins"]')
    expect(await pin()).toBeNull()
    await panel.waitForSelector('[data-testid="toggle-pins"][aria-pressed="false"]')
    await panel.click('[data-testid="toggle-pins"]')
    expect(await pin()).not.toBeNull()
  })
})
