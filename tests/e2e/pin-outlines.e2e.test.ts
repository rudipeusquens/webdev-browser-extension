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
    await session.browser
      .defaultBrowserContext()
      .overridePermissions(`chrome-extension://${session.extensionId}`, [
        'clipboard-read',
        'clipboard-sanitized-write',
      ])
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

  /** The texts the page's highlight registry holds under `name`. */
  const marked = (name: string) =>
    session.page.evaluate(
      (n) => [...((CSS.highlights.get(n) as Iterable<Range> | undefined) ?? [])].map(String),
      name,
    )

  it('shades a marked text, drawn by the browser', async () => {
    await dragSelect(session.page, '#textbox', 'Line one')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await saveComment(1)
    await session.page.evaluate(() => getSelection()?.removeAllRanges())
    expect(await marked('webdev-pins-open')).toEqual(['Line one'])
    // Painted: the text looks different with the pins hidden.
    const area = await box('#textbox')
    const shot = () => session.page.screenshot({ clip: area, encoding: 'base64' })
    const shaded = await shot()
    await session.page.keyboard.press('p')
    expect(await marked('webdev-pins-open')).toEqual([])
    expect(await shot()).not.toBe(shaded)
    await session.page.keyboard.press('p')
    expect(await marked('webdev-pins-open')).toEqual(['Line one'])
  })

  it('shades a text stronger while its pin is hovered', async () => {
    await dragSelect(session.page, '#textbox', 'Line one')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await saveComment(1)
    const pin = await overlayCenter(session, '[data-testid="overlay-pin"]')
    await session.page.mouse.move(pin.x, pin.y)
    await sleep(150)
    expect(await marked('webdev-pins-open-strong')).toEqual(['Line one'])
    expect(await marked('webdev-pins-open')).toEqual([])
    await session.page.mouse.move(700, 700)
    await sleep(150)
    expect(await marked('webdev-pins-open')).toEqual(['Line one'])
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

  it('colors every marking of a pin by its status, at once when it changes', async () => {
    await markElement(session, '#row-1')
    await saveComment(1)
    await dragSelect(session.page, '#textbox', 'Line one')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await saveComment(2)
    await session.page.evaluate(() => getSelection()?.removeAllRanges())
    await panel.click('[data-testid="filter-all"]')
    const realm = await contentRealm(session)
    /** Computed colors in the overlay: each pin's fill, the outline, highlight and marking. */
    const colors = () =>
      realm.evaluate(() => {
        const root = globalThis.__webdevOverlay?.shadow
        const one = (id: string) => root?.querySelector(`[data-testid="${id}"]`)
        const pins = Object.fromEntries(
          [...(root?.querySelectorAll('[data-testid="overlay-pin"]') ?? [])].map((p) => [
            p.textContent?.trim(),
            getComputedStyle(p).backgroundColor,
          ]),
        )
        const outline = one('overlay-outline')
        const highlight = one('overlay-highlight')
        const marking = root?.querySelector('[data-testid="overlay-hover"]')
        return {
          pins,
          outline: outline && getComputedStyle(outline).borderTopColor,
          highlight: highlight && getComputedStyle(highlight).outlineColor,
          label: highlight && getComputedStyle(highlight.firstElementChild!).backgroundColor,
          marking: marking && getComputedStyle(marking).outlineColor,
        }
      })
    /** The status colors as the panel paints its numbers. */
    const badge = (n: number) =>
      panel.$$eval(
        '[data-testid="item-number"]',
        (els, n) => {
          const el = els.find((e) => e.textContent?.trim() === String(n))
          return el ? getComputedStyle(el).backgroundColor : null
        },
        n,
      )
    const blue = await badge(1)
    expect((await colors()).pins).toEqual({ '1': blue, '2': blue })

    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('[data-testid="copy-status"] ::-p-text(Copied 2 pins)')
    await sleep(200)
    const green = await badge(1)
    expect(green).not.toBe(blue)
    let now = await colors()
    expect(now.pins).toEqual({ '1': green, '2': green })
    expect(now.outline).not.toBe(blue)
    expect(await marked('webdev-pins-done')).toEqual(['Line one'])
    expect(await marked('webdev-pins-open')).toEqual([])

    // Hovering the entry in the panel marks the target in its color.
    await panel.hover('[data-testid="item"][data-item-id] button')
    await sleep(200)
    now = await colors()
    expect(now.highlight).toBe(green)
    expect(now.label).toBe(green)
    await panel.mouse.move(0, 0)

    // Its popover marks it in its color too.
    const pin = await overlayCenter(session, '[data-testid="overlay-pin"]')
    await session.page.mouse.click(pin.x, pin.y)
    await waitInOverlay(session, POPOVER)
    expect((await colors()).marking).toBe(green)
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, POPOVER, false)

    // Reopen and Delete change the colors back without a reload.
    await panel.click('[aria-label="Reopen pin 1"]')
    await panel.click('[data-testid="filter-with-deleted"]')
    await panel.click('[aria-label="Delete pin 2"]')
    await sleep(300)
    const red = await badge(2)
    expect((await colors()).pins).toEqual({ '1': blue, '2': red })
    expect(await marked('webdev-pins-deleted')).toEqual(['Line one'])
    expect(await marked('webdev-pins-done')).toEqual([])
  })

  it('recolors the marking of an open popover when the panel changes its status', async () => {
    await markElement(session, '#row-1')
    await saveComment(1)
    await panel.click('[data-testid="filter-all"]')
    const pin = await overlayCenter(session, '[data-testid="overlay-pin"]')
    await session.page.mouse.click(pin.x, pin.y)
    await waitInOverlay(session, POPOVER)
    const realm = await contentRealm(session)
    const marking = () =>
      realm.evaluate(() => {
        const el = globalThis.__webdevOverlay?.shadow?.querySelector(
          '[data-testid="overlay-hover"]',
        )
        return el && getComputedStyle(el).outlineColor
      })
    const badge = () =>
      panel.$eval('[data-testid="item-number"]', (el) => getComputedStyle(el).backgroundColor)
    expect(await marking()).toBe(await badge())
    const blue = await badge()
    // Copied from its entry while the popover stays open: it is done now.
    await panel.click('[data-testid="item-copy"]')
    await panel.waitForSelector('[data-testid="item-reopen"]')
    await sleep(200)
    expect(await badge()).not.toBe(blue)
    expect(await marking()).toBe(await badge())
    await session.page.keyboard.press('Escape')
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
