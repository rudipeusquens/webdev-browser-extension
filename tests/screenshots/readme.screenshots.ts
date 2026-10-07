// The README's screenshots, of the made-up page in tests/fixtures/sites/demo (only synthetic
// pages may be shown, docs/public-repo-policy.md). Local only, after a build:
//
//   pnpm build && pnpm screenshots
//
// Not in CI: the pixels change with fonts and rendering. tests/unit/readme.test.ts checks that
// every image the README shows exists. The extension uses the system's font; this run sets
// Inter in its place, so the images look alike wherever they are taken.

import { readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join, resolve } from 'node:path'
import type { Page } from 'puppeteer'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session } from '../e2e/harness'
import {
  clickInOverlay,
  dragSelect,
  markElement,
  overlayMounted,
  sleep,
  waitForItems,
  waitInOverlay,
} from '../e2e/overlay-helpers'

const OUT = 'docs/images'
const DEMO = resolve('tests/fixtures/sites/demo')
const FONT = resolve('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')
// The site the panel names: a dev server's usual port.
const PORT = 3000
const VIEW = { width: 960, height: 600 }
const PANEL_WIDTH = 400
const SCALE = 2
const SANS = '"Inter Variable", sans-serif'
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
}

/** The demo app at http://localhost:3000: `/settings` is its page, `/inter.woff2` the font. */
async function serveDemo(): Promise<Server> {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const file =
      path === '/inter.woff2'
        ? FONT
        : path === '/settings'
          ? join(DEMO, 'settings.html')
          : join(DEMO, path.replace(/^\/+/, ''))
    if (!file.startsWith(DEMO) && file !== FONT) return void res.writeHead(403).end()
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' }).end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(PORT, '127.0.0.1', done)
  })
  return server
}

/** Inter in place of the system font in an extension page. */
async function useInter(page: Page) {
  const font = (await readFile(FONT)).toString('base64')
  await page.addStyleTag({
    content: `@font-face{font-family:"Inter Variable";font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2")}
:root{--font-sans:${SANS};--default-font-family:${SANS}}`,
  })
  await page.evaluate(() => document.fonts.ready)
}

let server: Server
let session: Session
let panel: Page

beforeAll(async () => {
  server = await serveDemo()
  session = await launch()
  await session.page.setViewport({ ...VIEW, deviceScaleFactor: SCALE })
  await session.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await session.page.goto(`http://localhost:${PORT}/settings`)
  await session.page.evaluate(() => document.fonts.ready)
  panel = await clickAction(session)
  await panel.setViewport({ width: PANEL_WIDTH, height: VIEW.height, deviceScaleFactor: SCALE })
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await overlayMounted(session)
  // The page declares Inter; the overlay's closed shadow root takes it as its system font.
  const realm = await contentRealm(session)
  await realm.evaluate((sans) => {
    const style = document.createElement('style')
    style.textContent = `:host > div{--font-sans:${sans};--default-font-family:${sans}}`
    globalThis.__webdevOverlay?.shadow?.append(style)
  }, SANS)
  await useInter(panel)
})

afterAll(async () => {
  await session?.browser.close()
  await new Promise((done) => server?.close(done))
})

async function comment(text: string) {
  await waitInOverlay(session, '[data-testid="overlay-popover"]')
  await session.page.keyboard.type(text)
  await session.page.keyboard.press('Enter')
  await waitInOverlay(session, '[data-testid="overlay-popover"]', false)
}

it('takes the README screenshots', async () => {
  const page = session.page
  await markElement(session, 'button[type="submit"]')
  await comment('Make this button full width on mobile and a bit less tall.')
  await waitForItems(panel, 1)

  await page.keyboard.press('Escape')
  await waitInOverlay(session, '[data-testid="overlay-glass"]', false)
  await dragSelect(page, '.prefs h3', 'Email notifcations')
  await clickInOverlay(session, '[data-testid="overlay-chip"]')
  await comment('Typo, should be "notifications".')
  await waitForItems(panel, 2)

  await page.keyboard.press('a')
  await waitInOverlay(session, '[data-testid="overlay-glass"]')
  // Around the cards, inside their section: the section is the container, the cards its content.
  const area = await page.$$eval('.card', (cards) => {
    const boxes = cards.map((card) => card.getBoundingClientRect())
    return {
      from: {
        x: Math.min(...boxes.map((b) => b.left)) - 4,
        y: Math.min(...boxes.map((b) => b.top)) - 4,
      },
      to: {
        x: Math.max(...boxes.map((b) => b.right)) + 4,
        y: Math.max(...boxes.map((b) => b.bottom)) + 4,
      },
    }
  })
  await page.mouse.move(area.from.x, area.from.y)
  await page.mouse.down()
  await page.mouse.move(area.to.x, area.to.y, { steps: 10 })
  await page.mouse.up()
  await comment('Spacing between these cards is uneven.')
  await waitForItems(panel, 3)

  // Browse mode, the pointer away from the pins: the page with its three pins, and the panel.
  await page.keyboard.press('Escape')
  await page.mouse.move(VIEW.width - 4, VIEW.height - 4)
  await panel.mouse.move(PANEL_WIDTH - 4, VIEW.height - 4)
  await sleep(500)
  const pageShot = await page.screenshot({ type: 'png' })
  const panelShot = await panel.screenshot({ type: 'png' })
  await writeFile(join(OUT, 'overview.png'), await sideBySide(pageShot, panelShot))

  // A comment being written: a link marked in element mode, its popover open.
  await markElement(session, 'nav a[href="#orders"]')
  await page.keyboard.type('Show the number of open orders here.')
  await sleep(300)
  const realm = await contentRealm(session)
  const box = await realm.evaluate(() => {
    const r = globalThis.__webdevOverlay?.shadow
      ?.querySelector('[data-testid="overlay-popover"]')
      ?.getBoundingClientRect()
    return r && { x: r.x, y: r.y, width: r.width, height: r.height }
  })
  const target = await page.$eval('nav a[href="#orders"]', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y }
  })
  expect(box).toBeTruthy()
  if (!box) return
  const left = Math.max(0, Math.min(box.x, target.x) - 24)
  const top = Math.max(0, target.y - 16)
  await writeFile(
    join(OUT, 'comment.png'),
    await page.screenshot({
      type: 'png',
      clip: {
        x: left,
        y: top,
        width: Math.min(VIEW.width - left, box.x + box.width + 24 - left),
        height: Math.min(VIEW.height - top, box.y + box.height + 10 - top),
      },
    }),
  )
})

/** The page and the panel next to each other, as in a browser window with the side panel. */
async function sideBySide(pageShot: Uint8Array, panelShot: Uint8Array): Promise<Uint8Array> {
  const frame = await session.browser.newPage()
  try {
    const img = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`
    await frame.setViewport({ width: 1600, height: 900, deviceScaleFactor: SCALE })
    await frame.setContent(`<!doctype html>
<style>
  body { margin: 0; background: #f4f4f5; }
  .window { display: inline-flex; margin: 24px; border: 1px solid #d4d4d8; border-radius: 12px;
    overflow: hidden; box-shadow: 0 8px 24px rgb(0 0 0 / 0.08); background: #fff; }
  .window img { display: block; height: ${VIEW.height}px; }
  .window img + img { border-left: 1px solid #d4d4d8; }
</style>
<div class="window"><img src="${img(pageShot)}"><img src="${img(panelShot)}"></div>`)
    await frame.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
    const window = await frame.$('.window')
    if (!window) throw new Error('no window')
    const shot = await window.screenshot({ type: 'png', omitBackground: true })
    return shot
  } finally {
    await frame.close()
  }
}
