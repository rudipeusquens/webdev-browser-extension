import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'

describe('overlay on a hostile page', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
    await session.page.goto(`${server.origin}/hostile/`)
    await clickAction(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('mounts in a closed shadow root with Tailwind styles intact', async () => {
    const realm = await contentRealm(session)
    const styles = await realm.evaluate(async () => {
      for (let i = 0; i < 50 && !globalThis.__webdevOverlay?.shadow; i++) {
        await new Promise((done) => setTimeout(done, 100))
      }
      const shadow = globalThis.__webdevOverlay?.shadow
      const button = shadow?.querySelector<HTMLElement>('[data-testid="overlay-trigger"]')
      if (!button) return null
      const s = getComputedStyle(button)
      return { fontSize: s.fontSize, boxShadow: s.boxShadow, background: s.backgroundColor }
    })
    expect(styles).not.toBeNull()
    expect(styles?.fontSize).toBe('14px') // text-sm in px, despite html { font-size: 30px }
    expect(styles?.boxShadow).not.toBe('none') // shadow-lg needs @property registrations
    expect(styles?.background).not.toBe('rgba(0, 0, 0, 0)')
    const hostIsClosed = await session.page.evaluate(
      () => document.querySelector('webdev-overlay')?.shadowRoot === null,
    )
    expect(hostIsClosed).toBe(true)
  })

  // Covers z-index stacking only; the browser's top layer (modal dialogs) is milestone 2.
  it('sits above a full-page layer at maximum z-index', async () => {
    const tag = await session.page.evaluate(() => {
      const host = document.querySelector('webdev-overlay')
      if (!host) return null
      // The trigger is fixed at the bottom-right corner.
      return document.elementFromPoint(innerWidth - 40, innerHeight - 30)?.tagName.toLowerCase()
    })
    expect(tag).toBe('webdev-overlay')
  })

  it('opens the popover inside the shadow root, not in the page', async () => {
    const realm = await contentRealm(session)
    const inShadow = await realm.evaluate(async () => {
      const shadow = globalThis.__webdevOverlay?.shadow
      shadow?.querySelector<HTMLElement>('[data-testid="overlay-trigger"]')?.click()
      for (let i = 0; i < 50; i++) {
        if (shadow?.querySelector('[data-testid="overlay-popover"]')) return true
        await new Promise((done) => setTimeout(done, 100))
      }
      return false
    })
    expect(inShadow).toBe(true)
    const inPage = await session.page.evaluate(
      () => document.querySelector('[data-testid="overlay-popover"]') !== null,
    )
    expect(inPage).toBe(false)
  })
})
