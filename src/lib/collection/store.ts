// Read access to the stored collections, one per site (spec section 5). Only the background
// writes them (src/lib/background).

import { browser } from 'wxt/browser'
import type { Collection } from './model'
import { emptyCollection } from './ops'
import { isCollection } from './validate'

export const COLLECTION_PREFIX = 'collection:'
/** The single collection of milestones 2–5, split by site when the background starts. */
export const LEGACY_KEY = 'collection'

export const collectionKey = (site: string) => `${COLLECTION_PREFIX}${site}`

/** The stored collection of `site`, or an empty one: never another site's. */
function parse(site: string, value: unknown): Collection {
  return isCollection(value) && value.site === site ? value : emptyCollection(site)
}

export async function loadSite(site: string): Promise<Collection> {
  const key = collectionKey(site)
  const stored = await browser.storage.local.get(key)
  return parse(site, stored[key])
}

/** Calls `cb` with the site's new collection whenever it changes; returns a function that stops. */
export function watchSite(site: string, cb: (c: Collection) => void): () => void {
  const key = collectionKey(site)
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[key]
    if (area === 'local' && change) cb(parse(site, change.newValue))
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}

/** Every stored collection that is valid under its own key, by site. */
export async function loadSites(): Promise<Collection[]> {
  const stored = await browser.storage.local.get(null)
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(COLLECTION_PREFIX))
    .map(([, value]) => value)
    .filter((value): value is Collection => isCollection(value))
    .filter((c) => stored[collectionKey(c.site)] === c)
    .sort((a, b) => (a.site < b.site ? -1 : a.site > b.site ? 1 : 0))
}

/** Calls `cb` whenever the collection of any site changes; returns a function that stops. */
export function watchSites(cb: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(COLLECTION_PREFIX))) {
      cb()
    }
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}
