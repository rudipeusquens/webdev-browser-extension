import type { Page } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  clickAction,
  contentRealm,
  launch,
  type Session,
  startFixtureServer,
  startOverlayAgain,
} from './harness'
import {
  clickInOverlay,
  markElement,
  overlayMounted,
  overlayText,
  sleep,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

// Pins are never lost (spec section 8): a popover left without Save keeps its pin, a new one
// as a grey draft that Copy as prompt leaves out; only Delete throws a new pin away.

const POPOVER = '[data-testid="overlay-popover"]'

const panelUrl = (s: Session) => `chrome-extension://${s.extensionId}/sidepanel.html`

/** Uses the toolbar action on `page`, without waiting for a panel. */
async function useAction(s: Session, page: Page) {
  const extension = (await s.browser.extensions()).get(s.extensionId)
  if (!extension) throw new Error('extension is not installed')
  await page.triggerExtensionAction(extension)
}

interface Item {
  number: number
  comment: string
  draft?: true
}

describe('drafts', () => {
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

  /** Waits until the popover's field holds `text`: the last one is kept first. */
  async function fieldShows(text: string) {
    for (let i = 0; i < 50 && (await field()).text !== text; i++) await sleep(100)
    expect((await field()).text).toBe(text)
  }

  /** The stored pins, once there are `count` of them. */
  async function items(count: number): Promise<Item[]> {
    await waitForItems(panel, count)
    return ((await storedCollection(panel)) as unknown as { items: Item[] }).items
  }

  const byNumber = async (count: number, number: number) =>
    (await items(count)).find((i) => i.number === number)

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
    await session.browser
      .defaultBrowserContext()
      .overridePermissions(`chrome-extension://${session.extensionId}`, [
        'clipboard-read',
        'clipboard-sanitized-write',
      ])
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

  it('keeps a new pin as a grey draft when another pin is clicked, and opens that one', async () => {
    await markElement(session, '.card')
    await session.page.keyboard.type('Unsaved words')
    await clickInOverlay(session, '[aria-label="Edit pin 2"]')
    await fieldShows('First')
    expect(await byNumber(4, 4)).toMatchObject({ comment: 'Unsaved words', draft: true })
    const entry = await panel.waitForSelector('[data-testid="item"][data-tone="draft"]')
    expect(await entry?.evaluate((el) => el.textContent)).toContain('Unsaved words')
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, POPOVER, false)
  })

  it('switches pins from the panel: the open one closes as it is', async () => {
    await clickInOverlay(session, '[aria-label="Edit pin 3"]')
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.press('End')
    await session.page.keyboard.type(' too')
    const entry = await panel.waitForSelector('[data-testid="item"] ::-p-text(First)')
    await entry?.click()
    await fieldShows('First')
    // Pin 3 keeps its change; it stays a pin.
    const three = await byNumber(4, 3)
    expect(three?.comment).toBe('Second too')
    expect(three?.draft).toBeUndefined()
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, POPOVER, false)
  })

  it('keeps a new pin as an empty draft on Esc, and throws one away on Delete', async () => {
    await markElement(session, 'p')
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, POPOVER, false)
    expect(await byNumber(5, 5)).toMatchObject({ comment: '', draft: true })
    await markElement(session, '.card')
    await clickInOverlay(session, '[data-testid="overlay-delete"]')
    await waitInOverlay(session, POPOVER, false)
    await sleep(300)
    expect(await items(5)).toHaveLength(5)
  })

  it('makes a draft a pin with Enter', async () => {
    const pin = '[aria-label="Edit pin 4"]'
    await clickInOverlay(session, pin)
    await waitInOverlay(session, POPOVER)
    expect(await overlayText(session, POPOVER)).toContain('· Draft')
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, POPOVER, false)
    for (let i = 0; i < 30 && (await byNumber(5, 4))?.draft; i++) await sleep(100)
    expect((await byNumber(5, 4))?.draft).toBeUndefined()
  })

  it('leaves drafts out of Copy as prompt, and says so', async () => {
    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('::-p-text(1 left out)')
    const prompt = await panel.evaluate(() => navigator.clipboard.readText())
    expect(prompt).toContain('> Unsaved words')
    expect(prompt).not.toContain('### 5.')
  })

  it('keeps the open pin when the page reloads', async () => {
    await session.page.keyboard.press('Escape')
    await markElement(session, '.card')
    await session.page.keyboard.type('Before the reload')
    await session.page.reload()
    expect(await byNumber(6, 6)).toMatchObject({ comment: 'Before the reload', draft: true })
    // The page is not remembered: its overlay starts again on request.
    await startOverlayAgain(session)
    await overlayMounted(session)
  })

  it('keeps the open pin and leaves the page when Go to is clicked', async () => {
    // Copy as prompt made the other page's pin done: All shows its page again.
    await panel.click('[data-testid="filter-all"]')
    await markElement(session, '.card')
    await session.page.keyboard.type('Before leaving')
    const link = await panel.waitForSelector('[data-testid="page-link"]')
    await link?.click()
    for (let i = 0; i < 50 && !session.page.url().endsWith('/text.html'); i++) await sleep(100)
    expect(session.page.url()).toBe(`${server.origin}/plain/text.html`)
    expect(await byNumber(7, 7)).toMatchObject({ comment: 'Before leaving', draft: true })
    await panel.click('[data-testid="filter-open"]')
    await session.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(session)
    await overlayMounted(session)
  })

  it('keeps the text when the toolbar closes the panel and opens it again', async () => {
    await markElement(session, '.card')
    await session.page.keyboard.type('While closed')
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
    expect((await field()).text).toBe('While closed')
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, POPOVER, false)
  })
})
