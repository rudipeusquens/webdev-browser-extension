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

/** A site's collection with one open pin on each of `paths`, as the background stores it. */
function collectionOf(origin: string, paths: string[]) {
  const pages = Object.fromEntries(
    paths.map((path) => [
      `${origin}${path}`,
      {
        url: `${origin}${path}`,
        title: 'Plain',
        viewport: { width: 1280, height: 800 },
        colorScheme: 'light',
      },
    ]),
  )
  const items = paths.map((path, i) => ({
    id: `pin${i + 1}`,
    number: i + 1,
    pageKey: `${origin}${path}`,
    comment: `Pin on ${path}`,
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    status: 'open',
    target: {
      kind: 'element',
      element: {
        selector: 'h1',
        openingTag: '<h1>',
        text: 'Plain page',
        box: { x: 0, y: 0, width: 100, height: 40 },
        styles: {},
      },
    },
  }))
  return { version: 2, site: origin, nextNumber: paths.length + 1, pages, items, lastCopy: [] }
}

type Box = { top: number; right: number; bottom: number; left: number; width: number }

/** The border box of `selector` in the panel. */
async function boxOf(panel: Page, selector: string): Promise<Box> {
  const box = await panel.$eval(selector, (el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width }
  })
  return box
}

describe("the panel's layout", () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
    await session.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(session)
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('puts the site in the middle of the title row', async () => {
    await panel.waitForSelector('[data-testid="site-pill"][data-state="active"]')
    const row = await boxOf(panel, '[data-testid="title-row"]')
    const pill = await boxOf(panel, '[data-testid="site-pill"]')
    expect(Math.abs((pill.left + pill.right) / 2 - (row.left + row.right) / 2)).toBeLessThan(1)
    const undo = await boxOf(panel, '[data-testid="undo"]')
    expect(pill.right).toBeLessThan(undo.left)
  })

  it('centers an empty state in the list area', async () => {
    await panel.waitForSelector('[data-testid="empty-state"]')
    const list = await boxOf(panel, '[data-testid="list-area"]')
    const empty = await boxOf(panel, '[data-testid="empty-state"]')
    expect(Math.abs((empty.top + empty.bottom) / 2 - (list.top + list.bottom) / 2)).toBeLessThan(2)
    expect(Math.abs((empty.left + empty.right) / 2 - (list.left + list.right) / 2)).toBeLessThan(2)
  })

  it('fills the row with the modes and Pins, 8 px between Area and Pins', async () => {
    const header = await boxOf(panel, 'header')
    const buttons = await Promise.all(
      ['mode-browse', 'mode-element', 'mode-area', 'toggle-pins'].map((id) =>
        boxOf(panel, `[data-testid="${id}"]`),
      ),
    )
    const [browse, , area, pins] = buttons as [Box, Box, Box, Box]
    const filter = await boxOf(panel, '[data-testid="filter-open"]')
    // The same edges as the filter below, which fills the row.
    expect(browse.left).toBeCloseTo(filter.left, 0)
    expect(pins.right).toBeCloseTo(header.right - (filter.left - header.left), 0)
    expect(pins.left - area.right).toBeCloseTo(8, 0)
    // The modes share the rest of the row; joined toggles share borders, so the first one is
    // a pixel wider.
    for (const b of buttons.slice(0, 3)) {
      expect(Math.abs(b.width - browse.width)).toBeLessThanOrEqual(1.5)
    }
  })

  it('pads the footer the same below its buttons as at its sides', async () => {
    const footer = await boxOf(panel, 'footer')
    const clear = await boxOf(panel, '[data-testid="clear-all"]')
    const copy = await boxOf(panel, '[data-testid="copy-prompt"]')
    expect(footer.bottom - clear.bottom).toBeCloseTo(copy.left - footer.left, 0)
  })

  it('shows thin scrollbars in the border color', async () => {
    const style = await panel.$eval('[data-testid="list-area"]', (el) => {
      const s = getComputedStyle(el)
      return { width: s.scrollbarWidth, color: s.scrollbarColor }
    })
    expect(style.width).toBe('thin')
    expect(style.color).not.toBe('auto')
  })

  it('separates the pages of the list', async () => {
    await panel.evaluate(
      async (key, value) => chrome.storage.local.set({ [key]: value }),
      `collection:${server.origin}`,
      collectionOf(server.origin, ['/plain/', '/plain/text.html']),
    )
    await panel.waitForSelector('[data-testid="page-group"] + [data-testid="page-group"]')
    const gap = await panel.evaluate(() => {
      const [first, second] = document.querySelectorAll('[data-testid="page-group"]')
      const last = first?.querySelector('[data-testid="item"]:last-child')?.getBoundingClientRect()
      const heading = second?.querySelector('h2')
      const border = heading && getComputedStyle(second as Element).borderTopWidth
      return { space: (heading?.getBoundingClientRect().top ?? 0) - (last?.bottom ?? 0), border }
    })
    expect(gap.space).toBeGreaterThanOrEqual(16)
    expect(gap.border).toBe('1px')
  })

  it('leaves room between the sections of Settings', async () => {
    await panel.click('[data-testid="open-settings"]')
    await panel.waitForSelector('[data-testid="shortcut-list"]')
    const gaps = await panel.evaluate(() => {
      const sections = [...document.querySelectorAll('[data-testid="settings"] > *')]
      return sections.slice(1).map((section, i) => {
        const before = sections[i]?.lastElementChild?.getBoundingClientRect().bottom ?? 0
        return (section.firstElementChild?.getBoundingClientRect().top ?? 0) - before
      })
    })
    expect(gaps.length).toBeGreaterThanOrEqual(2)
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(40)
    await panel.click('[data-testid="close-settings"]')
  })
})
