import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import { markElement, overlayMounted, storedCollection, waitInOverlay } from './overlay-helpers'

// Chrome's chrome.dom.openOrClosedShadowRoot() throws for anything but an HTML element, and
// most real pages have inline SVG icons: the overlay must neither fail to start nor stop
// working on them.
describe('pages with SVG and MathML', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('starts the overlay', async () => {
    await session.page.goto(`${server.origin}/svg/`)
    const panel = await clickAction(session)
    await overlayMounted(session)
    await panel.waitForSelector('::-p-text(Active on localhost:)')
  })

  it('marks an element inside an SVG drawing', async () => {
    await session.page.goto(`${server.origin}/svg/`)
    const panel = await clickAction(session)
    await overlayMounted(session)
    await markElement(session, '#bar')
    await session.page.keyboard.type('Make the bar blue')
    await session.page.keyboard.press('Enter')
    await panel.waitForSelector('[data-testid="item"] ::-p-text(Make the bar blue)')
    const stored = await storedCollection(panel)
    expect(JSON.stringify(stored?.items.at(-1)?.target)).toContain('rect')
  })

  it('switches modes by key while an SVG element has focus', async () => {
    await session.page.goto(`${server.origin}/svg/`)
    await clickAction(session)
    await overlayMounted(session)
    // Puppeteer's focus() takes HTML elements only.
    await session.page.$eval('#chart-link', (el) => (el as SVGElement).focus())
    expect(await session.page.evaluate(() => document.activeElement?.id)).toBe('chart-link')
    await session.page.keyboard.press('e')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
  })
})
