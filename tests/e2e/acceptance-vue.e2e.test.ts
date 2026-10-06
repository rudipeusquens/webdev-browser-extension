import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Collection } from '../../src/lib/collection/model'
import { formatCollection } from '../../src/lib/format/markdown'
import { clickAction, contentRealm, launch, type Session, startVueDevServer } from './harness'
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

const POPOVER = '[data-testid="overlay-popover"]'
const GLASS = '[data-testid="overlay-glass"]'

// Milestone 4 acceptance: a session over three pages of a Vue app on its dev server, with a
// reload in between, copies one correct prompt.
describe('a three-page session on a Vue app', () => {
  let app: Awaited<ReturnType<typeof startVueDevServer>>
  let session: Session

  beforeAll(async () => {
    app = await startVueDevServer()
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
    await app?.close()
  })

  const file = (path: string) => `${app.root}/src/${path}`

  async function comment(text: string) {
    await waitInOverlay(session, POPOVER)
    await session.page.keyboard.type(text)
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, POPOVER, false)
  }

  /** The app's own link: pushState, no reload. */
  async function follow(label: string, ready: string) {
    await session.page.click(`nav a::-p-text(${label})`)
    await session.page.waitForSelector(ready)
  }

  it('collects an area, an element and a text and copies them grouped by page', async () => {
    await session.page.goto(`${app.origin}/`)
    await session.page.waitForSelector('.card')
    let panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)

    // Home: the feature grid as an area.
    await session.page.keyboard.press('a')
    await waitInOverlay(session, GLASS)
    const around = await session.page.$$eval('.card', (cards) => {
      const boxes = cards.map((c) => c.getBoundingClientRect())
      return {
        left: Math.min(...boxes.map((b) => b.left)) - 8,
        top: Math.min(...boxes.map((b) => b.top)) - 8,
        right: Math.max(...boxes.map((b) => b.right)) + 8,
        bottom: Math.max(...boxes.map((b) => b.bottom)) + 8,
      }
    })
    await session.page.mouse.move(around.left, around.top)
    await session.page.mouse.down()
    await session.page.mouse.move(around.right, around.bottom, { steps: 10 })
    await session.page.mouse.up()
    await comment('Spacing between these cards is uneven.')
    await waitForItems(panel, 1)
    await session.page.keyboard.press('Escape')

    // Settings, without a reload: the submit button.
    await follow('Settings', '#profile button')
    await session.page.keyboard.press('e')
    await waitInOverlay(session, GLASS)
    const button = await centerOf(session.page, '#profile button')
    await session.page.mouse.move(button.x, button.y)
    await session.page.mouse.click(button.x, button.y)
    await comment('Make this button full width on mobile.')
    await waitForItems(panel, 2)
    await session.page.keyboard.press('Escape')

    // About: a sentence.
    await follow('About', '#story')
    await dragSelect(session.page, '#story', 'tools for people')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    await comment('Say who the tools are for.')
    await waitForItems(panel, 3)

    // A full reload of About: the pin is back at the sentence.
    await session.page.reload()
    await session.page.waitForSelector('#story')
    panel = await clickAction(session)
    await overlayMounted(session)
    const want = await session.page.$eval('#story', (el) => {
      const node = el.firstChild as Text
      const at = node.data.indexOf('tools for people')
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + 'tools for people'.length)
      const r = range.getBoundingClientRect()
      return { x: r.right - 10, y: r.top - 10 }
    })
    let pin: { x: number; y: number } | null = null
    for (let i = 0; i < 30; i++) {
      const realm = await contentRealm(session)
      pin = await realm.evaluate(() => {
        const r = globalThis.__webdevOverlay?.shadow
          ?.querySelector('[data-testid="overlay-pin"]')
          ?.getBoundingClientRect()
        return r ? { x: r.x, y: r.y } : null
      })
      if (pin && Math.abs(pin.x - want.x) <= 3 && Math.abs(pin.y - want.y) <= 3) break
      await sleep(100)
    }
    expect(pin && Math.abs(pin.x - want.x) <= 3 && Math.abs(pin.y - want.y) <= 3).toBe(true)

    // One prompt: Home, Settings, About, each item with its components and real files.
    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('::-p-text(Copied 3 items)')
    const clipboard = await panel.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(
      formatCollection((await storedCollection(panel)) as unknown as Collection),
    )
    expect(clipboard).not.toContain('not found when the page was last open')
    const home = clipboard.indexOf(`## ${app.origin}/\n`)
    const settings = clipboard.indexOf(`## ${app.origin}/settings\n`)
    const about = clipboard.indexOf(`## ${app.origin}/about\n`)
    expect(home).toBeGreaterThan(0)
    expect(settings).toBeGreaterThan(home)
    expect(about).toBeGreaterThan(settings)
    expect(clipboard).toContain('# UI feedback: 3 items on 3 pages')
    expect(clipboard).toContain('Title: Shop · Settings')
    expect(clipboard).toContain(
      `- Container: \`section.features\` · Component: FeatureGrid (${file('components/FeatureGrid.vue')})`,
    )
    expect(clipboard).toContain(`· FeatureCard (${file('components/FeatureCard.vue')})`)
    expect(clipboard).toContain(
      `- Component: App (${file('App.vue')}) › SettingsPage (${file('pages/SettingsPage.vue')}) › ` +
        `ProfileForm (${file('components/ProfileForm.vue')}:7)`,
    )
    expect(clipboard).toContain(
      // 40 characters of context after the selection, then cut.
      `- Context: "We build **tools for people** who build the web, one small step at a …"`,
    )
    expect(clipboard).toContain(`Component: AboutPage (${file('pages/AboutPage.vue')})`)
  })
})
