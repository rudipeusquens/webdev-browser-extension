import { describe, expect, it } from 'vitest'
import { useBrowser, useFixtureServer } from './harness'
import { markElement, startOverlay, storedCollection, waitInOverlay } from './overlay-helpers'

// Chrome's chrome.dom.openOrClosedShadowRoot() throws for anything but an HTML element, and
// most real pages have inline SVG icons: the overlay must neither fail to start nor stop
// working on them.
describe('pages with SVG and MathML', () => {
  const server = useFixtureServer()
  const session = useBrowser()

  it('starts the overlay', async () => {
    const panel = await startOverlay(session, `${server.origin}/svg/`, { clear: false })
    await panel.waitForSelector('[data-testid="site-pill"][data-state="active"]')
  })

  it('marks an element inside an SVG drawing', async () => {
    const panel = await startOverlay(session, `${server.origin}/svg/`, { clear: false })
    await markElement(session, '#bar')
    await session.page.keyboard.type('Make the bar blue')
    await session.page.keyboard.press('Enter')
    await panel.waitForSelector('[data-testid="item"] ::-p-text(Make the bar blue)')
    const stored = await storedCollection(panel)
    expect(JSON.stringify(stored?.items.at(-1)?.target)).toContain('rect')
  })

  it('switches modes by key while an SVG element has focus', async () => {
    await startOverlay(session, `${server.origin}/svg/`, { clear: false })
    // Puppeteer's focus() takes HTML elements only.
    await session.page.$eval('#chart-link', (el) => (el as SVGElement).focus())
    expect(await session.page.evaluate(() => document.activeElement?.id)).toBe('chart-link')
    await session.page.keyboard.press('e')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
  })
})
