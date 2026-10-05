import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AreaTarget, Collection, TextTarget } from '../../src/lib/collection/model'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import {
  clickInOverlay,
  dragSelect,
  overlayMounted,
  sleep,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const POPOVER = '[data-testid="overlay-popover"]'

// Text and area marking on the pages that broke element marking before: named elements
// shadowing document members, modal dialogs and script focus traps.
describe('text and area marking on hostile pages', () => {
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

  async function open(path: string) {
    await session.page.goto(`${server.origin}${path}`)
    const panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
    return panel
  }

  async function comment(text: string) {
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.type(text)
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, POPOVER, false)
  }

  async function dragAround(selector: string, margin = 6) {
    const { from, to } = await session.page.$$eval(
      selector,
      (els, m) => {
        const boxes = els.map((el) => el.getBoundingClientRect())
        return {
          from: {
            x: Math.min(...boxes.map((b) => b.left)) - m,
            y: Math.min(...boxes.map((b) => b.top)) - m,
          },
          to: {
            x: Math.max(...boxes.map((b) => b.right)) + m,
            y: Math.max(...boxes.map((b) => b.bottom)) + m,
          },
        }
      },
      margin,
    )
    await session.page.mouse.move(from.x, from.y)
    await session.page.mouse.down()
    await session.page.mouse.move(to.x, to.y, { steps: 10 })
    await session.page.mouse.up()
  }

  it('marks text and an area where named elements shadow document members', async () => {
    const panel = await open('/clobbered/')
    await dragSelect(session.page, '#intro', 'forms with these names')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await comment('Wording')
    await session.page.keyboard.press('a')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    await dragAround('.card', 4)
    await comment('Cards')
    const stored = (await waitForItems(panel, 2)) as unknown as Collection
    expect(Object.values(stored.pages)[0]?.title).toBe('Clobbered fixture')
    const text = stored.items[0]?.target as TextTarget
    expect(text.selected).toBe('forms with these names')
    expect(text.container.selector).toBe('#intro')
    const area = stored.items[1]?.target as AreaTarget
    expect(area.elements.map((e) => e.selector)).toEqual(['section.features'])
  })

  it('marks text and an area inside a modal dialog', async () => {
    const panel = await open('/modal/')
    await session.page.click('#open')
    await sleep(200)
    await dragSelect(session.page, 'dialog p', 'Inside the modal')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await comment('Shorter')
    await session.page.keyboard.press('a')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    await dragAround('#inside, #close')
    await comment('Align the buttons')
    const stored = (await waitForItems(panel, 2)) as unknown as Collection
    expect((stored.items[0]?.target as TextTarget).selected).toBe('Inside the modal')
    const area = stored.items[1]?.target as AreaTarget
    expect(area.elements.map((e) => e.text)).toEqual(['Confirm', 'Close'])
  })

  it('comments on text inside a script focus trap', async () => {
    const panel = await open('/trap/')
    await dragSelect(session.page, '#question', 'Delete this item')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await comment('Say which item')
    const stored = (await waitForItems(panel, 1)) as unknown as Collection
    expect((stored.items[0]?.target as TextTarget).selected).toBe('Delete this item')
    expect(
      await session.page.evaluate(() => (window as unknown as { submits: number }).submits),
    ).toBe(0)
  })
})
