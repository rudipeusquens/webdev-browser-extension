import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  clickAction,
  contentRealm,
  launch,
  type Session,
  startFixtureServer,
  startOverlayAgain,
} from './harness'
import { overlayHosts, overlayMounted } from './overlay-helpers'

describe('activating twice on the same tab', () => {
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

  it('keeps exactly one mounted overlay', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    await clickAction(session)
    await startOverlayAgain(session)
    // Give a second injection time to mount (or to remove the first one).
    await new Promise((done) => setTimeout(done, 1000))
    const hosts = await overlayHosts(session)
    expect(hosts).toBe(1)
    const realm = await contentRealm(session)
    const mounted = await realm.evaluate(
      () => !!globalThis.__webdevOverlay?.shadow?.querySelector('[data-testid="overlay-root"]'),
    )
    expect(mounted).toBe(true)
  })

  it('mounts even when the page clobbers the global name', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    await session.page.evaluate(() => {
      const decoy = document.createElement('div')
      decoy.id = '__webdevOverlay'
      document.body.append(decoy)
    })
    await clickAction(session)
    await new Promise((done) => setTimeout(done, 1000))
    const hosts = await overlayHosts(session)
    expect(hosts).toBe(1)
  })

  it('tells the page nothing when it starts, not even the extension id', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    await session.page.evaluate(() => {
      const seen: string[] = []
      Object.assign(window, { seen })
      window.addEventListener('message', (e) => seen.push(JSON.stringify(e.data)))
    })
    await clickAction(session)
    await overlayMounted(session)
    await new Promise((done) => setTimeout(done, 300))
    const seen = await session.page.evaluate(() => (window as unknown as { seen: string[] }).seen)
    expect(seen.join(' ')).not.toContain(session.extensionId)
  })

  it('stays when the page fakes the start of another overlay', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    await clickAction(session)
    await overlayMounted(session)
    await session.page.evaluate((id) => {
      document.dispatchEvent(
        new CustomEvent(`${id}:overlay:wxt:content-script-started`, {
          detail: { contentScriptName: 'overlay', messageId: 'forged' },
        }),
      )
    }, session.extensionId)
    await new Promise((done) => setTimeout(done, 500))
    expect(await overlayHosts(session)).toBe(1)
    const realm = await contentRealm(session)
    expect(
      await realm.evaluate(
        () => !!globalThis.__webdevOverlay?.shadow?.querySelector('[data-testid="overlay-root"]'),
      ),
    ).toBe(true)
  })
})
