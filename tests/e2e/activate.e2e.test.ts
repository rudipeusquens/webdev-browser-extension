import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WebWorker } from 'puppeteer'
import { clickAction, launch, serviceWorker, type Session, startFixtureServer } from './harness'

type Chrome = {
  contextMenus?: { update(id: string, properties: object, callback: () => void): void }
  runtime: { lastError?: { message?: string } }
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

  it('adds "Annotate this page" to the context menu of pages', async () => {
    const worker = await serviceWorker(session)
    await vi.waitFor(async () => expect(await menuEntry(worker, 'annotate')).toBe('found'))
    expect(await menuEntry(worker, 'nothing')).not.toBe('found')
  })
})
