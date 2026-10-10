// Reading and watching one key of `storage.local` (or `storage.session`), parsed on every read:
// what a key holds is checked like any other input (spec section 11).

import { browser } from 'wxt/browser'

export async function loadStored<T>(
  key: string,
  parse: (value: unknown) => T,
  area: 'local' | 'session' = 'local',
): Promise<T> {
  return parse((await browser.storage[area].get(key))[key])
}

/** Calls `cb` with the key's new value whenever it changes; returns a function that stops. */
export function watchStored<T>(
  key: string,
  parse: (value: unknown) => T,
  cb: (value: T) => void,
  area: 'local' | 'session' = 'local',
): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, storageArea: string) => {
    const change = changes[key]
    if (storageArea === area && change) cb(parse(change.newValue))
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}

/** The UTF-8 bytes of `x` as JSON: what the storage budgets count. */
export const jsonBytes = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length

/** Removes `key` when `empty` (an empty value is the default), otherwise stores `value`. */
export async function setOrRemove(key: string, value: unknown, empty: boolean): Promise<void> {
  if (empty) await browser.storage.local.remove(key)
  else await browser.storage.local.set({ [key]: value })
}
