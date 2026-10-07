// The single collection of milestones 2–5 becomes one collection per site (spec section 5):
// items keep their ids, numbers and data and become open; every site continues at the old
// nextNumber, so no number is given twice.

import type { Collection, LegacyCollection } from './model'
import { emptyCollection } from './ops'
import { siteOf } from './site'

export function splitLegacy(legacy: LegacyCollection): Collection[] {
  const sites = new Map<string, Collection>()
  for (const item of legacy.items) {
    const page = legacy.pages[item.pageKey]
    if (!page) continue
    const site = siteOf(item.pageKey)
    const c = sites.get(site) ?? { ...emptyCollection(site), nextNumber: legacy.nextNumber }
    c.pages[item.pageKey] = page
    c.items.push({ ...item, status: 'open' })
    sites.set(site, c)
  }
  return [...sites.values()].sort((a, b) => (a.site < b.site ? -1 : a.site > b.site ? 1 : 0))
}
