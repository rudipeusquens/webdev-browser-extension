import type { Page } from 'puppeteer'
import { contentRealm, type Session } from './harness'

declare global {
  // Extension pages have `chrome`; this is the part the tests call inside them.
  var chrome: {
    storage: {
      local: { get(key: string): Promise<Record<string, unknown>>; clear(): Promise<void> }
    }
  }
}

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** Waits until the overlay is mounted in `s.page`. */
export async function overlayMounted(s: Session): Promise<void> {
  const realm = await contentRealm(s)
  const mounted = await realm.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      if (globalThis.__webdevOverlay?.shadow?.querySelector('[data-testid="overlay-root"]'))
        return true
      await new Promise((done) => setTimeout(done, 100))
    }
    return false
  })
  if (!mounted) throw new Error('overlay did not mount')
}

/** Text of the first element matching `selector` inside the overlay, or null. */
export async function overlayText(s: Session, selector: string): Promise<string | null> {
  const realm = await contentRealm(s)
  return realm.evaluate(
    (sel) => globalThis.__webdevOverlay?.shadow?.querySelector(sel)?.textContent ?? null,
    selector,
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

/** The stored collection, read through an extension page. */
export async function storedCollection(extensionPage: Page) {
  return extensionPage.evaluate(async () => {
    const { collection } = await chrome.storage.local.get('collection')
    return collection as
      { items: { id: string; number: number; comment: string; target: never }[] } | undefined
  })
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
