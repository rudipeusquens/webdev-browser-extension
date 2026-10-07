import { cp, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import puppeteer, {
  type Browser,
  type CDPSession,
  type Page,
  type Realm,
  type WebWorker,
} from 'puppeteer'
import { createServer as createViteServer } from 'vite'

export const EXTENSION_DIR = resolve(process.env.E2E_EXTENSION_DIR ?? '.output/chrome-mv3')
const SITES = resolve('tests/fixtures/sites')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
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

/**
 * Serves tests/fixtures/sites/vue-app from a Vite dev server, like a developer's app: the
 * elements carry Vue's component data with the absolute paths of the `.vue` files. The app
 * runs from a copy in a temporary directory, so tests can change its files (HMR) and the
 * paths are known; `vue` resolves to this repository's copy.
 */
export async function startVueDevServer() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'webdev-vue-app-')))
  await cp(resolve('tests/fixtures/sites/vue-app'), root, { recursive: true })
  const server = await createViteServer({
    root,
    configFile: false,
    logLevel: 'error',
    plugins: [vue()],
    cacheDir: join(root, '.vite'),
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, resolve('node_modules')] } },
    resolve: { alias: { vue: resolve('node_modules/vue/dist/vue.runtime.esm-bundler.js') } },
  })
  await server.listen()
  const { port } = server.httpServer?.address() as AddressInfo
  return {
    origin: `http://localhost:${port}`,
    /** Where the app's files are: `__file` paths start here. */
    root,
    read: (path: string) => readFile(join(root, path), 'utf8'),
    write: (path: string, text: string) => writeFile(join(root, path), text),
    close: async () => {
      await server.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

export interface Session {
  browser: Browser
  extensionId: string
  page: Page
}

export type MicrophoneSetting = 'granted' | 'prompt' | 'denied'

export interface LaunchOptions {
  /**
   * A copy of the build whose manifest grants these origins when it is installed: Chrome's
   * prompt for "Always enable here" cannot be automated, and with the access granted already,
   * `permissions.request` answers without one.
   */
  hostPermissions?: string[]
  /** Origin of a fake OpenRouter: a copy of the build sends dictation there. */
  openrouter?: string
  /** Chrome's fake microphone, with this permission for the extension. */
  microphone?: MicrophoneSetting
  /** More Chrome arguments, such as an audio file for the fake microphone. */
  args?: string[]
}

const OPENROUTER = 'https://openrouter.ai'

/** Every JavaScript file of the build, relative to `dir`. */
async function scripts(dir: string): Promise<string[]> {
  const files = await readdir(dir, { recursive: true })
  return files.filter((file) => file.endsWith('.js'))
}

/**
 * A copy of the build for a test; the shipped build stays as it is. With `openrouter`, every
 * `https://openrouter.ai` in its scripts points at the fake instead, and the copy fails when
 * there is none: a test must never reach the real API.
 */
async function buildCopy(options: LaunchOptions): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'webdev-extension-'))
  await cp(EXTENSION_DIR, dir, { recursive: true })
  if (options.hostPermissions) {
    const path = join(dir, 'manifest.json')
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    manifest.host_permissions = options.hostPermissions
    await writeFile(path, JSON.stringify(manifest))
  }
  if (options.openrouter) {
    let rewritten = 0
    for (const file of await scripts(dir)) {
      const path = join(dir, file)
      const code = await readFile(path, 'utf8')
      if (!code.includes(OPENROUTER)) continue
      await writeFile(path, code.split(OPENROUTER).join(options.openrouter))
      rewritten++
    }
    if (rewritten === 0) throw new Error(`no ${OPENROUTER} in the build to point at the fake`)
  }
  return dir
}

export async function launch(options: LaunchOptions = {}): Promise<Session> {
  // --no-sandbox: CI runners restrict user namespaces; the pages are our own fixtures.
  const browser = await puppeteer.launch({
    headless: true,
    enableExtensions: true,
    args: [
      '--no-sandbox',
      ...(options.microphone ? ['--use-fake-device-for-media-stream'] : []),
      ...(options.args ?? []),
    ],
  })
  const dir =
    options.hostPermissions || options.openrouter ? await buildCopy(options) : EXTENSION_DIR
  if (dir !== EXTENSION_DIR) {
    browser.once('disconnected', () => void rm(dir, { recursive: true, force: true }))
  }
  const extensionId = await browser.installExtension(dir)
  await browser.waitForTarget(
    (t) =>
      t.type() === 'service_worker' &&
      t.url() === `chrome-extension://${extensionId}/background.js`,
  )
  const page = await browser.newPage()
  const session = { browser, extensionId, page }
  if (options.microphone) await setMicrophone(session, options.microphone)
  return session
}

/** One DevTools session per browser: Chrome drops its permission overrides when it ends. */
const permissionSessions = new WeakMap<Browser, Promise<CDPSession>>()

/**
 * The extension's microphone permission, as Chrome's prompt would set it: the prompt itself
 * cannot be automated.
 */
export async function setMicrophone(s: Session, setting: MicrophoneSetting): Promise<void> {
  let cdp = permissionSessions.get(s.browser)
  if (!cdp) {
    cdp = s.browser.target().createCDPSession()
    permissionSessions.set(s.browser, cdp)
  }
  await (
    await cdp
  ).send('Browser.setPermission', {
    permission: { name: 'microphone' },
    setting,
    origin: `chrome-extension://${s.extensionId}`,
  })
}

/** The extension's service worker. */
export async function serviceWorker(s: Session): Promise<WebWorker> {
  const target = await s.browser.waitForTarget(
    (t) =>
      t.type() === 'service_worker' &&
      t.url() === `chrome-extension://${s.extensionId}/background.js`,
  )
  const worker = await target.worker()
  if (!worker) throw new Error('the service worker is not running')
  return worker
}

/**
 * Starts the overlay on the active tab again while the panel stays open, as the page's context
 * menu entry does: a second toolbar click closes the panel instead. The tab keeps the
 * `activeTab` grant of the first click.
 */
export async function startOverlayAgain(s: Session): Promise<void> {
  const worker = await serviceWorker(s)
  await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as {
      chrome: {
        tabs: { query(q: object): Promise<{ id?: number }[]> }
        scripting: { executeScript(o: object): Promise<unknown> }
      }
    }
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    await chrome.scripting.executeScript({
      target: { tabId: tab?.id },
      files: ['/content-scripts/overlay.js'],
    })
  })
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
