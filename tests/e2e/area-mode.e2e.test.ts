import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AreaTarget, Collection } from '../../src/lib/collection/model'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import {
  clickInOverlay,
  overlayMounted,
  overlayText,
  sleep,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const GLASS = '[data-testid="overlay-glass"]'
const DRAG = '[data-testid="overlay-area"]'
const POPOVER = '[data-testid="overlay-popover"]'

describe('marking an area', () => {
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

  /** Viewport corners just outside the three cards. */
  const aroundCards = () =>
    session.page.$$eval('.card', (cards) => {
      const boxes = cards.map((c) => c.getBoundingClientRect())
      return {
        from: {
          x: Math.min(...boxes.map((b) => b.left)) - 8,
          y: Math.min(...boxes.map((b) => b.top)) - 8,
        },
        to: {
          x: Math.max(...boxes.map((b) => b.right)) + 8,
          y: Math.max(...boxes.map((b) => b.bottom)) + 8,
        },
      }
    })

  async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    await session.page.mouse.move(from.x, from.y)
    await session.page.mouse.down()
    await session.page.mouse.move(to.x, to.y, { steps: 10 })
  }

  async function areaMode() {
    await session.page.keyboard.press('a')
    await waitInOverlay(session, GLASS)
  }

  it('drags around three cards and stores them', async () => {
    await session.page.evaluate(() => window.scrollTo(0, 60))
    await areaMode()
    const { from, to } = await aroundCards()
    await drag(from, to)
    await waitInOverlay(session, DRAG)
    expect(await overlayText(session, DRAG)).toMatch(/^\d+×\d+$/)
    await session.page.mouse.up()
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.type('Spacing is uneven')
    await session.page.keyboard.press('Enter')

    const stored = (await waitForItems(panel, 1)) as unknown as Collection
    const target = stored.items[0]?.target as AreaTarget
    expect(target.kind).toBe('area')
    expect(target.elements.map((e) => e.text)).toEqual(['Fast setup', 'Secure', 'Support'])
    expect(target.elements.every((e) => e.selector.includes('card'))).toBe(true)
    expect(target.moreCount).toBe(0)
    const container = await session.page.$$eval(target.container.selector, (els) =>
      els.map((el) => el.className),
    )
    expect(container).toEqual(['features'])
    expect(target.rect.y).toBe(Math.round(from.y + 60))
    expect(target.rect.width).toBe(Math.round(to.x - from.x))

    expect(
      await session.page.evaluate(() => (window as unknown as { pageClicks: number }).pageClicks),
    ).toBe(0)
    expect(await session.page.evaluate(() => document.getSelection()?.toString())).toBe('')
    await panel.waitForSelector('::-p-text(Area with 3 elements)')
    await waitInOverlay(session, '[data-testid="overlay-pin"]')
  })

  it('opens nothing for a click without dragging', async () => {
    await areaMode()
    await session.page.mouse.click(200, 200)
    await sleep(300)
    const realm = await contentRealm(session)
    const open = await realm.evaluate(
      (sel) => !!globalThis.__webdevOverlay?.shadow?.querySelector(sel),
      POPOVER,
    )
    expect(open).toBe(false)
  })

  it('cancels a drag with Escape and leaves area mode with a second one', async () => {
    await areaMode()
    const { from, to } = await aroundCards()
    await drag(from, to)
    await waitInOverlay(session, DRAG)
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, DRAG, false)
    await session.page.mouse.up()
    await sleep(200)
    expect((await storedCollection(panel))?.items.length ?? 0).toBe(0)
    await waitInOverlay(session, GLASS)
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, GLASS, false)
  })

  it('switches to area mode from the panel', async () => {
    await panel.click('[data-testid="mode-area"]')
    await waitInOverlay(session, GLASS)
    await panel.click('[data-testid="mode-browse"]')
    await waitInOverlay(session, GLASS, false)
  })

  it('fits the mode switch into a narrow side panel', async () => {
    await panel.setViewport({ width: 320, height: 600 })
    await panel.waitForSelector('[data-testid="mode-area"]')
    const overflowing = await panel.$$eval('header *', (els) =>
      els
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth)
        .map((el) => el.outerHTML.slice(0, 60)),
    )
    expect(overflowing).toEqual([])
  })

  it('opens the saved area again from its pin', async () => {
    await areaMode()
    const { from, to } = await aroundCards()
    await drag(from, to)
    await session.page.mouse.up()
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.type('Cards')
    await session.page.keyboard.press('Enter')
    await waitForItems(panel, 1)
    await waitInOverlay(session, POPOVER, false)
    await clickInOverlay(session, '[data-testid="overlay-pin"]')
    await waitInOverlay(session, POPOVER)
    expect(await overlayText(session, POPOVER)).toContain('Pin 1')
  })
})
