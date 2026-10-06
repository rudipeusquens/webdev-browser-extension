// The developer's OpenRouter key (spec section 9), in the extension origin's IndexedDB:
// content scripts can read chrome.storage.local and receive its change events, but they cannot
// open this database. The background and the settings view read it; the overlay never
// imports this module (an ESLint rule in eslint.config.mjs guards that).

import { isApiKey } from './settings'

export { isApiKey }

/** Where the key lives: one record in one store of one database. */
export const KEY_DB = {
  name: 'webdev-browser-extension',
  version: 1,
  store: 'secrets',
  record: 'openrouterKey',
} as const

const PREFIX = 'sk-or-v1-'

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

async function inStore<T>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const opening = indexedDB.open(KEY_DB.name, KEY_DB.version)
  opening.onupgradeneeded = () => opening.result.createObjectStore(KEY_DB.store)
  const db = await done(opening)
  try {
    const tx = db.transaction(KEY_DB.store, mode)
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
    const result = await done(use(tx.objectStore(KEY_DB.store)))
    await committed
    return result
  } finally {
    db.close()
  }
}

export async function loadKey(): Promise<string | undefined> {
  const key: unknown = await inStore('readonly', (store) => store.get(KEY_DB.record))
  return isApiKey(key) ? key : undefined
}

export async function storeKey(key: string): Promise<void> {
  await inStore('readwrite', (store) => store.put(key, KEY_DB.record))
}

export async function deleteKey(): Promise<void> {
  await inStore('readwrite', (store) => store.delete(KEY_DB.record))
}

/** The key as the settings show it once saved: its prefix and the last four characters. */
export function maskKey(key: string): string {
  return `${key.startsWith(PREFIX) ? PREFIX : ''}…${key.slice(-4)}`
}
