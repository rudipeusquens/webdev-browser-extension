// Read access to the stored collections, one per site (spec section 5). Only the background
// writes them (src/lib/background).

import { browser } from 'wxt/browser'
import type { Annotation, Collection, PageInfo } from './model'
import { emptyCollection } from './ops'
import { belongsTo, isAnnotation, isCollection, isIdList, isObject, isPageInfo } from './validate'

export const COLLECTION_PREFIX = 'collection:'
/** The single collection of milestones 2–5, split by site when the background starts. */
export const LEGACY_KEY = 'collection'

export const collectionKey = (site: string) => `${COLLECTION_PREFIX}${site}`
/** Where the background keeps, once, a stored collection that no longer validated as it was. */
export const unreadableKey = (site: string) => `collection-unreadable:${site}`

/**
 * The pins of a stored collection that no longer validates as a whole (stored with other
 * limits, or damaged) that still validate, with their pages, numbering and last copy; empty
 * when nothing of it can be read.
 */
function salvage(site: string, value: unknown): Collection {
  const empty = emptyCollection(site)
  // Another site's collection under this key is not this site's.
  if (!isObject(value) || value.site !== site || !Array.isArray(value.items)) return empty
  const storedPages = isObject(value.pages) ? value.pages : {}
  const pages: Record<string, PageInfo> = {}
  const items: Annotation[] = []
  const ids = new Set<string>()
  const numbers = new Set<number>()
  for (const item of value.items) {
    if (!isAnnotation(item) || !belongsTo(item.pageKey, site)) continue
    if (ids.has(item.id) || numbers.has(item.number)) continue
    const page = storedPages[item.pageKey]
    if (!isPageInfo(page)) continue
    ids.add(item.id)
    numbers.add(item.number)
    pages[item.pageKey] = page
    items.push(item)
  }
  const highest = Math.max(0, ...numbers)
  const stored = typeof value.nextNumber === 'number' ? value.nextNumber : 1
  const salvaged: Collection = {
    version: 2,
    site,
    nextNumber: Math.max(stored, highest + 1),
    pages,
    items,
    lastCopy: isIdList(value.lastCopy, Infinity) ? value.lastCopy.filter((id) => ids.has(id)) : [],
  }
  return isCollection(salvaged) ? salvaged : empty
}

/** The stored collection of `site`, what of it is readable, or an empty one: never another site's. */
function parse(site: string, value: unknown): Collection {
  if (isCollection(value) && value.site === site) return value
  return value === undefined ? emptyCollection(site) : salvage(site, value)
}

/**
 * The stored collection of `site`, and the stored value itself when it did not validate as it
 * was (the collection then holds what of it could be read).
 */
export async function readSite(
  site: string,
): Promise<{ collection: Collection; unreadable?: unknown }> {
  const key = collectionKey(site)
  const value = (await browser.storage.local.get(key))[key]
  const collection = parse(site, value)
  return collection === value || value === undefined
    ? { collection }
    : { collection, unreadable: value }
}

export async function loadSite(site: string): Promise<Collection> {
  return (await readSite(site)).collection
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

/** Every stored collection with pins, by site, as far as it can be read (`parse`). */
export async function loadSites(): Promise<Collection[]> {
  const stored = await browser.storage.local.get(null)
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(COLLECTION_PREFIX))
    .map(([key, value]) => parse(key.slice(COLLECTION_PREFIX.length), value))
    .filter((c) => c.items.length > 0)
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
