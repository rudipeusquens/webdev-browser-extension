import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'

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
    await clickAction(session)
    // Give a second injection time to mount (or to remove the first one).
    await new Promise((done) => setTimeout(done, 1000))
    const hosts = await session.page.evaluate(
      () => document.querySelectorAll('webdev-overlay').length,
    )
    expect(hosts).toBe(1)
    const realm = await contentRealm(session)
    const mounted = await realm.evaluate(
      () => !!globalThis.__webdevOverlay?.shadow?.querySelector('[data-testid="overlay-trigger"]'),
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
    const hosts = await session.page.evaluate(
      () => document.querySelectorAll('webdev-overlay').length,
    )
    expect(hosts).toBe(1)
  })
})
