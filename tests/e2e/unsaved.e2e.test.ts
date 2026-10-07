import type { Page } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import {
  clickInOverlay,
  markElement,
  overlayMounted,
  overlayText,
  sleep,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const POPOVER = '[data-testid="overlay-popover"]'
const KEEP = 'Save or cancel this pin first.'
const REFUSED = '[data-testid="panel-error"] ::-p-text(Save or cancel the open pin first.)'

const panelUrl = (s: Session) => `chrome-extension://${s.extensionId}/sidepanel.html`

/** Uses the toolbar action on `page`, without waiting for a panel. */
async function useAction(s: Session, page: Page) {
  const extension = (await s.browser.extensions()).get(s.extensionId)
  if (!extension) throw new Error('extension is not installed')
  await page.triggerExtensionAction(extension)
}

describe('unsaved text in the popover', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  async function mark(selector: string, comment: string, count: number) {
    await markElement(session, selector)
    await session.page.keyboard.type(comment)
    await session.page.keyboard.press('Enter')
    await waitForItems(panel, count)
    await waitInOverlay(session, POPOVER, false)
    await session.page.keyboard.press('Escape')
  }

  /** The popover's comment field: its text, and whether it has the focus. */
  async function field() {
    const realm = await contentRealm(session)
    return realm.evaluate(() => {
      const shadow = globalThis.__webdevOverlay?.shadow
      const el = shadow?.querySelector<HTMLTextAreaElement>('[data-testid="overlay-comment"]')
      return { text: el?.value, focused: !!el && shadow?.activeElement === el }
    })
  }

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
    // Pin 1 on another page of the site, pins 2 and 3 on this one.
    await session.page.goto(`${server.origin}/plain/text.html`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    await mark('h1', 'Elsewhere', 1)
    await session.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(session)
    await overlayMounted(session)
    await mark('h1', 'First', 2)
    await mark('button[type="submit"]', 'Second', 3)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it("keeps a new pin's text when another pin or an entry is clicked", async () => {
    await markElement(session, '.card')
    await session.page.keyboard.type('Unsaved words')

    await clickInOverlay(session, '[aria-label="Edit pin 2"]')
    await sleep(200)
    expect(await field()).toEqual({ text: 'Unsaved words', focused: true })
    expect(await overlayText(session, POPOVER)).toContain('New pin')
    expect(await overlayText(session, POPOVER)).toContain(KEEP)

    const entry = await panel.waitForSelector('[data-testid="item"] ::-p-text(Second)')
    await entry?.click()
    await panel.waitForSelector(REFUSED)
    await sleep(200)
    expect((await field()).text).toBe('Unsaved words')

    // Esc throws the text away: then the entry opens its pin, and the refusal goes.
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, POPOVER, false)
    await entry?.click()
    await waitInOverlay(session, POPOVER)
    expect((await field()).text).toBe('Second')
    await panel.waitForSelector('[data-testid="panel-error"]', { hidden: true })
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, POPOVER, false)
  })

  it('lets an unchanged popover go, and keeps an open pin when it is clicked again', async () => {
    // Pin 2's popover lies over pin 3: pin 3 first, then pin 2 above it.
    await clickInOverlay(session, '[aria-label="Edit pin 3"]')
    await waitInOverlay(session, POPOVER)
    expect((await field()).text).toBe('Second')
    // Nothing changed: another pin takes its place.
    await clickInOverlay(session, '[aria-label="Edit pin 2"]')
    await sleep(200)
    expect((await field()).text).toBe('First')

    await session.page.keyboard.press('End')
    await session.page.keyboard.type(' now')
    await clickInOverlay(session, '[aria-label="Edit pin 2"]')
    await sleep(200)
    expect(await field()).toEqual({ text: 'First now', focused: true })
    expect(await overlayText(session, POPOVER)).not.toContain(KEEP)
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, POPOVER, false)
  })

  it('stays on the page when Go to is clicked', async () => {
    await markElement(session, '.card')
    await session.page.keyboard.type('Before leaving')
    const link = await panel.waitForSelector('[data-testid="page-link"]')
    await link?.click()
    await panel.waitForSelector(REFUSED)
    await sleep(500)
    expect(session.page.url()).toBe(`${server.origin}/plain/`)
    expect((await field()).text).toBe('Before leaving')
    expect(await overlayText(session, POPOVER)).toContain(KEEP)
  })

  it('keeps the text when the toolbar closes the panel and opens it again', async () => {
    await useAction(session, session.page)
    for (
      let i = 0;
      i < 50 && session.browser.targets().some((t) => t.url() === panelUrl(session));
      i++
    )
      await sleep(100)
    panel = await clickAction(session)
    await panel.waitForSelector('[data-testid="site-pill"][data-state="active"]')
    await sleep(500)
    expect((await field()).text).toBe('Before leaving')
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, POPOVER, false)
  })
})
