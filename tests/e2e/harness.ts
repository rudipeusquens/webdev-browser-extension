import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'
import puppeteer, { type Browser, type Page, type Realm } from 'puppeteer'

export const EXTENSION_DIR = resolve(process.env.E2E_EXTENSION_DIR ?? '.output/chrome-mv3')
const SITES = resolve('tests/fixtures/sites')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
}

/** Serves tests/fixtures/sites; `<site>/headers.json` adds response headers (e.g. a CSP). */
export async function startFixtureServer() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname))
    const file = join(SITES, path.endsWith('/') ? `${path}index.html` : path)
    if (!file.startsWith(SITES)) return void res.writeHead(403).end()
    try {
      const body = await readFile(file)
      const site = path.split('/')[1] ?? ''
      const headers = await readFile(join(SITES, site, 'headers.json'), 'utf8')
        .then((text) => JSON.parse(text) as Record<string, string>)
        .catch(() => ({}))
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain', ...headers })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://localhost:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

export interface Session {
  browser: Browser
  extensionId: string
  page: Page
}

export async function launch(): Promise<Session> {
  // --no-sandbox: CI runners restrict user namespaces; the pages are our own fixtures.
  const browser = await puppeteer.launch({
    headless: true,
    enableExtensions: true,
    args: ['--no-sandbox'],
  })
  const extensionId = await browser.installExtension(EXTENSION_DIR)
  await browser.waitForTarget(
    (t) =>
      t.type() === 'service_worker' &&
      t.url() === `chrome-extension://${extensionId}/background.js`,
  )
  const page = await browser.newPage()
  return { browser, extensionId, page }
}

/** Clicks the toolbar action on `s.page` and returns the side panel page. */
export async function clickAction(s: Session): Promise<Page> {
  const extension = (await s.browser.extensions()).get(s.extensionId)
  if (!extension) throw new Error('extension is not installed')
  await s.page.triggerExtensionAction(extension)
  const target = await s.browser.waitForTarget(
    (t) => t.url() === `chrome-extension://${s.extensionId}/sidepanel.html`,
  )
  const panel = await target.asPage()
  // A headless side panel reports a 0×0 viewport otherwise.
  await panel.setViewport({ width: 400, height: 800 })
  return panel
}

/** The extension's content-script world in `s.page`. */
export async function contentRealm(s: Session): Promise<Realm> {
  for (let attempt = 0; attempt < 50; attempt++) {
    for (const realm of await s.page.extensionRealms()) {
      if ((await realm.extension())?.id === s.extensionId) return realm
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error('content-script realm not found')
}
