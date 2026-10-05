import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import { centerOf, overlayMounted, sleep, waitInOverlay } from './overlay-helpers'

// A modal dialog makes everything outside it inert, including top-layer elements shown above
// it; the overlay has to move into the dialog to stay usable (spec section 13, spike 3).
describe('overlay above modal dialogs', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/modal/`)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  /**
   * The overlay takes trusted input above whatever the page shows: in element mode the glass
   * is on top at `selector`, and a real click there opens the comment popover.
   */
  async function expectUsable(selector: string) {
    await session.page.keyboard.press('e')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    // Let the overlay react to the page's last change.
    await sleep(200)
    const { x, y } = await centerOf(session.page, selector)
    const top = await session.page.evaluate(
      (px, py) => document.elementFromPoint(px, py)?.localName,
      x,
      y,
    )
    expect(top).toBe('webdev-overlay')
    await session.page.mouse.move(x, y)
    await session.page.mouse.click(x, y)
    await waitInOverlay(session, '[data-testid="overlay-popover"]')
  }

  const openModal = () => session.page.click('#open')
  const hostParent = () =>
    session.page.evaluate(() => document.querySelector('webdev-overlay')?.parentElement?.localName)

  it('stays usable when a modal opens after activation', async () => {
    await clickAction(session)
    await overlayMounted(session)
    await openModal()
    await expectUsable('#inside')
  })

  it('is usable when activated while a modal is open', async () => {
    await openModal()
    await clickAction(session)
    await overlayMounted(session)
    await expectUsable('#inside')
  })

  it('goes back to the body when the modal closes', async () => {
    await clickAction(session)
    await overlayMounted(session)
    await openModal()
    await sleep(200)
    await session.page.evaluate(() => document.querySelector('dialog')?.close())
    await sleep(200)
    expect(await hostParent()).toBe('body')
    await expectUsable('h1')
  })

  it('survives the page removing the open dialog', async () => {
    await clickAction(session)
    await overlayMounted(session)
    await openModal()
    await sleep(200)
    await session.page.evaluate(() => document.querySelector('dialog')?.remove())
    await sleep(200)
    expect(await hostParent()).toBe('body')
    await expectUsable('h1')
  })

  it('rises above a page popover that opens later', async () => {
    await clickAction(session)
    await overlayMounted(session)
    await session.page.click('#menu')
    await expectUsable('#sheet')
  })

  it('removes an inert attribute the page puts on the host', async () => {
    await clickAction(session)
    await overlayMounted(session)
    await session.page.evaluate(() => {
      const host = document.querySelector('webdev-overlay') as HTMLElement | null
      if (host) host.inert = true
    })
    await expectUsable('h1')
  })
})
