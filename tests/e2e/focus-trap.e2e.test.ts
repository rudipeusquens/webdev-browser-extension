import type { Page } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import {
  markElement,
  overlayMounted,
  overlayText,
  sleep,
  storedCollection,
  waitForItems,
} from './overlay-helpers'

// Script focus traps pull focus back into their container, so typing and Enter would go to
// the page: here Enter would submit the page's "Delete this item?" form.
describe('pages with a script focus trap', () => {
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

  async function activate(path: string): Promise<Page> {
    await session.page.goto(`${server.origin}${path}`)
    const panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    return panel
  }

  const submits = () => session.page.evaluate(() => (window as { submits?: number }).submits)

  it('keeps the comment field focused inside a dialog-like trap', async () => {
    const panel = await activate('/trap/')
    await markElement(session, '#question')
    await session.page.keyboard.type('Bigger')
    await session.page.keyboard.press('Enter')
    const c = await waitForItems(panel, 1)
    expect(c?.items[0]?.comment).toBe('Bigger')
    expect(await submits()).toBe(0)
  })

  it('never lets Enter reach the page while a trap holds the focus', async () => {
    const panel = await activate('/trap/?plain')
    await markElement(session, '#question')
    await session.page.keyboard.type('Bigger')
    await session.page.keyboard.press('Enter')
    await sleep(300)
    expect(await submits()).toBe(0)
    expect(await overlayText(session, '[data-testid="overlay-popover"] [role="alert"]')).toContain(
      'This page took the focus',
    )
    expect(await storedCollection(panel)).toBeUndefined()
  })
})
