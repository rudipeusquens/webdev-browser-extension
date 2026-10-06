import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import {
  clickInOverlay,
  markElement,
  overlayMounted,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

// Named images and forms shadow members of `document` in the page's own world only; named
// form controls shadow their form's properties in every world, the content script's
// included, so the overlay reads nodes through the prototypes (spec section 11).
describe('a page whose named elements shadow document and form members', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/clobbered/`)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('shadows them in the page', async () => {
    const clobbered = await session.page.evaluate(
      () => (window as unknown as { clobbered: string[] }).clobbered,
    )
    expect(clobbered).toHaveLength(9)
  })

  it('marks an element with the real title and selector', async () => {
    const panel = await clickAction(session)
    await overlayMounted(session)
    await markElement(session, '#action')
    await session.page.keyboard.type('Rename this')
    await session.page.keyboard.press('Enter')
    const stored = (await waitForItems(panel, 1)) as unknown as {
      pages: Record<string, { title: string }>
      items: { target: { element: { selector: string; box: { width: number } } } }[]
    }
    expect(Object.values(stored.pages)[0]?.title).toBe('Clobbered fixture')
    const element = stored.items[0]?.target.element
    expect(element?.selector).toBe('#action')
    expect(element?.box.width).toBeGreaterThan(0)
  })

  it('reads selected text through a form whose controls shadow its node properties', async () => {
    const panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    // A selection that starts at a boundary inside the form, as the user left it.
    await session.page.evaluate(() => {
      const range = document.createRange()
      range.setStartBefore(document.getElementById('in-form') as HTMLElement)
      const after = (document.getElementById('after-form') as HTMLElement).firstChild as Text
      range.setEnd(after, after.length)
      // `document.getSelection` is one of the shadowed names here.
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await session.page.keyboard.press('Shift')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await waitInOverlay(session, '[data-testid="overlay-popover"]')
    await session.page.keyboard.type('Two lines')
    await session.page.keyboard.press('Enter')
    const stored = (await waitForItems(panel, 1)) as unknown as {
      items: { target: { selected: string } }[]
    }
    expect(stored.items[0]?.target.selected).toBe('Inside the form text After it')
  })
})
