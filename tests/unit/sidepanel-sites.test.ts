import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import App from '@/entrypoints/sidepanel/App.vue'
import type { Collection } from '@/lib/collection/model'
import { addAnnotation, emptyCollection } from '@/lib/collection/ops'
import { collectionKey } from '@/lib/collection/store'
import { SETTINGS_KEY } from '@/lib/settings'
import { elementInput } from './helpers/collection'
import { fakeSites } from './helpers/fake-sites'

const LOCAL = 'http://localhost:3000'
const STAGING = 'https://staging.example.com'
const FILES = 'file://'

let wrapper: VueWrapper | undefined

const byTestId = (id: string, root: ParentNode = document) => {
  const el = root.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`no ${id}`)
  return el
}
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="site"]')]

function withItems(site: string, page: string, n: number): Collection {
  let c = emptyCollection(site)
  for (let i = 0; i < n; i++) c = addAnnotation(c, elementInput(`i${i}`, page, `<b>${i}</b>`), 'T')
  return c
}

async function openSettings(stored: Record<string, unknown>) {
  await fakeBrowser.storage.local.set(stored)
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  byTestId('open-settings').click()
  await flushPromises()
}

describe('Settings: sites', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    fakeSites()
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 1 }] as never)
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockRejectedValue(new Error('No overlay.'))
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({ ok: true } as never)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('lists remembered sites and sites with feedback, each once, by name', async () => {
    await openSettings({
      [SETTINGS_KEY]: { rememberedOrigins: [STAGING, LOCAL] },
      [collectionKey(LOCAL)]: withItems(LOCAL, `${LOCAL}/a`, 3),
      [collectionKey(FILES)]: withItems(FILES, 'file:///srv/a.html', 1),
    })
    const shown = rows().map((row) => byTestId('site-label', row).textContent?.trim())
    expect(shown).toEqual(['Local files', 'localhost:3000', 'staging.example.com'])
  })

  it('counts the open items and marks remembered sites, which alone can be forgotten', async () => {
    await openSettings({
      [SETTINGS_KEY]: { rememberedOrigins: [STAGING] },
      [collectionKey(LOCAL)]: withItems(LOCAL, `${LOCAL}/a`, 2),
    })
    const [local, staging] = rows()
    expect(byTestId('site-open-count', local!).textContent).toContain('2 open')
    expect(local!.querySelector('[data-testid="site-auto"]')).toBeNull()
    expect(local!.querySelector('[data-testid="remove-site"]')).toBeNull()
    expect(staging!.querySelector('[data-testid="site-open-count"]')).toBeNull()
    expect(byTestId('site-auto', staging!).textContent).toContain('Auto')
    byTestId('remove-site', staging!).click()
    await flushPromises()
    expect(fakeBrowser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'site:forget',
      origin: STAGING,
    })
  })

  it('opens a web site in a new tab from its address; local files have no address', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never)
    await openSettings({
      [collectionKey(LOCAL)]: withItems(LOCAL, `${LOCAL}/a`, 1),
      [collectionKey(FILES)]: withItems(FILES, 'file:///srv/a.html', 1),
    })
    const [files, local] = rows()
    expect(files!.querySelector('[data-testid="site-link"]')).toBeNull()
    const link = byTestId('site-link', local!)
    expect(link.title).toContain(LOCAL)
    link.click()
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ url: `${LOCAL}/` })
  })

  it('follows sites that get or lose feedback', async () => {
    await openSettings({})
    expect(document.body.textContent).toContain('No sites yet')
    await fakeBrowser.storage.local.set({
      [collectionKey(LOCAL)]: withItems(LOCAL, `${LOCAL}/`, 1),
    })
    await flushPromises()
    expect(rows()).toHaveLength(1)
    await fakeBrowser.storage.local.remove(collectionKey(LOCAL))
    await flushPromises()
    expect(rows()).toHaveLength(0)
  })

  it('renders no page data as HTML', async () => {
    await openSettings({ [collectionKey(LOCAL)]: withItems(LOCAL, `${LOCAL}/a`, 2) })
    expect(document.querySelector('main b')).toBeNull()
  })
})
