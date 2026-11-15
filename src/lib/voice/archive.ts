// The archive of the dictations (spec section 9): the text of every dictation that was
// transcribed, kept in this browser after its note or pin is long gone, so the developer can
// export all of it one day. In the extension origin's IndexedDB, in a database of its own: it
// grows without the limits of `chrome.storage`, and content scripts cannot open it. Only the
// background adds to it; the settings view counts, exports and deletes it. The overlay never
// imports this module (an ESLint rule guards that): there, `indexedDB` is the page's.

import { hasKeys, isCount, isText } from '../collection/validate'
import { isSite } from '../collection/site'
import { MAX_TEXT } from './protocol'
import { isLanguage, isModelId } from './settings'

export const ARCHIVE_DB = {
  name: 'webdev-browser-extension-archive',
  version: 1,
  store: 'dictations',
} as const

export interface ArchivedDictation {
  /** When its text arrived, as an ISO date. */
  at: string
  /** Where it went: Rec's note, or a pin's comment. */
  kind: 'note' | 'pin'
  /** The pin's site. */
  site?: string
  /** The text as it was kept: corrected, where the correction is on. */
  text: string
  /** The transcript as it came, when the correction changed it. */
  raw?: string
  /** The correction was asked for and failed. */
  uncorrected?: true
  /** How long the recording was, in milliseconds. */
  ms?: number
  /** The model that transcribed it, the language it was told, and the model that corrected it. */
  model: string
  language: string
  correctModel?: string
}

export function isArchivedDictation(x: unknown): x is ArchivedDictation {
  return (
    hasKeys(
      x,
      ['at', 'kind', 'text', 'model', 'language'],
      ['site', 'raw', 'uncorrected', 'ms', 'correctModel'],
    ) &&
    isText(x.at, 40, 1) &&
    (x.kind === 'note' || x.kind === 'pin') &&
    (x.site === undefined || isSite(x.site)) &&
    isText(x.text, MAX_TEXT, 1) &&
    (x.raw === undefined || isText(x.raw, MAX_TEXT, 1)) &&
    (x.uncorrected === undefined || x.uncorrected === true) &&
    (x.ms === undefined || isCount(x.ms)) &&
    isModelId(x.model) &&
    isLanguage(x.language) &&
    (x.correctModel === undefined || isModelId(x.correctModel))
  )
}

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

async function inStore<T>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const opening = indexedDB.open(ARCHIVE_DB.name, ARCHIVE_DB.version)
  opening.onupgradeneeded = () =>
    opening.result.createObjectStore(ARCHIVE_DB.store, { autoIncrement: true })
  const db = await done(opening)
  try {
    const tx = db.transaction(ARCHIVE_DB.store, mode)
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
    const result = await done(use(tx.objectStore(ARCHIVE_DB.store)))
    await committed
    return result
  } finally {
    db.close()
  }
}

/** Keeps one more dictation, after the others. */
export async function archiveDictation(entry: ArchivedDictation): Promise<void> {
  await inStore('readwrite', (store) => store.add(entry))
}

/** Every dictation that can be read, the oldest first. */
export async function loadArchive(): Promise<ArchivedDictation[]> {
  const all: unknown[] = await inStore('readonly', (store) => store.getAll())
  return all.filter(isArchivedDictation)
}

export async function countArchive(): Promise<number> {
  return inStore('readonly', (store) => store.count())
}

export async function clearArchive(): Promise<void> {
  await inStore('readwrite', (store) => store.clear())
}

/** What Export writes to a file. */
export interface ArchiveExport {
  version: 1
  exportedAt: string
  dictations: ArchivedDictation[]
}

export const exportOf = (dictations: ArchivedDictation[], now = new Date()): ArchiveExport => ({
  version: 1,
  exportedAt: now.toISOString(),
  dictations,
})

/** The export's file name: `dictations-2026-11-15.json`, by the local date. */
export function exportName(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `dictations-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.json`
}
