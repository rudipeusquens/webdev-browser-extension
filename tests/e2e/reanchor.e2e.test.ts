import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Collection } from '../../src/lib/collection/model'
import { formatCollection } from '../../src/lib/format/markdown'
import {
  clickAction,
  contentRealm,
  launch,
  type Session,
  startFixtureServer,
  startVueDevServer,
} from './harness'
import {
  clickInOverlay,
  dragSelect,
  markElement,
  overlayMounted,
  sleep,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const POPOVER = '[data-testid="overlay-popover"]'
const PIN = '[data-testid="overlay-pin"]'
const NOT_FOUND = '[data-testid="not-found"]'

/** Top-left corners of the overlay's pins, by item number. */
async function pins(session: Session): Promise<Map<number, { x: number; y: number }>> {
  const realm = await contentRealm(session)
  const list = await realm.evaluate((sel) => {
    const found = globalThis.__webdevOverlay?.shadow?.querySelectorAll<HTMLElement>(sel) ?? []
    return [...found].map((pin) => {
      const r = pin.getBoundingClientRect()
      return { n: Number(pin.textContent), x: r.x, y: r.y }
    })
  }, PIN)
  return new Map(list.map(({ n, x, y }) => [n, { x, y }]))
}

async function waitForPins(session: Session, count: number) {
  for (let i = 0; i < 40; i++) {
    const now = await pins(session)
    if (now.size === count) return now
    await sleep(100)
  }
  throw new Error(`pins never reached ${count}`)
}

/** Where a pin goes for a target box: centered on its top-right corner, kept 4 px inside an
 * 800×600 viewport (pins.ts, Puppeteer's default viewport). */
const pinFor = (r: { right: number; top: number }) => ({
  x: Math.max(4, Math.min(r.right - 10, 800 - 24)),
  y: Math.max(4, Math.min(r.top - 10, 600 - 24)),
})

const near = (a: { x: number; y: number }, b: { x: number; y: number }, by = 3) =>
  Math.abs(a.x - b.x) <= by && Math.abs(a.y - b.y) <= by

async function comment(session: Session, text: string) {
  await waitInOverlay(session, POPOVER)
  await session.page.keyboard.type(text)
  await session.page.keyboard.press('Enter')
  await waitInOverlay(session, POPOVER, false)
}

describe('re-anchoring after a reload', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/plain/text.html`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  /** Viewport box of `needle` inside `selector`, the `nth` time it occurs. */
  const textBox = (selector: string, needle: string, nth = 0) =>
    session.page.$eval(
      selector,
      (el, [text, n]) => {
        const node = el.firstChild as Text
        let at = -1
        for (let i = 0; i <= (n as number); i++) at = node.data.indexOf(text as string, at + 1)
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + (text as string).length)
        const r = range.getBoundingClientRect()
        return { right: r.right, top: r.top }
      },
      [needle, nth] as const,
    )

  const elementBox = (selector: string) =>
    session.page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect()
      return { right: r.right, top: r.top }
    })

  async function reactivate() {
    await session.page.reload()
    panel = await clickAction(session)
    await overlayMounted(session)
  }

  it('puts every pin back at its target, the text pin at the selection', async () => {
    await markElement(session, 'h1')
    await comment(session, 'Element')
    await session.page.keyboard.press('Escape')
    await dragSelect(session.page, '#intro', 'contact you')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await comment(session, 'Text')
    await session.page.keyboard.press('a')
    const h3 = await session.page.$eval('h3', (el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    })
    await session.page.mouse.move(h3.left + 2, h3.top + 2)
    await session.page.mouse.down()
    await session.page.mouse.move(h3.left + 120, h3.bottom - 2, { steps: 8 })
    await session.page.mouse.up()
    await comment(session, 'Area')
    await waitForItems(panel, 3)
    await session.page.keyboard.press('Escape')

    await reactivate()
    const placed = await waitForPins(session, 3)
    expect(near(placed.get(1) as never, pinFor(await elementBox('h1')))).toBe(true)
    // At the selection, not at the right edge of the paragraph that holds it, and right away.
    expect(near(placed.get(2) as never, pinFor(await textBox('#intro', 'contact you')))).toBe(true)
    expect(near(placed.get(3) as never, { x: h3.left + 2 + 118 - 10, y: h3.top + 2 - 10 }, 4)).toBe(
      true,
    )
  })

  it('moves the text pin to the occurrence whose context fits (review focus 3)', async () => {
    await dragSelect(session.page, '#intro', 'contact you')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await comment(session, 'Text')
    await waitForItems(panel, 1)
    await reactivate()
    await waitForPins(session, 1)
    await session.page.evaluate(() => {
      const intro = document.getElementById('intro') as HTMLElement
      intro.textContent = `We may contact you rarely. ${intro.textContent}`
    })
    const second = pinFor(await textBox('#intro', 'contact you', 1))
    let at: { x: number; y: number } | undefined
    for (let i = 0; i < 30; i++) {
      at = (await pins(session)).get(1)
      if (at && near(at, second)) break
      await sleep(100)
    }
    expect(at && near(at, second)).toBe(true)
  })

  it('marks an item whose target went away as not found, and clears the mark when it is back', async () => {
    await markElement(session, '#before-form')
    await comment(session, 'Paragraph')
    await waitForItems(panel, 1)
    await session.page.evaluate(() => {
      const p = document.getElementById('before-form') as HTMLElement
      ;(window as unknown as { parked: HTMLElement }).parked = p
      p.remove()
    })
    await panel.waitForSelector(NOT_FOUND, { timeout: 5000 })
    const prompt = formatCollection((await storedCollection(panel)) as unknown as Collection, {
      missing: new Set(
        await panel.evaluate(async () => {
          const { missing } = await (
            chrome.storage as unknown as {
              session: { get(key: string): Promise<{ missing?: string[] }> }
            }
          ).session.get('missing')
          return missing ?? []
        }),
      ),
    })
    expect(prompt).toContain(
      '(not found when the page was last open; data from when it was marked)',
    )
    await session.page.evaluate(() => {
      document.body.prepend((window as unknown as { parked: HTMLElement }).parked)
    })
    await panel.waitForSelector(NOT_FOUND, { hidden: true, timeout: 5000 })
  })
})

describe('re-anchoring on a page that changes all the time (review focus 2)', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('keeps its pins without flapping or long frames', async () => {
    await session.page.goto(`${server.origin}/plain/busy.html`)
    const panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    await markElement(session, 'h1')
    await comment(session, 'Title')
    await session.page.keyboard.press('Escape')
    await dragSelect(session.page, '#intro', 'contact you')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await comment(session, 'Text')
    await waitForItems(panel, 2)
    await session.page.evaluate(() => {
      const w = window as unknown as { longFrames: number }
      w.longFrames = 0
      new PerformanceObserver((list) => {
        w.longFrames += list.getEntries().filter((e) => e.duration > 50).length
      }).observe({ type: 'long-animation-frame' })
    })
    for (let i = 0; i < 30; i++) {
      expect(await panel.$(NOT_FOUND)).toBeNull()
      expect((await pins(session)).size).toBe(2)
      await sleep(100)
    }
    const longFrames = await session.page.evaluate(
      () => (window as unknown as { longFrames: number }).longFrames,
    )
    expect(longFrames).toBeLessThanOrEqual(3)
  })
})

describe('re-anchoring text that is gone, inside one huge text node (review focus 2)', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('keeps searching cheap while the page keeps changing', async () => {
    await session.page.goto(`${server.origin}/plain/busy.html`)
    const panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    await dragSelect(session.page, '#log', 'First entry')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await comment(session, 'Log text')
    await waitForItems(panel, 1)
    // The selected words go away; the log stays megabytes long.
    await session.page.evaluate(() => {
      const log = document.getElementById('log') as HTMLElement
      log.textContent = (log.textContent ?? '').replace('First entry', 'Opening line')
    })
    await sleep(500)
    await session.page.evaluate(() => {
      const w = window as unknown as { longFrames: number }
      w.longFrames = 0
      new PerformanceObserver((list) => {
        w.longFrames += list.getEntries().filter((e) => e.duration > 50).length
      }).observe({ type: 'long-animation-frame' })
    })
    await sleep(3000)
    const longFrames = await session.page.evaluate(
      () => (window as unknown as { longFrames: number }).longFrames,
    )
    expect(longFrames).toBeLessThanOrEqual(2)
  })
})

describe('re-anchoring after HMR', () => {
  let app: Awaited<ReturnType<typeof startVueDevServer>>
  let session: Session

  beforeAll(async () => {
    app = await startVueDevServer()
    session = await launch()
  })

  afterAll(async () => {
    await session?.browser.close()
    await app?.close()
  })

  it('finds a re-rendered element again', async () => {
    await session.page.goto(`${app.origin}/settings`)
    await session.page.waitForSelector('#profile button')
    const panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    await markElement(session, '#profile button')
    await comment(session, 'Full width')
    await waitForItems(panel, 1)
    await waitForPins(session, 1)
    await session.page.evaluate(() => {
      ;(document.querySelector('#profile button') as HTMLElement).dataset.old = 'yes'
    })
    // A change to the script makes Vite re-mount the component: new elements.
    const file = 'src/components/ProfileForm.vue'
    await app.write(file, (await app.read(file)).replace('() => undefined', '() => null'))
    await session.page.waitForFunction(
      () => !(document.querySelector('#profile button') as HTMLElement | null)?.dataset.old,
      { timeout: 10_000 },
    )
    const button = await session.page.$eval('#profile button', (el) => {
      const r = el.getBoundingClientRect()
      return { right: r.right, top: r.top }
    })
    let at: { x: number; y: number } | undefined
    for (let i = 0; i < 20; i++) {
      at = (await pins(session)).get(1)
      if (at && near(at, pinFor(button))) break
      await sleep(100)
    }
    expect(at && near(at, pinFor(button))).toBe(true)
    await sleep(2000)
    expect(await panel.$(NOT_FOUND)).toBeNull()
  })
})

describe('an overlay whose extension was reloaded', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('removes itself', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    await clickAction(session)
    await overlayMounted(session)
    expect(
      await session.page.evaluate(() => document.querySelectorAll('webdev-overlay').length),
    ).toBe(1)
    const worker = await (
      await session.browser.waitForTarget(
        (t) => t.type() === 'service_worker' && t.url().includes(session.extensionId),
      )
    ).worker()
    await worker
      ?.evaluate(() =>
        (
          globalThis as unknown as { chrome: { runtime: { reload(): void } } }
        ).chrome.runtime.reload(),
      )
      .catch(() => undefined)
    await session.page.waitForFunction(
      () => document.querySelectorAll('webdev-overlay').length === 0,
      {
        timeout: 4000,
      },
    )
  })
})
