import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import { markElement, overlayMounted } from './overlay-helpers'

describe('overlay on a hostile page', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
    await session.page.goto(`${server.origin}/hostile/`)
    await clickAction(session)
    await overlayMounted(session)
    // The full-page layer covers everything, so the click marks the layer itself.
    await markElement(session, '.layer')
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('mounts in a closed shadow root with Tailwind styles intact', async () => {
    const realm = await contentRealm(session)
    const styles = await realm.evaluate(() => {
      const card = globalThis.__webdevOverlay?.shadow?.querySelector<HTMLElement>(
        '[data-testid="overlay-popover"]',
      )
      if (!card) return null
      const s = getComputedStyle(card)
      return { fontSize: s.fontSize, boxShadow: s.boxShadow, background: s.backgroundColor }
    })
    expect(styles).not.toBeNull()
    expect(styles?.fontSize).toBe('14px') // text-sm in px, despite html { font-size: 30px }
    expect(styles?.boxShadow).not.toBe('none') // shadow-lg needs @property registrations
    expect(styles?.background).not.toBe('rgba(0, 0, 0, 0)')
    const hostIsClosed = await session.page.evaluate(
      () => document.querySelector('[data-e2e-host]')?.shadowRoot === null,
    )
    expect(hostIsClosed).toBe(true)
  })

  it('sits above a full-page layer at maximum z-index', async () => {
    const realm = await contentRealm(session)
    const center = await realm.evaluate(() => {
      const r = globalThis.__webdevOverlay?.shadow
        ?.querySelector('[data-testid="overlay-popover"]')
        ?.getBoundingClientRect()
      return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    expect(center).toBeTruthy()
    const tag = await session.page.evaluate(
      (x, y) => document.elementFromPoint(x, y)?.hasAttribute('data-e2e-host'),
      center?.x ?? 0,
      center?.y ?? 0,
    )
    expect(tag).toBe(true)
  })

  it('keeps the popover inside the shadow root, not in the page', async () => {
    const inPage = await session.page.evaluate(
      () => document.querySelector('[data-testid="overlay-popover"]') !== null,
    )
    expect(inPage).toBe(false)
  })
})
