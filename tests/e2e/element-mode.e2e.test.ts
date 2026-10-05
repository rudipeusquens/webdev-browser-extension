import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import {
  centerOf,
  markElement,
  overlayMounted,
  overlayText,
  sleep,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

describe('element mode', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  const label = () => overlayText(session, '[data-testid="overlay-hover-label"]')

  it('outlines the element under the pointer and walks with the arrow keys', async () => {
    await session.page.keyboard.press('e')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    const { x, y } = await centerOf(session.page, 'button[type="submit"]')
    await session.page.mouse.move(x, y)
    await waitInOverlay(session, '[data-testid="overlay-hover-label"]')
    expect(await label()).toMatch(/^button · \d+×\d+$/)
    await session.page.keyboard.press('ArrowUp')
    await sleep(100)
    expect(await label()).toMatch(/^div · /)
    await session.page.keyboard.press('ArrowDown')
    await sleep(100)
    expect(await label()).toMatch(/^button · /)
  })

  it('saves a comment while the page never sees the click', async () => {
    const url = session.page.url()
    await markElement(session, 'button[type="submit"]')
    expect(await session.page.evaluate(() => (window as { pageClicks?: number }).pageClicks)).toBe(
      0,
    )
    await session.page.keyboard.type('Make it wider')
    await session.page.keyboard.press('Enter')
    const c = await waitForItems(panel, 1)
    expect(session.page.url()).toBe(url)
    const item = c?.items[0] as unknown as {
      number: number
      comment: string
      target: { kind: string; element: { selector: string; text: string } }
    }
    expect(item).toMatchObject({ number: 1, comment: 'Make it wider' })
    expect(item.target.kind).toBe('element')
    expect(item.target.element.text).toBe('Save changes')
    const matches = await session.page.evaluate(
      (sel) => [...document.querySelectorAll(sel)].map((el) => el.outerHTML),
      item.target.element.selector,
    )
    expect(matches).toEqual(['<button type="submit">Save changes</button>'])
    await waitInOverlay(session, '[data-testid="overlay-popover"]', false)
    // The mode stays, so several elements can be marked in a row.
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
  })

  it.each([['[id="2col"]'], ['[data-testid=\'say "hi"\']']])(
    'builds a selector Chrome resolves for %s',
    async (target) => {
      await markElement(session, target)
      await session.page.keyboard.type('Check')
      await session.page.keyboard.press('Enter')
      const c = await waitForItems(panel, 1)
      const selector = (c?.items[0]?.target as unknown as { element: { selector: string } }).element
        .selector
      const same = await session.page.evaluate(
        (sel, original) =>
          document.querySelectorAll(sel).length === 1 &&
          document.querySelector(sel) === document.querySelector(original),
        selector,
        target,
      )
      expect(same, selector).toBe(true)
    },
  )

  it('cancels with Escape, then leaves element mode with a second Escape', async () => {
    await markElement(session, 'h1')
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, '[data-testid="overlay-popover"]', false)
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, '[data-testid="overlay-glass"]', false)
    const c = await panel.evaluate(() => chrome.storage.local.get('collection'))
    expect(c.collection).toBeUndefined()
  })

  it('scrolls the container under the pointer', async () => {
    await session.page.keyboard.press('e')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    const { x, y } = await centerOf(session.page, '.scroll-box')
    await session.page.mouse.move(x, y)
    await session.page.mouse.wheel({ deltaY: 120 })
    await sleep(300)
    const scrolled = await session.page.$eval('.scroll-box', (el) => el.scrollTop)
    expect(scrolled).toBeGreaterThan(0)
  })

  // Puppeteer's click() moves the mouse first, which would hide the bug: press and release.
  it('marks what is under the pointer after scrolling without moving the mouse', async () => {
    await session.page.keyboard.press('e')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    const { x, y } = await centerOf(session.page, 'h1')
    await session.page.mouse.move(x, y)
    await waitInOverlay(session, '[data-testid="overlay-hover-label"]')
    expect(await label()).toMatch(/^h1 · /)
    await session.page.mouse.wheel({ deltaY: 300 })
    await sleep(300)
    await session.page.mouse.down()
    await session.page.mouse.up()
    await waitInOverlay(session, '[data-testid="overlay-popover"]')
    await session.page.keyboard.type('Here')
    await session.page.keyboard.press('Enter')
    const c = await waitForItems(panel, 1)
    const selector = (c?.items[0]?.target as unknown as { element: { selector: string } }).element
      .selector
    const underPointer = await session.page.evaluate(
      (sel, px, py) => {
        const host = document.querySelector('webdev-overlay')
        const under = document.elementsFromPoint(px, py).find((el) => el !== host)
        return document.querySelector(sel) === under
      },
      selector,
      x,
      y,
    )
    expect(underPointer, selector).toBe(true)
  })
})
