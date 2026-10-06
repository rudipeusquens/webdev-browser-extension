import type { Page } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import {
  markElement,
  overlayMounted,
  sleep,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

// Milestone 6 acceptance: the review loop of spec section 2, on two sites at once.
describe('the review loop', () => {
  let one: Awaited<ReturnType<typeof startFixtureServer>>
  let two: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    one = await startFixtureServer()
    two = await startFixtureServer()
    session = await launch()
    await session.browser
      .defaultBrowserContext()
      .overridePermissions(`chrome-extension://${session.extensionId}`, [
        'clipboard-read',
        'clipboard-sanitized-write',
      ])
  })

  afterAll(async () => {
    await session?.browser.close()
    await one?.close()
    await two?.close()
  })

  async function save(selector: string, comment: string) {
    await markElement(session, selector)
    await session.page.keyboard.type(comment)
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, '[data-testid="overlay-popover"]', false)
  }

  const clipboard = () => panel.evaluate(() => navigator.clipboard.readText())
  const statuses = async (site: string) =>
    ((await storedCollection(panel, site))?.items ?? []).map((i) => [i.number, i.status])

  async function until(check: () => Promise<boolean>, what: string) {
    for (let i = 0; i < 50; i++) {
      if (await check()) return
      await sleep(100)
    }
    throw new Error(`never: ${what}`)
  }

  async function copy(button: 'copy-prompt' | 'copy-again', status: string) {
    await panel.click(`[data-testid="${button}"]`)
    await panel.waitForSelector(`[data-testid="copy-status"] ::-p-text(${status})`)
    return clipboard()
  }

  it(
    'copies, marks done, copies again, undoes, deletes, restores, clears per site',
    {
      timeout: 30_000,
    },
    async () => {
      // The second site gets an item first; it must stay untouched.
      await session.page.goto(`${two.origin}/plain/`)
      panel = await clickAction(session)
      await overlayMounted(session)
      await save('h1', 'On the other project')
      await waitForItems(panel, 1)

      await session.page.goto(`${one.origin}/plain/`)
      panel = await clickAction(session)
      await overlayMounted(session)
      await save('h1', 'Bigger heading')
      await save('button[type="submit"]', 'Wider button')
      await save('p', 'Shorter text')
      await until(async () => (await statuses(one.origin)).length === 3, 'three items')

      let text = await copy('copy-prompt', 'Copied 3 pins')
      expect(text).toContain('# UI feedback: 3 items on 1 page')
      expect(text).not.toContain('On the other project')
      await until(
        async () => (await statuses(one.origin)).every(([, s]) => s === 'done'),
        'all done',
      )

      await save('h1', 'Heading still too small')
      text = await copy('copy-prompt', 'Copied 1 pin')
      expect(text).toContain('# UI feedback: 1 item on 1 page')
      expect(text).toContain('### 4. Element')
      expect(text).not.toContain('Bigger heading')
      text = await copy('copy-again', 'Copied 1 pin again')
      expect(text).toContain('Heading still too small')

      await panel.click('[data-testid="undo"]')
      await until(async () => (await statuses(one.origin)).at(-1)?.[1] === 'open', 'item 4 open')
      await panel.click('[data-testid="redo"]')
      await until(async () => (await statuses(one.origin)).at(-1)?.[1] === 'done', 'item 4 done')

      // Delete item 4 from its popover: its pin shows with the filter All.
      await panel.click('[data-testid="filter-all"]')
      await waitInOverlay(session, '[data-testid="overlay-pin"]')
      const realm = await contentRealm(session)
      const centerOf = (selector: string) =>
        realm.evaluate((sel) => {
          const found = [...(globalThis.__webdevOverlay?.shadow?.querySelectorAll(sel) ?? [])].find(
            (el) => el.textContent?.trim() === '4' || sel.includes('delete'),
          )
          const r = found?.getBoundingClientRect()
          return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }, selector)
      let at = await centerOf('[data-testid="overlay-pin"]')
      await session.page.mouse.click(at?.x ?? 0, at?.y ?? 0)
      await waitInOverlay(session, '[data-testid="overlay-delete"]')
      at = await centerOf('[data-testid="overlay-delete"]')
      await session.page.mouse.click(at?.x ?? 0, at?.y ?? 0)
      await until(async () => (await statuses(one.origin)).at(-1)?.[1] === 'deleted', 'deleted')

      await panel.click('[data-testid="filter-with-deleted"]')
      await panel.waitForSelector('[aria-label="Restore pin 4"]')
      await panel.click('[aria-label="Restore pin 4"]')
      await until(async () => (await statuses(one.origin)).at(-1)?.[1] === 'open', 'restored')
      await panel.click('[data-testid="filter-open"]')

      // One pin on its own, from its entry: it becomes done, and Copy again copies it.
      await panel.click('[data-testid="item-copy"][aria-label="Copy pin 4"]')
      await panel.waitForSelector('[data-testid="copy-status"] ::-p-text(Copied pin 4)')
      text = await clipboard()
      expect(text).toContain('Heading still too small')
      expect(text).toContain('# UI feedback: 1 item on 1 page')
      await until(async () => (await statuses(one.origin)).at(-1)?.[1] === 'done', 'pin 4 done')
      text = await copy('copy-again', 'Copied 1 pin again')
      expect(text).toContain('Heading still too small')

      // Clear all moves everything to Deleted, on this site only; Undo brings it back.
      await panel.click('[data-testid="clear-all"]')
      await panel.waitForSelector('[data-testid="copy-status"] ::-p-text(Moved 4 pins to Deleted)')
      await until(
        async () => (await statuses(one.origin)).every(([, s]) => s === 'deleted'),
        'all deleted',
      )
      expect(await statuses(two.origin)).toEqual([[1, 'open']])
      expect(await panel.$('[data-testid="copy-again"][disabled]')).not.toBeNull()
      await (await panel.waitForSelector('[data-testid="undo"][title^="Undo: Clear all"]'))?.click()
      await until(async () => (await statuses(one.origin)).every(([, s]) => s === 'done'), 'undone')
      await (await panel.waitForSelector('[data-testid="redo"][title^="Redo: Clear all"]'))?.click()

      // Only deleted pins left: the bin empties for good after a confirmation; Undo again.
      await (await panel.waitForSelector('[data-testid="empty-bin"]'))?.click()
      await (await panel.waitForSelector('[data-testid="empty-bin-confirm"]'))?.click()
      await until(async () => (await statuses(one.origin)).length === 0, 'emptied')
      expect(await statuses(two.origin)).toEqual([[1, 'open']])
      const undo = await panel.waitForSelector('[data-testid="undo"][title^="Undo: Empty bin"]')
      await panel.waitForFunction(() => !document.querySelector('[role="alertdialog"]'))
      await undo?.click()
      await until(async () => (await statuses(one.origin)).length === 4, 'empty bin undone')
    },
  )
})
