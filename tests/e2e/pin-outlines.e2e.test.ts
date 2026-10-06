import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import {
  clickInOverlay,
  dragSelect,
  markElement,
  overlayCenter,
  overlayMounted,
  sleep,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const POPOVER = '[data-testid="overlay-popover"]'

interface Drawn {
  x: number
  y: number
  width: number
  height: number
  style: string
  borders: number[]
  strong: boolean
}

// Pins mark their target, not only a corner of it (spec section 8).
describe('pin outlines', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/plain/layout.html`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  async function saveComment(count: number) {
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.type(`Item ${count}`)
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, POPOVER, false)
    await waitForItems(panel, count)
    await session.page.keyboard.press('Escape')
  }

  /** What the overlay draws for `testid`, after positions settled. */
  async function drawn(testid: string): Promise<Drawn[]> {
    await sleep(150)
    const realm = await contentRealm(session)
    return realm.evaluate((id) => {
      const found = globalThis.__webdevOverlay?.shadow?.querySelectorAll(`[data-testid="${id}"]`)
      return [...(found ?? [])].map((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          style: s.borderTopStyle === 'none' ? s.borderLeftStyle : s.borderTopStyle,
          borders: [
            s.borderTopWidth,
            s.borderRightWidth,
            s.borderBottomWidth,
            s.borderLeftWidth,
          ].map((w) => parseFloat(w)),
          strong: el.getAttribute('data-strong') === 'true',
        }
      })
    }, testid)
  }

  const box = (selector: string) =>
    session.page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })

  it('outlines a marked element just outside its box', async () => {
    await markElement(session, '#row-1')
    await saveComment(1)
    const [outline] = await drawn('overlay-outline')
    const row = await box('#row-1')
    expect(outline?.x).toBeCloseTo(row.x - 2, 0)
    expect(outline?.y).toBeCloseTo(row.y - 2, 0)
    expect(outline?.width).toBeCloseTo(row.width + 4, 0)
    expect(outline?.height).toBeCloseTo(row.height + 4, 0)
    expect(outline?.style).toBe('solid')
    expect(outline?.borders).toEqual([2, 2, 2, 2])
  })

  it('leaves the line off where the scroll container cuts the element', async () => {
    await markElement(session, '#row-2')
    await saveComment(1)
    await session.page.$eval('#list', (el) => (el.scrollTop = 60))
    const [outline] = await drawn('overlay-outline')
    const list = await box('#list')
    expect(outline?.y).toBeCloseTo(list.y, 0)
    expect(outline?.borders).toEqual([0, 2, 2, 2])
    await session.page.$eval('#list', (el) => (el.scrollTop = 200))
    expect(await drawn('overlay-outline')).toEqual([])
  })

  it('outlines a marked area with a dashed line', async () => {
    await session.page.keyboard.press('a')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    await session.page.mouse.move(420, 60)
    await session.page.mouse.down()
    await session.page.mouse.move(620, 160, { steps: 6 })
    await session.page.mouse.up()
    await saveComment(1)
    const [outline] = await drawn('overlay-outline')
    expect(outline?.x).toBeCloseTo(418, 0)
    expect(outline?.y).toBeCloseTo(58, 0)
    expect(outline?.width).toBeCloseTo(204, 0)
    expect(outline?.height).toBeCloseTo(104, 0)
    expect(outline?.style).toBe('dashed')
  })

  it('highlights the lines of a marked text', async () => {
    await dragSelect(session.page, '#textbox', 'Line one')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await saveComment(1)
    const lines = await drawn('overlay-pin-text')
    expect(lines.length).toBeGreaterThanOrEqual(1)
    const text = await session.page.$eval('#textbox', (el) => {
      const range = document.createRange()
      const node = el.firstChild as Text
      const at = node.data.indexOf('Line one')
      range.setStart(node, at)
      range.setEnd(node, at + 'Line one'.length)
      const r = range.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    expect(lines[0]?.x).toBeCloseTo(text.x, 0)
    expect(lines[0]?.y).toBeCloseTo(text.y, 0)
    expect(lines[0]?.width).toBeCloseTo(text.width, 0)
  })

  it('hides the outlines with the pins', async () => {
    await markElement(session, '#row-1')
    await saveComment(1)
    expect(await drawn('overlay-outline')).toHaveLength(1)
    await session.page.keyboard.press('p')
    expect(await drawn('overlay-outline')).toEqual([])
    await session.page.keyboard.press('p')
    expect(await drawn('overlay-outline')).toHaveLength(1)
  })

  it('draws the outline stronger while its pin is hovered', async () => {
    await markElement(session, '#row-1')
    await saveComment(1)
    expect((await drawn('overlay-outline'))[0]?.strong).toBe(false)
    const pin = await overlayCenter(session, '[data-testid="overlay-pin"]')
    await session.page.mouse.move(pin.x, pin.y)
    expect((await drawn('overlay-outline'))[0]?.strong).toBe(true)
    await session.page.mouse.move(700, 700)
    expect((await drawn('overlay-outline'))[0]?.strong).toBe(false)
  })

  it('does not keep the stronger outline after its pin was hidden under the pointer', async () => {
    await markElement(session, '#row-1')
    await saveComment(1)
    const pin = await overlayCenter(session, '[data-testid="overlay-pin"]')
    await session.page.mouse.move(pin.x, pin.y)
    expect((await drawn('overlay-outline'))[0]?.strong).toBe(true)
    // The pin goes away under the pointer: no mouseleave.
    await session.page.keyboard.press('p')
    await session.page.mouse.move(700, 700)
    await session.page.keyboard.press('p')
    expect((await drawn('overlay-outline'))[0]?.strong).toBe(false)
  })
})
