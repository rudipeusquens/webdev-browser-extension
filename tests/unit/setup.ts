import { IDBFactory } from 'fake-indexeddb'
import { beforeEach } from 'vitest'

// IndexedDB as extension pages and the service worker have it (happy-dom has none); each test
// starts with an empty one.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})
