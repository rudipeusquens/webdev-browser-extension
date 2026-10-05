import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import {
  markElement,
  overlayMounted,
  sleep,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const BUTTON = 'button[type="submit"]'

describe('pins and editing', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  async function save(selector: string, comment: string) {
    await markElement(session, selector)
    await session.page.keyboard.type(comment)
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, '[data-testid="overlay-popover"]', false)
  }

  async function pinCenter() {
    await waitInOverlay(session, '[data-testid="overlay-pin"]')
    await sleep(100)
    const realm = await contentRealm(session)
    return realm.evaluate(() => {
      const r = globalThis.__webdevOverlay?.shadow
        ?.querySelector('[data-testid="overlay-pin"]')
        ?.getBoundingClientRect()
      return r && { x: r.x + r.width / 2, y: r.y + r.height / 2, text: '' }
    })
  }

  const buttonCorner = () =>
    session.page.$eval(BUTTON, (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.right, y: r.top }
    })

  async function expectPinOnButton() {
    const pin = await pinCenter()
    const corner = await buttonCorner()
    expect(Math.abs((pin?.x ?? 0) - corner.x)).toBeLessThanOrEqual(16)
    expect(Math.abs((pin?.y ?? 0) - corner.y)).toBeLessThanOrEqual(16)
  }

  it('pins the saved element and follows scrolling', async () => {
    await save(BUTTON, 'Wider')
    await expectPinOnButton()
    const realm = await contentRealm(session)
    expect(
      await realm.evaluate(
        () =>
          globalThis.__webdevOverlay?.shadow?.querySelector('[data-testid="overlay-pin"]')
            ?.textContent,
      ),
    ).toBe('1')
    await session.page.evaluate(() => window.scrollTo(0, 60))
    await sleep(300)
    await expectPinOnButton()
  })

  it('edits a comment from its pin and keeps the number', async () => {
    await save(BUTTON, 'Wider')
    await session.page.keyboard.press('Escape')
    const pin = await pinCenter()
    await session.page.mouse.click(pin?.x ?? 0, pin?.y ?? 0)
    await waitInOverlay(session, '[data-testid="overlay-popover"]')
    const realm = await contentRealm(session)
    const value = await realm.evaluate(
      () =>
        globalThis.__webdevOverlay?.shadow?.querySelector<HTMLTextAreaElement>('textarea')?.value,
    )
    expect(value).toBe('Wider')
    await session.page.keyboard.down('Control')
    await session.page.keyboard.press('a')
    await session.page.keyboard.up('Control')
    await session.page.keyboard.type('Much wider')
    await session.page.keyboard.press('Enter')
    for (let i = 0; i < 50; i++) {
      const c = await storedCollection(panel)
      if (c?.items[0]?.comment === 'Much wider') break
      await sleep(100)
    }
    const c = await storedCollection(panel)
    expect(c?.items).toHaveLength(1)
    expect(c?.items[0]).toMatchObject({ number: 1, comment: 'Much wider' })
  })

  it('shows the pin again after activating on the reloaded page', async () => {
    await save(BUTTON, 'Wider')
    await waitForItems(panel, 1)
    await session.page.reload()
    await clickAction(session)
    await overlayMounted(session)
    await expectPinOnButton()
  })

  it('highlights the target while its panel entry is hovered', async () => {
    await save(BUTTON, 'Wider')
    await session.page.keyboard.press('Escape')
    await panel.waitForSelector('[data-testid="item"]')
    await panel.hover('[data-testid="item"]')
    await waitInOverlay(session, '[data-testid="overlay-highlight"]')
    await panel.mouse.move(5, 5)
    await waitInOverlay(session, '[data-testid="overlay-highlight"]', false)
  })

  it('scrolls to the target and opens it when its panel entry is clicked', async () => {
    await save(BUTTON, 'Wider')
    await session.page.keyboard.press('Escape')
    await session.page.evaluate(() => window.scrollTo(0, 2000))
    await panel.waitForSelector('[data-testid="item"] button')
    await panel.click('[data-testid="item"] button')
    await waitInOverlay(session, '[data-testid="overlay-popover"]')
    const visible = await session.page.$eval(BUTTON, (el) => {
      const r = el.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= innerHeight
    })
    expect(visible).toBe(true)
  })
})
