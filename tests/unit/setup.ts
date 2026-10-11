import { fakeBrowser } from 'wxt/testing/fake-browser'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach } from 'vitest'

// IndexedDB as extension pages and the service worker have it (happy-dom has none); each test
// starts with an empty one, and with an empty fake browser (storage, tabs, runtime state).
beforeEach(() => {
  fakeBrowser.reset()
  globalThis.indexedDB = new IDBFactory()
})
