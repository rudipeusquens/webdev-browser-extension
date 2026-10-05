import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'

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

  /** Center of the overlay trigger in viewport coordinates, once it is mounted. */
  async function triggerCenter() {
    const realm = await contentRealm(session)
    return realm.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        const button = globalThis.__webdevOverlay?.shadow?.querySelector<HTMLElement>(
          '[data-testid="overlay-trigger"]',
        )
        if (button) {
          const r = button.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }
        await new Promise((done) => setTimeout(done, 100))
      }
      throw new Error('overlay did not mount')
    })
  }

  async function expectUsable() {
    const { x, y } = await triggerCenter()
    // Let the overlay react to the page's last change.
    await new Promise((done) => setTimeout(done, 200))
    const top = await session.page.evaluate(
      (px, py) => document.elementFromPoint(px, py)?.localName,
      x,
      y,
    )
    expect(top).toBe('webdev-overlay')
    await session.page.mouse.click(x, y)
    const realm = await contentRealm(session)
    const opened = await realm.evaluate(async () => {
      for (let i = 0; i < 30; i++) {
        if (globalThis.__webdevOverlay?.shadow?.querySelector('[data-testid="overlay-popover"]'))
          return true
        await new Promise((done) => setTimeout(done, 100))
      }
      return false
    })
    expect(opened).toBe(true)
  }

  const openModal = () => session.page.click('#open')
  const hostParent = () =>
    session.page.evaluate(() => document.querySelector('webdev-overlay')?.parentElement?.localName)

  it('stays usable when a modal opens after activation', async () => {
    await clickAction(session)
    await triggerCenter()
    await openModal()
    await expectUsable()
  })

  it('is usable when activated while a modal is open', async () => {
    await openModal()
    await clickAction(session)
    await expectUsable()
  })

  it('goes back to the body when the modal closes', async () => {
    await clickAction(session)
    await triggerCenter()
    await openModal()
    await new Promise((done) => setTimeout(done, 200))
    await session.page.evaluate(() => document.querySelector('dialog')?.close())
    await new Promise((done) => setTimeout(done, 200))
    expect(await hostParent()).toBe('body')
    await expectUsable()
  })

  it('survives the page removing the open dialog', async () => {
    await clickAction(session)
    await triggerCenter()
    await openModal()
    await new Promise((done) => setTimeout(done, 200))
    await session.page.evaluate(() => document.querySelector('dialog')?.remove())
    await new Promise((done) => setTimeout(done, 200))
    expect(await hostParent()).toBe('body')
    await expectUsable()
  })

  it('rises above a page popover that opens later', async () => {
    await clickAction(session)
    await triggerCenter()
    await session.page.click('#menu')
    await expectUsable()
  })

  it('removes an inert attribute the page puts on the host', async () => {
    await clickAction(session)
    await triggerCenter()
    await session.page.evaluate(() => {
      const host = document.querySelector('webdev-overlay') as HTMLElement | null
      if (host) host.inert = true
    })
    await expectUsable()
  })
})
