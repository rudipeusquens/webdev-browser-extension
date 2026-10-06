import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, launch, type Session, startFixtureServer, startOverlayAgain } from './harness'
import { centerOf, overlayMounted, sleep, waitInOverlay } from './overlay-helpers'

// Element and area mode cover the page with a glass: the wheel must scroll as it does without
// it, also on pages that scroll smoothly (spec section 8).
describe('the wheel in element mode', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
    await session.page.goto(`${server.origin}/plain/smooth.html`)
    await clickAction(session)
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  const scrolled = () => session.page.evaluate(() => window.scrollY)
  const boxScrolled = () => session.page.$eval('#box', (el) => el.scrollTop)

  /** Back to the top at once (not smoothly), and the container to `boxTop`. */
  async function reset(boxTop = 0) {
    await session.page.evaluate((top) => {
      window.scrollTo({ top: 0, behavior: 'instant' })
      document.getElementById('box')?.scrollTo({ top, behavior: 'instant' })
    }, boxTop)
    expect(await scrolled()).toBe(0)
  }

  /** Four quick turns of the wheel over `selector`, then time to settle. */
  async function turns(selector: string, count = 4) {
    const { x, y } = await centerOf(session.page, selector)
    await session.page.mouse.move(x, y)
    for (let i = 0; i < count; i++) await session.page.mouse.wheel({ deltaY: 100 })
    await sleep(1500)
  }

  async function elementMode() {
    await session.page.keyboard.press('e')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
  }

  async function browseMode() {
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, '[data-testid="overlay-glass"]', false)
  }

  it('scrolls the document as far as without the overlay', async () => {
    await reset()
    await turns('#free')
    const plain = await scrolled()
    expect(plain).toBeGreaterThan(0)
    await reset()
    await elementMode()
    await turns('#free')
    expect(await scrolled()).toBeCloseTo(plain, 0)
    await browseMode()
  })

  it('scrolls a smoothly scrolling container by the full distance', async () => {
    await reset()
    await elementMode()
    await turns('#box')
    expect(await boxScrolled()).toBe(400)
    expect(await scrolled()).toBe(0)
    await browseMode()
  })

  it('scrolls nothing past a container that keeps the wheel at its end', async () => {
    await reset()
    await session.page.$eval('#contained', (el) =>
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }),
    )
    await elementMode()
    await turns('#contained', 2)
    expect(await scrolled()).toBe(0)
    await browseMode()
  })

  it('lets the page scroll on once the container is at its end', async () => {
    const end = await session.page.$eval('#box', (el) => el.scrollHeight - el.clientHeight)
    await reset(end)
    await elementMode()
    await turns('#box', 2)
    expect(await scrolled()).toBeGreaterThan(0)
    await browseMode()
  })

  // Last: it leaves the fixture page.
  it('scrolls a page whose body is the scroll container', async () => {
    await session.page.goto(`${server.origin}/plain/body-scroll.html`)
    // The toolbar's grant outlives the navigation on the same site, the overlay does not.
    await startOverlayAgain(session)
    await overlayMounted(session)
    await elementMode()
    await turns('#free', 2)
    expect(await session.page.evaluate(() => document.body.scrollTop)).toBe(200)
    await browseMode()
  })
})
