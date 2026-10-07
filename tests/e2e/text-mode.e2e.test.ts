import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Collection, TextTarget } from '../../src/lib/collection/model'
import { formatCollection } from '../../src/lib/format/markdown'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import {
  centerOf,
  clickInOverlay,
  dragSelect,
  overlayMounted,
  sleep,
  storedCollection,
  textEnds,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const CHIP = '[data-testid="overlay-chip"]'
const POPOVER = '[data-testid="overlay-popover"]'
const HIGHLIGHT = '[data-testid="overlay-text-highlight"]'

describe('marking text', () => {
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
    await session.page.goto(`${server.origin}/plain/text.html`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  /** Whether `selector` is in the overlay right now. */
  async function inOverlay(selector: string) {
    const realm = await contentRealm(session)
    return realm.evaluate(
      (sel) => !!globalThis.__webdevOverlay?.shadow?.querySelector(sel),
      selector,
    )
  }

  /** The chip does not show up, also not a moment later. */
  async function expectNoChip() {
    await sleep(400)
    expect(await inOverlay(CHIP)).toBe(false)
  }

  async function comment(text: string) {
    await clickInOverlay(session, CHIP)
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.type(text)
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, POPOVER, false)
  }

  const textTarget = async (n = 1) => {
    const stored = (await waitForItems(panel, n)) as unknown as Collection
    return stored.items[n - 1]?.target as TextTarget
  }

  it('comments on a selection and copies it with its context', async () => {
    await dragSelect(session.page, 'h3', 'Email notifcations')
    await clickInOverlay(session, CHIP)
    await waitInOverlay(session, POPOVER)
    expect(await inOverlay(HIGHLIGHT)).toBe(true)
    await session.page.keyboard.type('Typo, should be notifications.')
    await session.page.keyboard.press('Enter')

    const target = await textTarget()
    expect(target).toMatchObject({
      kind: 'text',
      selected: 'Email notifcations',
      before: 'Manage your ',
      after: ' and alerts',
    })
    const matches = await session.page.$$eval(target.container.selector, (els) =>
      els.map((el) => el.localName),
    )
    expect(matches).toEqual(['h3'])
    expect(await inOverlay(CHIP)).toBe(false)
    expect(await inOverlay(HIGHLIGHT)).toBe(false)

    await panel.waitForSelector('[data-testid="item"] ::-p-text(Typo, should be)')
    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('::-p-text(Copied 1 pin)')
    const clipboard = await panel.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(
      formatCollection((await storedCollection(panel)) as unknown as Collection),
    )
    expect(clipboard).toContain('### 1. Text\n\n> Typo, should be notifications.\n')
    expect(clipboard).toContain('- Context: "Manage your **Email notifcations** and alerts"')
  })

  it('puts a pin at the selection that opens the comment again', async () => {
    await dragSelect(session.page, '#intro', 'contact you')
    await comment('Friendlier wording')
    await clickInOverlay(session, '[data-testid="overlay-pin"]')
    await waitInOverlay(session, POPOVER)
    const realm = await contentRealm(session)
    const value = await realm.evaluate(
      () =>
        (
          globalThis.__webdevOverlay?.shadow?.querySelector(
            '[data-testid="overlay-comment"]',
          ) as HTMLTextAreaElement | null
        )?.value,
    )
    expect(value).toBe('Friendlier wording')
    expect(await inOverlay(HIGHLIGHT)).toBe(true)
  })

  it('saves what was selected although the page replaces it meanwhile', async () => {
    await dragSelect(session.page, '#intro', 'contact you')
    await clickInOverlay(session, CHIP)
    await waitInOverlay(session, POPOVER)
    await session.page.evaluate(() => {
      const intro = document.getElementById('intro') as HTMLElement
      intro.innerHTML = '<em>Replaced by the page</em>'
    })
    await session.page.keyboard.type('Still saved')
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, POPOVER, false)
    const target = await textTarget()
    expect(target.selected).toBe('contact you')
    expect(target.before).toBe('Choose how often we ')
  })

  it('never captures form field values (review focus 1)', async () => {
    await session.page.type('#token', 'SECRET-VALUE')
    const field = await session.page.$eval('#token', (el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left + 4, right: r.right - 4, y: r.top + r.height / 2 }
    })
    await session.page.mouse.move(field.left, field.y)
    await session.page.mouse.down()
    await session.page.mouse.move(field.right, field.y, { steps: 6 })
    await session.page.mouse.up()
    await expectNoChip()

    const draft = await centerOf(session.page, '#draft')
    await session.page.mouse.click(draft.x, draft.y, { count: 2 })
    await expectNoChip()

    const from = await textEnds(session.page, '#before-form', 'Before')
    const to = await textEnds(session.page, '#after-form', 'here.')
    await session.page.mouse.move(from.start.x, from.start.y)
    await session.page.mouse.down()
    await session.page.mouse.move(to.end.x, to.end.y, { steps: 10 })
    await session.page.mouse.up()
    await comment('Across the form')

    const target = await textTarget()
    expect(target.selected.startsWith('Before the form')).toBe(true)
    expect(target.selected.endsWith('ends here.')).toBe(true)
    const stored = JSON.stringify(await storedCollection(panel))
    for (const secret of ['SECRET-VALUE', 'Draft text', 'Option one', 'Option two']) {
      expect(stored).not.toContain(secret)
    }
  })

  it('leaves out text the page does not show or lets select', async () => {
    const from = await textEnds(session.page, '#hidden', 'Visible')
    const to = await textEnds(session.page, '#hidden', 'end')
    await session.page.mouse.move(from.start.x, from.start.y)
    await session.page.mouse.down()
    await session.page.mouse.move(to.end.x, to.end.y, { steps: 8 })
    await session.page.mouse.up()
    await comment('Hidden parts')
    expect((await textTarget()).selected).toBe('Visible start visible end')
  })

  it('shows no chip for a selection the page makes', async () => {
    await session.page.evaluate(() => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('intro') as HTMLElement)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      for (const type of ['pointerup', 'mouseup', 'keyup']) {
        document.dispatchEvent(new Event(type, { bubbles: true }))
      }
    })
    await expectNoChip()
  })

  it('captures only the selection the chip was offered for (review focus 3)', async () => {
    await dragSelect(session.page, '#intro', 'contact you')
    await waitInOverlay(session, CHIP)
    // The page swaps the selection on the way to the chip's click.
    await session.page.evaluate(() => {
      window.addEventListener(
        'click',
        () => {
          const range = document.createRange()
          range.selectNodeContents(document.getElementById('words') as HTMLElement)
          const selection = document.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
        },
        true,
      )
    })
    await clickInOverlay(session, CHIP)
    await sleep(400)
    expect(await inOverlay(POPOVER)).toBe(false)
    expect((await storedCollection(panel))?.items.length ?? 0).toBe(0)
  })

  it('offers the chip after a double-click and forgets it when the selection goes', async () => {
    const { start } = await textEnds(session.page, '#words', 'onewordhere')
    await session.page.mouse.click(start.x + 6, start.y, { count: 2 })
    await waitInOverlay(session, CHIP)
    await session.page.mouse.click(5, 5)
    await waitInOverlay(session, CHIP, false)

    await session.page.mouse.click(start.x + 6, start.y, { count: 2 })
    await clickInOverlay(session, CHIP)
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.press('Escape')
    await waitInOverlay(session, POPOVER, false)
    expect(await inOverlay(HIGHLIGHT)).toBe(false)
    expect((await storedCollection(panel))?.items.length ?? 0).toBe(0)
  })

  it('keeps the chip off in element mode', async () => {
    await dragSelect(session.page, 'h3', 'Email')
    await waitInOverlay(session, CHIP)
    await session.page.keyboard.press('e')
    await waitInOverlay(session, CHIP, false)
  })

  it('records an element without the options of a select inside it', async () => {
    await session.page.keyboard.press('e')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    const { x, y } = await centerOf(session.page, '#plan')
    await session.page.mouse.move(x, y)
    await session.page.keyboard.press('ArrowUp')
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.type('The form')
    await session.page.keyboard.press('Enter')
    const stored = (await waitForItems(panel, 1)) as unknown as Collection
    const target = stored.items[0]?.target
    expect(target?.kind === 'element' && target.element.openingTag).toContain('<form id="details"')
    expect(JSON.stringify(stored)).not.toContain('Option')
  })
})

