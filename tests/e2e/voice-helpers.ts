import { KEY_DB } from '../../src/lib/voice/key'
import { serviceWorker, type Session } from './harness'

/**
 * Stores (or, with null, deletes) the OpenRouter key where the extension keeps it: the
 * extension origin's IndexedDB, written here from the service worker.
 */
export async function setKey(s: Session, key: string | null): Promise<void> {
  const worker = await serviceWorker(s)
  await worker.evaluate(
    async (k: string | null, db: typeof KEY_DB) => {
      const opening = indexedDB.open(db.name, db.version)
      opening.onupgradeneeded = () => opening.result.createObjectStore(db.store)
      const open = await new Promise<IDBDatabase>((done, fail) => {
        opening.onsuccess = () => done(opening.result)
        opening.onerror = () => fail(opening.error)
      })
      const tx = open.transaction(db.store, 'readwrite')
      if (k === null) tx.objectStore(db.store).delete(db.record)
      else tx.objectStore(db.store).put(k, db.record)
      await new Promise((done) => (tx.oncomplete = done))
      open.close()
    },
    key,
    KEY_DB,
  )
}
