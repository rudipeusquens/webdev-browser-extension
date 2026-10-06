import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import type { Annotation, Status } from '@/lib/collection/model'
import { FILTERS, isView, loadView, shows, VIEW_KEY, watchView } from '@/lib/view'

const item = (status: Status) => ({ status }) as Annotation

describe('the view', () => {
  beforeEach(() => fakeBrowser.reset())

  it('shows open items until the developer chooses otherwise', async () => {
    expect(VIEW_KEY).toBe('view')
    expect(FILTERS).toEqual(['open', 'all', 'with-deleted'])
    expect(await loadView()).toEqual({ filter: 'open' })
    await fakeBrowser.storage.local.set({ [VIEW_KEY]: { filter: 'all' } })
    expect(await loadView()).toEqual({ filter: 'all' })
  })

  it.each([{ filter: 'done' }, { filter: 'all', extra: 1 }, 'all', null, {}])(
    'falls back to open for %j',
    async (stored) => {
      await fakeBrowser.storage.local.set({ [VIEW_KEY]: stored })
      expect(await loadView()).toEqual({ filter: 'open' })
      expect(isView(stored)).toBe(false)
    },
  )

  it('reports its own changes in local storage only', async () => {
    const seen = vi.fn()
    const stop = watchView(seen)
    await fakeBrowser.storage.session.set({ [VIEW_KEY]: { filter: 'all' } })
    await fakeBrowser.storage.local.set({ other: 1 })
    await fakeBrowser.storage.local.set({ [VIEW_KEY]: { filter: 'with-deleted' } })
    expect(seen.mock.calls).toEqual([[{ filter: 'with-deleted' }]])
    stop()
    await fakeBrowser.storage.local.set({ [VIEW_KEY]: { filter: 'all' } })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['open', [true, false, false]],
    ['all', [true, true, false]],
    ['with-deleted', [true, true, true]],
  ] as const)('%s shows open, done and deleted items: %j', (filter, expected) => {
    expect((['open', 'done', 'deleted'] as const).map((s) => shows(item(s), filter))).toEqual(
      expected,
    )
  })
})
