import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type {
  AreaTarget,
  CodeOrigin,
  Collection,
  ElementTarget,
  TextTarget,
} from '../../src/lib/collection/model'
import { formatCollection } from '../../src/lib/format/markdown'
import { clickAction, launch, type Session, startFixtureServer, startVueDevServer } from './harness'
import {
  centerOf,
  clickInOverlay,
  dragSelect,
  markElement,
  overlayMounted,
  overlayText,
  storedCollection,
  waitForItems,
  waitInOverlay,
} from './overlay-helpers'

const POPOVER = '[data-testid="overlay-popover"]'
const GLASS = '[data-testid="overlay-glass"]'
const LABEL = '[data-testid="overlay-hover-label"]'

async function save(session: Session, panel: Page, comment: string, count = 1) {
  await waitInOverlay(session, POPOVER)
  await session.page.keyboard.type(comment)
  await session.page.keyboard.press('Enter')
  const stored = (await waitForItems(panel, count)) as unknown as Collection
  return stored.items[count - 1]?.target
}

describe('code origin on a Vue dev server', () => {
  let app: Awaited<ReturnType<typeof startVueDevServer>>
  let session: Session
  let panel: Page

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

  async function open(path: string, ready: string) {
    await session.page.goto(`${app.origin}${path}`)
    await session.page.waitForSelector(ready)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  }

  afterAll(async () => {
    await session?.browser.close()
    await app?.close()
  })

  const file = (path: string) => `${app.root}/src/${path}`

  it('names the component while hovering and stores the chain with the real files', async () => {
    await open('/settings', '#profile button')
    await session.page.keyboard.press('e')
    await waitInOverlay(session, GLASS)
    const { x, y } = await centerOf(session.page, '#profile button')
    await session.page.mouse.move(x, y)
    let label: string | null = null
    for (let i = 0; i < 30 && !label?.includes('ProfileForm'); i++) {
      label = await overlayText(session, LABEL)
      await new Promise((done) => setTimeout(done, 100))
    }
    expect(label).toMatch(/^button · ProfileForm · \d+×\d+$/)

    await session.page.mouse.click(x, y)
    const target = (await save(session, panel, 'Full width on mobile')) as ElementTarget
    expect(target.element.origin).toEqual({
      framework: 'vue',
      chain: [
        { name: 'App', file: file('App.vue') },
        { name: 'SettingsPage', file: file('pages/SettingsPage.vue') },
        { name: 'ProfileForm', file: file('components/ProfileForm.vue'), line: 7 },
      ],
    } satisfies CodeOrigin)

    await panel.click('[data-testid="copy-prompt"]')
    await panel.waitForSelector('::-p-text(Copied 1 pin)')
    const clipboard = await panel.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(
      formatCollection((await storedCollection(panel)) as unknown as Collection),
    )
    expect(clipboard).toContain(
      `- Component: App (${file('App.vue')}) › SettingsPage (${file('pages/SettingsPage.vue')}) › ` +
        `ProfileForm (${file('components/ProfileForm.vue')}:7)`,
    )
  })

  it('adds the component of a text container', async () => {
    await open('/settings', '.prefs h3')
    await dragSelect(session.page, '.prefs h3', 'Email notifcations')
    await clickInOverlay(session, '[data-testid="overlay-chip"]')
    const target = (await save(session, panel, 'Typo')) as TextTarget
    expect(target.container.origin?.chain.at(-1)).toEqual({
      name: 'NotificationPrefs',
      file: file('components/NotificationPrefs.vue'),
    })
  })

  it("adds the components of an area's container and elements", async () => {
    await open('/', '.card')
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
    const target = (await save(session, panel, 'Uneven spacing')) as AreaTarget
    expect(target.container.origin?.chain.at(-1)?.name).toBe('FeatureGrid')
    expect(target.elements.map((el) => el.origin?.chain.at(-1)?.name)).toEqual([
      'FeatureCard',
      'FeatureCard',
      'FeatureCard',
    ])
    expect(target.elements[0]?.origin?.chain.at(-1)?.file).toBe(file('components/FeatureCard.vue'))
  })
})

describe('code origin from other pages', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  beforeEach(async () => {
    await session.page.goto('about:blank')
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  async function open(path: string) {
    await session.page.goto(`${server.origin}${path}`)
    panel = await clickAction(session)
    await panel.evaluate(() => chrome.storage.local.clear())
    await overlayMounted(session)
  }

  it('reads Astro source attributes for elements and areas', async () => {
    await open('/astro-attrs/')
    await markElement(session, '.cta')
    const element = (await save(session, panel, 'Bigger')) as ElementTarget
    expect(element.element.origin).toEqual({
      framework: 'astro',
      chain: [{ file: '/srv/site/src/components/Hero.astro', line: 4 }],
    })
  })

  it('saves every item quickly on a page that fakes its components (review focus 1)', async () => {
    await open('/fake-vue/')
    const ids = ['throws', 'loops', 'huge', 'typed', 'fine', 'swapped']
    for (const [i, id] of ids.entries()) {
      const started = Date.now()
      await markElement(session, `#${id}`)
      await save(session, panel, `Item ${id}`, i + 1)
      expect(Date.now() - started).toBeLessThan(4000)
      await session.page.keyboard.press('Escape')
    }
    const stored = (await storedCollection(panel)) as unknown as Collection
    const origins = Object.fromEntries(
      stored.items.map((item) => [
        item.comment.replace('Item ', ''),
        (item.target as ElementTarget).element.origin,
      ]),
    )
    expect(origins.throws).toBeUndefined()
    expect(origins.huge).toBeUndefined()
    expect(origins.typed).toBeUndefined()
    expect(origins.loops?.chain).toHaveLength(5)
    expect(origins.fine?.chain).toEqual([
      { name: 'Fine', file: '/srv/app/src/Fine.vue ## Injected heading' },
    ])
    // The page answered for #swapped with another element: its data, cleaned like any other.
    expect(origins.swapped?.chain[0]?.name).toBe('Fine')
    const prompt = formatCollection(stored)
    expect(prompt).not.toMatch(/^## Injected/m)
  })

  it('works on a page with a strict content security policy', async () => {
    await open('/hostile/')
    await markElement(session, '.layer')
    const started = Date.now()
    const target = (await save(session, panel, 'Strict')) as ElementTarget
    expect(Date.now() - started).toBeLessThan(3000)
    expect(target.element.origin).toBeUndefined()
  })
})
