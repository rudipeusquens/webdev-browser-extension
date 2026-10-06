import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WebWorker } from 'puppeteer'
import { clickAction, launch, serviceWorker, type Session, startFixtureServer } from './harness'

type Command = { name?: string; shortcut?: string }
type Chrome = {
  commands: { getAll(): Promise<Command[]> }
  contextMenus?: { update(id: string, properties: object, callback: () => void): void }
  runtime: { lastError?: { message?: string } }
}

// As Chrome shows the suggested key: Ctrl+Shift+K, on macOS Command+Shift+K.
const SHORTCUT = /^(Ctrl\+Shift\+K|⇧⌘K)$/

/** The key Chrome assigned to the toolbar action. */
const assignedShortcut = async (worker: WebWorker) => {
  const commands = await worker.evaluate(() =>
    (globalThis as unknown as { chrome: Chrome }).chrome.commands.getAll(),
  )
  return commands.find((c) => c.name === '_execute_action')?.shortcut ?? ''
}

/** Whether the context menu has the entry `id`; Chrome can list none, only update one. */
const menuEntry = (worker: WebWorker, id: string) =>
  worker.evaluate(
    (id) =>
      new Promise<string>((done) => {
        const { chrome } = globalThis as unknown as { chrome: Chrome }
        if (!chrome.contextMenus) return done('no contextMenus API')
        chrome.contextMenus.update(id, {}, () => done(chrome.runtime.lastError?.message ?? 'found'))
      }),
    id,
  )

describe('activation', () => {
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

  it('opens the side panel on action click', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    const panel = await clickAction(session)
    const empty = await panel.waitForSelector('::-p-text(No feedback yet)')
    expect(empty).not.toBeNull()
    const disabled = await panel.$eval('[data-testid="copy-prompt"]', (b) =>
      b.hasAttribute('disabled'),
    )
    expect(disabled).toBe(true)
  })

  // Chrome silently leaves a suggested key unassigned when it is one of its own shortcuts
  // (Alt+Shift+A focuses inactive dialogs, Ctrl+K searches): only the result tells.
  it('gets its suggested shortcut from Chrome', async () => {
    expect(await assignedShortcut(await serviceWorker(session))).toMatch(SHORTCUT)
  })

  it('adds "Annotate this page" to the context menu of pages', async () => {
    const worker = await serviceWorker(session)
    await vi.waitFor(async () => expect(await menuEntry(worker, 'annotate')).toBe('found'))
    expect(await menuEntry(worker, 'nothing')).not.toBe('found')
  })

  it('says when the overlay cannot start on a page', async () => {
    await session.page.goto(`${server.origin}/taken-name/`)
    const errors: string[] = []
    session.page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    const panel = await clickAction(session)
    await panel.waitForSelector("::-p-text(Couldn't start on this page)")
    expect(errors.some((e) => e.includes('The overlay could not start on this page'))).toBe(true)
  })

  it('names the assigned shortcut in the panel of a page it is not active on', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    const panel = await clickAction(session)
    const other = await session.browser.newPage()
    await other.goto(`${server.origin}/plain/`)
    await other.bringToFront()
    await panel.waitForFunction(() =>
      document.querySelector('[data-testid="tab-status"]')?.textContent?.includes('Not active'),
    )
    const text = await panel.$eval('[data-testid="tab-status"]', (p) => p.textContent ?? '')
    const shortcut = await assignedShortcut(await serviceWorker(session))
    expect(shortcut).toMatch(SHORTCUT)
    expect(text).toContain(`press ${shortcut}`)
    expect(text).toContain('Annotate this page')
    await other.close()
  })
})
