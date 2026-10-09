import type { Page } from 'puppeteer'
import { contentRealm, type Session } from './harness'

declare global {
  // Extension pages have `chrome`; this is the part the tests call inside them.
  var chrome: {
    storage: {
      local: {
        /** Every key without an argument. */
        get(key?: string | null): Promise<Record<string, unknown>>
        set(items: Record<string, unknown>): Promise<void>
        clear(): Promise<void>
      }
    }
    runtime: { sendMessage(message: unknown): Promise<unknown> }
  }
}

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** The overlay's host, once `overlayMounted` marked it: a plain div, found this way by tests. */
export const HOST = '[data-e2e-host]'

/**
 * Waits until the overlay is mounted in `s.page`, and marks its host for tests in the page's
 * world (`HOST`).
 */
export async function overlayMounted(s: Session): Promise<void> {
  const realm = await contentRealm(s)
  const mounted = await realm.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      const shadow = globalThis.__webdevOverlay?.shadow
      if (shadow?.querySelector('[data-testid="overlay-root"]')) {
        shadow.host.setAttribute('data-e2e-host', '')
        return true
      }
      await new Promise((done) => setTimeout(done, 100))
    }
    return false
  })
  if (!mounted) throw new Error('overlay did not mount')
}

/**
 * How many overlay hosts `s.page` holds, marked or not: the host is a div that is a manual
 * popover (top-layer.ts), which the fixtures that count hosts have none of their own. Counted
 * in the page's world: an isolated world that went with an earlier page would never answer.
 */
export function overlayHosts(s: Session): Promise<number> {
  return s.page.evaluate(() => document.querySelectorAll('div[popover="manual"]').length)
}

/** Text of the first element matching `selector` inside the overlay, or null. */
export async function overlayText(s: Session, selector: string): Promise<string | null> {
  const realm = await contentRealm(s)
  return realm.evaluate(
    (sel) => globalThis.__webdevOverlay?.shadow?.querySelector(sel)?.textContent ?? null,
    selector,
  )
}

/** The text in the comment popover's field, or '' without one. */
export async function contentField(s: Session): Promise<string> {
  const realm = await contentRealm(s)
  return realm.evaluate(
    () =>
      (globalThis.__webdevOverlay?.shadow?.querySelector('textarea') as HTMLTextAreaElement | null)
        ?.value ?? '',
  )
}

/** Waits until `selector` exists (or not) inside the overlay. */
export async function waitInOverlay(s: Session, selector: string, present = true) {
  const realm = await contentRealm(s)
  const ok = await realm.evaluate(
    async (sel, want) => {
      for (let i = 0; i < 50; i++) {
        if (!!globalThis.__webdevOverlay?.shadow?.querySelector(sel) === want) return true
        await new Promise((done) => setTimeout(done, 100))
      }
      return false
    },
    selector,
    present,
  )
  if (!ok) throw new Error(`${selector} did not ${present ? 'appear' : 'go away'}`)
}

/** Center of the first page element matching `selector`, in viewport coordinates. */
export async function centerOf(page: Page, selector: string) {
  return page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
}

export interface StoredItem {
  id: string
  number: number
  comment: string
  status: 'open' | 'done' | 'deleted'
  pageKey: string
  target: never
  draft?: true
}

/**
 * The stored collections of every site, read through an extension page, as one; undefined
 * while there are none. With `site`, that site's collection only.
 */
export async function storedCollection(extensionPage: Page, site?: string) {
  return extensionPage.evaluate(async (only) => {
    const all = await chrome.storage.local.get()
    const sites = Object.entries(all)
      .filter(([key]) => key.startsWith('collection:') && (!only || key === `collection:${only}`))
      .map(
        ([, value]) =>
          value as {
            site: string
            nextNumber: number
            pages: Record<string, unknown>
            items: StoredItem[]
            lastCopy: string[]
          },
      )
    if (sites.length === 0) return undefined
    // One site: its collection as stored. Several: their items, pages and copies together.
    return {
      version: 2,
      site: sites[0]?.site,
      nextNumber: Math.max(...sites.map((c) => c.nextNumber)),
      pages: Object.assign({}, ...sites.map((c) => c.pages)) as Record<string, unknown>,
      items: sites.flatMap((c) => c.items),
      lastCopy: sites.flatMap((c) => c.lastCopy),
    }
  }, site ?? null)
}

/** Polls until the stored collection holds `count` items. */
export async function waitForItems(extensionPage: Page, count: number) {
  for (let i = 0; i < 50; i++) {
    const c = await storedCollection(extensionPage)
    if ((c?.items.length ?? 0) === count) return c
    await sleep(100)
  }
  throw new Error(`collection never reached ${count} items`)
}

/** Element mode, hover `selector`, click it: the comment popover opens. */
export async function markElement(s: Session, selector: string) {
  await s.page.keyboard.press('e')
  await waitInOverlay(s, '[data-testid="overlay-glass"]')
  const { x, y } = await centerOf(s.page, selector)
  await s.page.mouse.move(x, y)
  await s.page.mouse.click(x, y)
  await waitInOverlay(s, '[data-testid="overlay-popover"]')
}

/** Center of the first element matching `selector` inside the overlay, once it is there. */
export async function overlayCenter(s: Session, selector: string) {
  await waitInOverlay(s, selector)
  // Let positions settle after the element appeared.
  await sleep(100)
  const realm = await contentRealm(s)
  const center = await realm.evaluate((sel) => {
    const r = globalThis.__webdevOverlay?.shadow?.querySelector(sel)?.getBoundingClientRect()
    return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, selector)
  if (!center) throw new Error(`${selector} has no box`)
  return center
}

/**
 * A real click on an element inside the overlay, once the popover's buttons act: the browser
 * has reported nothing of the page over it (up to a second; a covered popover stays covered).
 */
export async function clickInOverlay(s: Session, selector: string) {
  const { x, y } = await overlayCenter(s, selector)
  const realm = await contentRealm(s)
  await realm.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      if (!globalThis.__webdevOverlay?.shadow?.querySelector('[data-covered]')) return
      await new Promise((done) => setTimeout(done, 100))
    }
  })
  await s.page.mouse.click(x, y)
}

/** Viewport points just inside the first and last character of `needle` in `selector`. */
export async function textEnds(page: Page, selector: string, needle: string) {
  return page.$eval(
    selector,
    (el, text) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = (node as Text).data.indexOf(text)
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + 1)
        const first = range.getBoundingClientRect()
        range.setStart(node, at + text.length - 1)
        range.setEnd(node, at + text.length)
        const last = range.getBoundingClientRect()
        return {
          start: { x: first.left + 1, y: first.top + first.height / 2 },
          end: { x: last.right - 1, y: last.top + last.height / 2 },
        }
      }
      throw new Error(`no text ${text}`)
    },
    needle,
  )
}

/** Selects `needle` inside `selector` by dragging the mouse across it. */
export async function dragSelect(page: Page, selector: string, needle: string) {
  const { start, end } = await textEnds(page, selector, needle)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
}
