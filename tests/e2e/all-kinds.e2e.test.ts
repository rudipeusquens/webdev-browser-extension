import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Collection } from '../../src/lib/collection/model'
import { formatCollection } from '../../src/lib/format/markdown'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import {
  clickInOverlay,
  dragSelect,
  markElement,
  overlayMounted,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

// Milestone 3 acceptance: element, text and area items in one copied prompt.
describe('all three marking types', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

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

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  async function comment(text: string) {
    await waitInOverlay(session, '[data-testid="overlay-popover"]')
    await session.page.keyboard.type(text)
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, '[data-testid="overlay-popover"]', false)
  }

  it('end up in one prompt', async () => {
    const page = session.page
    await page.goto(`${server.origin}/plain/`)
    const panel = await clickAction(session)
    await overlayMounted(session)

    await markElement(session, 'button[type="submit"]')
    await comment('Make it wider')
    await waitForItems(panel, 1)

    await page.keyboard.press('Escape')
    await waitInOverlay(session, '[data-testid="overlay-glass"]', false)
    await dragSelect(page, '#title', 'Example shop')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await comment('Use the brand name')
    await waitForItems(panel, 2)

    await page.keyboard.press('a')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')
    const { from, to } = await page.$$eval('.card', (cards) => {
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
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()
    await comment('Even spacing')
    await waitForItems(panel, 3)

    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('::-p-text(Copied 3 pins)')
    const clipboard = await panel.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(
      formatCollection((await storedCollection(panel)) as unknown as Collection),
    )
    expect(clipboard).toContain('# UI feedback: 3 items on 1 page')
    expect(clipboard).toContain('### 1. Element\n\n> Make it wider\n')
    expect(clipboard).toMatch(/- Styles: display: inline-block; width: [^;]+; height: 21px;/)
    expect(clipboard).toContain(
      '### 2. Text\n\n> Use the brand name\n\n- Selected: "Example shop"\n',
    )
    expect(clipboard).toContain('- In: `#title`')
    expect(clipboard).toContain('### 3. Area\n\n> Even spacing\n')
    expect(clipboard).toContain('- Container: `section.features`')
    expect(clipboard).toContain(
      '- Contains 3 elements:\n  - `div.card:nth-of-type(1)` "Fast setup"',
    )
  })
})
