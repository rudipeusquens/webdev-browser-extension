// Reading and watching one key of `storage.local`, parsed on every read: what a key holds is
// checked like any other input (spec section 11).

import { browser } from 'wxt/browser'

export async function loadStored<T>(key: string, parse: (value: unknown) => T): Promise<T> {
  return parse((await browser.storage.local.get(key))[key])
}

/** Calls `cb` with the key's new value whenever it changes; returns a function that stops. */
export function watchStored<T>(
  key: string,
  parse: (value: unknown) => T,
  cb: (value: T) => void,
): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[key]
    if (area === 'local' && change) cb(parse(change.newValue))
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}
