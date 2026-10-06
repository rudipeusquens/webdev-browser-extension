import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { createSites } from '@/lib/background/sites'
import { loadSettings } from '@/lib/settings'
import { fakeSites } from './helpers/fake-sites'

const A = 'http://localhost:3000'
const B = 'https://staging.example.com'

describe('createSites', () => {
  let fake: ReturnType<typeof fakeSites>

  beforeEach(() => {
    fakeBrowser.reset()
    fake = fakeSites([`${A}/*`, `${B}/*`])
  })

  afterEach(() => vi.restoreAllMocks())

  it('remembers a granted origin and registers the overlay for it', async () => {
    const sites = createSites()
    expect(await sites.remember(A)).toEqual({ ok: true })
    expect((await loadSettings()).rememberedOrigins).toEqual([A])
    expect(fake.state.scripts.get('overlay')).toMatchObject({
      matches: [`${A}/*`],
      js: ['content-scripts/overlay.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    })
    expect(await sites.isRemembered(A)).toBe(true)
    expect(await sites.isRemembered(B)).toBe(false)
  })

  it('updates the registration for a second origin', async () => {
    const sites = createSites()
    await sites.remember(B)
    await sites.remember(A)
    await sites.remember(A)
    expect((await loadSettings()).rememberedOrigins).toEqual([A, B])
    expect(fake.state.scripts.get('overlay')?.matches).toEqual([`${A}/*`, `${B}/*`])
  })

  it('refuses an origin Chrome did not grant', async () => {
    const sites = createSites()
    expect(await sites.remember('http://other.test')).toMatchObject({ ok: false })
    expect((await loadSettings()).rememberedOrigins).toEqual([])
    expect(fake.state.scripts.size).toBe(0)
  })

  it('forgets an origin, unregisters the last one and gives the access back', async () => {
    const sites = createSites()
    await sites.remember(A)
    await sites.remember(B)
    expect(await sites.forget(A)).toEqual({ ok: true })
    expect(fake.state.scripts.get('overlay')?.matches).toEqual([`${B}/*`])
    expect(fake.state.granted.has(`${A}/*`)).toBe(false)
    await sites.forget(B)
    expect(fake.state.scripts.size).toBe(0)
    expect((await loadSettings()).rememberedOrigins).toEqual([])
  })

  it('forgets even when Chrome refuses to remove the permission', async () => {
    const sites = createSites()
    await sites.remember(A)
    vi.mocked(fakeBrowser.permissions.remove).mockRejectedValueOnce(
      new Error('You cannot remove required permissions.'),
    )
    expect(await sites.forget(A)).toEqual({ ok: true })
    expect((await loadSettings()).rememberedOrigins).toEqual([])
    expect(fake.state.scripts.size).toBe(0)
  })

  it('drops origins Chrome no longer grants when reconciling (review focus 5)', async () => {
    const sites = createSites()
    await sites.remember(A)
    await sites.remember(B)
    fake.state.granted.delete(`${A}/*`)
    fake.state.scripts.clear()
    await sites.reconcile()
    expect((await loadSettings()).rememberedOrigins).toEqual([B])
    expect(fake.state.scripts.get('overlay')?.matches).toEqual([`${B}/*`])
  })

  it('runs one change at a time', async () => {
    const sites = createSites()
    await Promise.all([sites.remember(A), sites.remember(B), sites.forget(A)])
    expect((await loadSettings()).rememberedOrigins).toEqual([B])
    expect(fake.state.scripts.get('overlay')?.matches).toEqual([`${B}/*`])
  })
})
