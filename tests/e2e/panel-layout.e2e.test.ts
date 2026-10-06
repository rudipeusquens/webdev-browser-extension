import type { Page } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import { markElement, overlayMounted, sleep, waitForItems, waitInOverlay } from './overlay-helpers'

interface Clickable {
  name: string
  disabled: boolean
  cursor: string
}

/** Every button of `root` with the cursor the browser computed for it. */
function cursorsOf(root: Document | ShadowRoot): Clickable[] {
  return [...root.querySelectorAll<HTMLButtonElement>('button, [role="button"]')].map((el) => ({
    name: el.getAttribute('aria-label') || el.textContent?.trim() || el.outerHTML.slice(0, 60),
    disabled:
      (el instanceof HTMLButtonElement && el.disabled) ||
      el.getAttribute('aria-disabled') === 'true',
    cursor: getComputedStyle(el).cursor,
  }))
}

/** `cursorsOf` called on `root`, as source for a page or the overlay's realm. */
const cursorsIn = (root: string) => `(${cursorsOf.toString()})(${root})`

function expectPointers(all: Clickable[]) {
  expect(all.filter((b) => !b.disabled).length).toBeGreaterThan(0)
  for (const b of all) {
    expect({ name: b.name, cursor: b.cursor }).toEqual({
      name: b.name,
      cursor: b.disabled ? 'default' : 'pointer',
    })
  }
}

describe('everything clickable shows the pointer', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
    await session.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(session)
    await overlayMounted(session)
    await markElement(session, 'button[type="submit"]')
    await session.page.keyboard.type('Make it wider.')
    await session.page.keyboard.press('Enter')
    await waitForItems(panel, 1)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('in both views of the panel', async () => {
    expectPointers((await panel.evaluate(cursorsIn('document'))) as Clickable[])
    await panel.click('[data-testid="open-settings"]')
    await panel.waitForSelector('[data-testid="shortcut-list"]')
    expectPointers((await panel.evaluate(cursorsIn('document'))) as Clickable[])
    await panel.click('[data-testid="close-settings"]')
  })

  it('on the pins and in the comment popover', async () => {
    await waitInOverlay(session, '[data-testid="overlay-pin"]')
    await sleep(100)
    const realm = await contentRealm(session)
    const shadow = 'globalThis.__webdevOverlay.shadow'
    expectPointers((await realm.evaluate(cursorsIn(shadow))) as Clickable[])
    const pin = await realm.evaluate(() => {
      const r = globalThis.__webdevOverlay?.shadow
        ?.querySelector('[data-testid="overlay-pin"]')
        ?.getBoundingClientRect()
      return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    if (!pin) throw new Error('no pin')
    await session.page.mouse.click(pin.x, pin.y)
    await waitInOverlay(session, '[data-testid="overlay-popover"]')
    const popover = await realm.evaluate(cursorsIn(shadow))
    expectPointers(popover as Clickable[])
    expect((popover as Clickable[]).some((b) => b.name === 'Cancel')).toBe(true)
  })
})
