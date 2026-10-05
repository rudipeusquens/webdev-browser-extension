import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import { markElement, overlayMounted, waitForItems } from './overlay-helpers'

// Named images and forms shadow members of `document` in every world, the content script's
// included; the overlay reads them through the prototypes (spec section 11).
describe('a page whose named elements shadow document members', () => {
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
})
