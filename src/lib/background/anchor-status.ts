// Items that were not found when their page was last open: runtime state in
// `storage.session`, written by the background from the overlays' reports and read by the
// side panel for its "Not found" mark and the copied prompt. Content scripts cannot read it.

import { browser } from 'wxt/browser'
import { siteOf } from '../collection/site'
import { loadSites } from '../collection/store'
import { isAnnotationId } from '../collection/validate'
import type { AnchorMessage } from '../messages'
import { loadStored, watchStored } from '../storage'
import { serial } from './serial'

export const MISSING_KEY = 'missing'

const parse = (value: unknown): Set<string> =>
  new Set(Array.isArray(value) ? value.filter(isAnnotationId) : [])

export const loadMissing = (): Promise<Set<string>> => loadStored(MISSING_KEY, parse, 'session')

/** Calls `cb` with the new set whenever it changes; returns a function that stops. */
export const watchMissing = (cb: (missing: Set<string>) => void): (() => void) =>
  watchStored(MISSING_KEY, parse, cb, 'session')

/** Forgets these items, such as the items of a site that was cleared. */
export async function forgetMissing(ids: Iterable<string>): Promise<void> {
  const missing = await loadMissing()
  for (const id of ids) missing.delete(id)
  await browser.storage.session.set({ [MISSING_KEY]: [...missing] })
}

/**
 * Applies reports one at a time (several tabs report at once). A report changes only the
 * items of its own page, and ids of items that no longer exist are dropped.
 */
export function createAnchorStore() {
  const inOrder = serial()
  return (report: Omit<AnchorMessage, 'type'>): Promise<void> =>
    inOrder(async () => {
      const site = siteOf(report.pageKey)
      const sites = await loadSites()
      const items = sites.find((c) => c.site === site)?.items ?? []
      const onPage = new Set(
        items.filter((item) => item.pageKey === report.pageKey).map((item) => item.id),
      )
      const existing = new Set(sites.flatMap((c) => c.items.map((item) => item.id)))
      const missing = await loadMissing()
      for (const id of report.found) if (onPage.has(id)) missing.delete(id)
      for (const id of report.missing) if (onPage.has(id)) missing.add(id)
      const kept = [...missing].filter((id) => existing.has(id))
      await browser.storage.session.set({ [MISSING_KEY]: kept })
    })
}
