import type { Page } from 'puppeteer'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'
import { markElement, overlayMounted, sleep, waitForItems, waitInOverlay } from './overlay-helpers'

type ExtensionPage = {
  chrome: {
    storage: { local: { clear(): Promise<void> } }
    scripting: { unregisterContentScripts(): Promise<void> }
  }
}

// Runs a test copy of the build that holds access to localhost from the start: the shipped
// build asks for it in Chrome's prompt, which tests cannot answer (harness.ts).
describe('remembered sites', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session
  let panel: Page

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch({ hostPermissions: ['http://localhost/*'] })
  })

  beforeEach(async () => {
    await session.page.goto(`${server.origin}/plain/`)
    panel = await clickAction(session)
    await panel.evaluate(async () => {
      const { chrome } = globalThis as unknown as ExtensionPage
      await chrome.scripting.unregisterContentScripts()
      await chrome.storage.local.clear()
    })
    await overlayMounted(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  const overlayHosts = () =>
    session.page.evaluate(() => document.querySelectorAll('webdev-overlay').length)

  async function pinCount() {
    const realm = await contentRealm(session)
    return realm.evaluate(
      () =>
        globalThis.__webdevOverlay?.shadow?.querySelectorAll('[data-testid="overlay-pin"]')
          .length ?? 0,
    )
  }

  it('loads the overlay by itself after Always enable here, and no more after Forget this site', async () => {
    await markElement(session, 'h1')
    await session.page.keyboard.type('Heading')
    await session.page.keyboard.press('Enter')
    await waitInOverlay(session, '[data-testid="overlay-popover"]', false)
    await waitForItems(panel, 1)

    await (await panel.waitForSelector('[data-testid="remember-site"]'))?.click()
    await panel.waitForSelector('[data-testid="forget-site"]')

    await session.page.reload()
    await overlayMounted(session)
    expect(await overlayHosts()).toBe(1)
    for (let i = 0; i < 20 && (await pinCount()) !== 1; i++) await sleep(100)
    expect(await pinCount()).toBe(1)

    await (await panel.waitForSelector('[data-testid="forget-site"]'))?.click()
    await panel.waitForSelector('[data-testid="remember-site"]')
    await session.page.reload()
    await sleep(1500)
    expect(await overlayHosts()).toBe(0)
  })

  it('lists the site in the settings and forgets it there', async () => {
    await (await panel.waitForSelector('[data-testid="remember-site"]'))?.click()
    await panel.waitForSelector('[data-testid="forget-site"]')
    await panel.click('[data-testid="open-settings"]')
    await panel.waitForSelector(`[data-testid="site"] ::-p-text(${server.origin})`)
    await panel.click('[data-testid="site"] [data-testid="remove-site"]')
    await panel.waitForSelector('::-p-text(No remembered sites yet)')
    await session.page.reload()
    await sleep(1500)
    expect(await overlayHosts()).toBe(0)
  })

  it('loads the overlay only on the remembered origin', async () => {
    await (await panel.waitForSelector('[data-testid="remember-site"]'))?.click()
    await panel.waitForSelector('[data-testid="forget-site"]')
    const other = server.origin.replace('localhost', '127.0.0.1')
    await session.page.goto(`${other}/plain/`)
    await sleep(1500)
    expect(await overlayHosts()).toBe(0)
    await session.page.goto(`${server.origin}/plain/text.html`)
    await overlayMounted(session)
    expect(await overlayHosts()).toBe(1)
  })
})
