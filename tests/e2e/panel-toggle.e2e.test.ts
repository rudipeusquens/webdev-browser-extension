import type { Page } from 'puppeteer'
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import { markElement, overlayMounted, sleep, waitInOverlay } from './overlay-helpers'

const GLASS = '[data-testid="overlay-glass"]'

const panelUrl = (s: Session) => `chrome-extension://${s.extensionId}/sidepanel.html`

/** Uses the toolbar action on `page`, without waiting for a panel. */
async function useAction(s: Session, page: Page) {
  const extension = (await s.browser.extensions()).get(s.extensionId)
  if (!extension) throw new Error('extension is not installed')
  await page.triggerExtensionAction(extension)
}

/** Waits until the extension's side panel is closed. */
async function panelClosed(s: Session) {
  for (let i = 0; i < 50; i++) {
    if (!s.browser.targets().some((t) => t.url() === panelUrl(s))) return
    await sleep(100)
  }
  throw new Error('the panel did not close')
}

describe('the toolbar action toggles the side panel', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
  })

  beforeEach(async () => {
    session = await launch()
    await session.page.goto(`${server.origin}/plain/`)
  })

  afterEach(async () => {
    await session?.browser.close()
  })

  afterAll(async () => {
    await server?.close()
  })

  it('closes on a second click and leaves the page in browse mode with its pins', async () => {
    const panel = await clickAction(session)
    await overlayMounted(session)
    await panel.waitForSelector('::-p-text(Active on localhost:)')
    await markElement(session, 'button[type="submit"]')
    await session.page.keyboard.type('Make it wider')
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, '[data-testid="overlay-popover"]', false)
    await waitInOverlay(session, GLASS)

    await useAction(session, session.page)
    await panelClosed(session)
    await waitInOverlay(session, GLASS, false)
    await waitInOverlay(session, '[data-testid="overlay-pin"]')

    // And opens again on the next click.
    const again = await clickAction(session)
    await again.waitForSelector('::-p-text(Active on localhost:)')
  })

  it('activates another tab instead of closing', async () => {
    const panel = await clickAction(session)
    await overlayMounted(session)
    const other = await session.browser.newPage()
    await other.goto(`${server.origin}/svg/`)
    await other.bringToFront()
    await panel.waitForSelector('::-p-text(Not active on this page)')
    await useAction(session, other)
    await overlayMounted({ ...session, page: other })
    await panel.waitForSelector('::-p-text(Active on localhost:)')
    expect(panel.isClosed()).toBe(false)
  })

  it('keeps the mode of a tab the panel moves away from', async () => {
    const panel = await clickAction(session)
    await overlayMounted(session)
    await session.page.keyboard.press('e')
    await waitInOverlay(session, GLASS)
    const other = await session.browser.newPage()
    await other.goto(`${server.origin}/svg/`)
    await other.bringToFront()
    await panel.waitForSelector('::-p-text(Not active on this page)')
    await session.page.bringToFront()
    await panel.waitForSelector('::-p-text(Active on localhost:)')
    await sleep(300)
    await waitInOverlay(session, GLASS)
  })

  it('goes to browse mode when the panel is closed some other way', async () => {
    const panel = await clickAction(session)
    await overlayMounted(session)
    await session.page.keyboard.press('e')
    await waitInOverlay(session, GLASS)
    await panel.close()
    await panelClosed(session)
    await waitInOverlay(session, GLASS, false)
  })
})
