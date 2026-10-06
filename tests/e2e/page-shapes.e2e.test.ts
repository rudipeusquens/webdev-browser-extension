import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type {
  AreaTarget,
  Collection,
  ElementTarget,
  Target,
  TextTarget,
} from '../../src/lib/collection/model'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import {
  centerOf,
  clickInOverlay,
  dragSelect,
  overlayMounted,
  sleep,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const CHIP = '[data-testid="overlay-chip"]'
const GLASS = '[data-testid="overlay-glass"]'
const POPOVER = '[data-testid="overlay-popover"]'

// Layouts and elements that ordinary pages use and that Chrome treats in its own way.
describe('marking on pages of every shape', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/plain/shapes.html`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  async function save(comment: string): Promise<Target> {
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.type(comment)
    await session.page.keyboard.press('Enter')
    const stored = (await waitForItems(panel, 1)) as unknown as Collection
    return stored.items[0]?.target as Target
  }

  /** Drags a rectangle in area mode between two viewport points. */
  async function dragArea(from: { x: number; y: number }, to: { x: number; y: number }) {
    await session.page.keyboard.press('a')
    await waitInOverlay(session, GLASS)
    await session.page.mouse.move(from.x, from.y)
    await session.page.mouse.down()
    await session.page.mouse.move(to.x, to.y, { steps: 10 })
    await session.page.mouse.up()
  }

  const boxOf = (selector: string) =>
    session.page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height }
    })

  it('offers the chip for text inside display: contents and captures it', async () => {
    await dragSelect(session.page, '#terms', 'terms of service')
    await clickInOverlay(session, CHIP)
    const target = (await save('Link this')) as TextTarget
    expect(target).toMatchObject({
      selected: 'terms of service',
      before: 'Read the ',
      after: ' before you continue.',
    })
  })

  it('records the text of an element whose children are display: contents', async () => {
    await session.page.keyboard.press('e')
    await waitInOverlay(session, GLASS)
    const { x, y } = await centerOf(session.page, '#terms')
    await session.page.mouse.move(x, y)
    await session.page.mouse.click(x, y)
    const target = (await save('Shorter')) as ElementTarget
    expect(target.element.text).toBe('Read the terms of service before you continue.')
  })

  it('lists cards inside a display: contents wrapper in an area', async () => {
    const first = await boxOf('#wrapped .card:first-of-type')
    const last = await boxOf('#wrapped .card:last-of-type')
    await dragArea(
      { x: first.left - 8, y: first.top - 8 },
      { x: last.right + 8, y: last.bottom + 8 },
    )
    const target = (await save('Cards')) as AreaTarget
    expect(target.elements.map((el) => el.text)).toEqual(['Alpha', 'Beta'])
    expect(target.moreCount).toBe(0)
  })

  it('never records the options of a listbox an area reaches into (review focus 1)', async () => {
    const box = await boxOf('#listbox')
    await dragArea(
      { x: box.left - 12, y: box.top - 4 },
      { x: box.right + 12, y: box.top + box.height / 2 },
    )
    await save('Too narrow')
    const stored = JSON.stringify(await storedCollection(panel))
    for (const value of ['plan-basic', 'plan-pro', 'plan-team', 'selected', 'option']) {
      expect(stored).not.toContain(value)
    }
  })

  it('records an option of a listbox without its value', async () => {
    await session.page.keyboard.press('e')
    await waitInOverlay(session, GLASS)
    const { x, y } = await centerOf(session.page, '#listbox')
    await session.page.mouse.move(x, y)
    await session.page.keyboard.press('ArrowDown')
    await session.page.keyboard.press('Enter')
    const target = (await save('Rename')) as ElementTarget
    expect(target.element.openingTag).toBe('<option>')
    const stored = JSON.stringify(await storedCollection(panel))
    for (const value of ['plan-basic', 'plan-pro', 'plan-team', 'selected']) {
      expect(stored).not.toContain(value)
    }
  })

  it('takes the paragraph as the container of a triple-click', async () => {
    const { x, y } = await centerOf(session.page, '#first')
    await session.page.mouse.click(x, y, { count: 3 })
    await clickInOverlay(session, CHIP)
    const target = (await save('Reword')) as TextTarget
    expect(target).toMatchObject({
      selected: 'First paragraph says something here.',
      before: '',
      after: '',
    })
    const matches = await session.page.$$eval(target.container.selector, (els) =>
      els.map((el) => el.id),
    )
    expect(matches).toEqual(['first'])
  })

  it('keeps typing into a field inside a closed shadow root', async () => {
    const { x, y } = await centerOf(session.page, '#field')
    await session.page.mouse.click(x, y)
    await session.page.keyboard.type('banana bread')
    const realm = await contentRealm(session)
    const value = await realm.evaluate(() => {
      const host = document.getElementById('field') as HTMLElement
      const root = (
        globalThis as unknown as {
          chrome: { dom: { openOrClosedShadowRoot(el: Element): ShadowRoot } }
        }
      ).chrome.dom.openOrClosedShadowRoot(host)
      return root.querySelector('input')?.value
    })
    expect(value).toBe('banana bread')
    await sleep(200)
    const glass = await realm.evaluate(
      (sel) => !!globalThis.__webdevOverlay?.shadow?.querySelector(sel),
      GLASS,
    )
    expect(glass).toBe(false)
  })
})