describe('marking text on a huge page', () => {
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

  it('stays quick when everything is selected', async () => {
    await session.page.goto(`${server.origin}/plain/big.html`)
    const panel = await clickAction(session)
    await overlayMounted(session)
    await session.page.click('h1')
    await session.page.keyboard.down('Control')
    await session.page.keyboard.press('a')
    await session.page.keyboard.up('Control')
    await waitInOverlay(session, CHIP)
    const started = Date.now()
    await clickInOverlay(session, CHIP)
    await waitInOverlay(session, POPOVER)
    expect(Date.now() - started).toBeLessThan(1500)
    await session.page.keyboard.type('Everything')
    await session.page.keyboard.press('Enter')
    const stored = (await waitForItems(panel, 1)) as unknown as Collection
    const target = stored.items[0]?.target as TextTarget
    expect([...target.selected]).toHaveLength(500)
    expect(target.selected.endsWith('…')).toBe(true)
  })

  it('keeps scrolling smooth while a huge selection is offered and commented', async () => {
    await session.page.goto(`${server.origin}/plain/big.html`)
    await clickAction(session)
    await overlayMounted(session)
    await session.page.click('h1')
    await session.page.keyboard.down('Control')
    await session.page.keyboard.press('a')
    await session.page.keyboard.up('Control')
    await waitInOverlay(session, CHIP)

    /** Long animation frames (over 50 ms) while the page scrolls. */
    const longFramesWhileScrolling = async () => {
      await session.page.evaluate(() => {
        const w = window as unknown as { longFrames: number }
        w.longFrames = 0
        new PerformanceObserver((list) => {
          w.longFrames += list.getEntries().filter((e) => e.duration > 50).length
        }).observe({ type: 'long-animation-frame' })
      })
      for (let i = 0; i < 20; i++) {
        await session.page.evaluate(() => window.scrollBy(0, 40))
        await sleep(30)
      }
      await sleep(200)
      return session.page.evaluate(() => (window as unknown as { longFrames: number }).longFrames)
    }

    expect(await longFramesWhileScrolling()).toBeLessThanOrEqual(2)
    await clickInOverlay(session, CHIP)
    await waitInOverlay(session, POPOVER)
    expect(await longFramesWhileScrolling()).toBeLessThanOrEqual(2)
  })
})
