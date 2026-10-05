import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatCollection } from '../../src/lib/format/markdown'
import type { Collection } from '../../src/lib/collection/model'
import { clickAction, launch, type Session, startFixtureServer } from './harness'
import { centerOf, storedCollection, waitInOverlay } from './overlay-helpers'

describe('marking an element end to end', () => {
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

  it('marks, lists and copies the prompt', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    const panel = await clickAction(session)
    await panel.waitForSelector('::-p-text(Active on localhost:)')
    await panel.click('[data-testid="mode-element"]')
    await waitInOverlay(session, '[data-testid="overlay-glass"]')

    const { x, y } = await centerOf(session.page, 'button[type="submit"]')
    await session.page.mouse.move(x, y)
    await session.page.mouse.click(x, y)
    await waitInOverlay(session, '[data-testid="overlay-popover"]')
    await session.page.keyboard.type('Make it wider')
    await session.page.keyboard.press('Enter')

    await panel.waitForSelector('[data-testid="item"] ::-p-text(Make it wider)')
    expect(await panel.$eval('[data-testid="item-count"]', (el) => el.textContent)).toBe('1')
    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('::-p-text(Copied 1 item)')

    const clipboard = await panel.evaluate(() => navigator.clipboard.readText())
    const stored = (await storedCollection(panel)) as unknown as Collection
    expect(clipboard).toBe(formatCollection(stored))
    expect(clipboard).toContain('# UI feedback: 1 item on 1 page')
    expect(clipboard).toContain('### 1. Element\n\n> Make it wider\n')
    expect(clipboard).toContain('- Text: "Save changes"')
  })

  it('says when a page refuses the overlay', async () => {
    await session.page.goto('chrome://version')
    const panel = await clickAction(session)
    await panel.waitForSelector("::-p-text(Can't run on this page)")
  })
})
