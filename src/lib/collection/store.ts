// Read access to the stored collection. Only the background writes it (src/lib/background).

import { browser } from 'wxt/browser'
import type { Collection } from './model'
import { emptyCollection } from './ops'
import { isCollection } from './validate'

export const COLLECTION_KEY = 'collection'

const parse = (value: unknown): Collection => (isCollection(value) ? value : emptyCollection())

export async function loadCollection(): Promise<Collection> {
  const stored = await browser.storage.local.get(COLLECTION_KEY)
  return parse(stored[COLLECTION_KEY])
}

/** Calls `cb` with the new collection whenever it changes; returns a function that stops. */
export function watchCollection(cb: (c: Collection) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[COLLECTION_KEY]
    if (area === 'local' && change) cb(parse(change.newValue))
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}
