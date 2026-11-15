// The archive of the dictations (spec section 9): the text and the recording of every
// dictation that was transcribed, kept in this browser after its note or pin is long gone, so
// the developer can export all of it one day. In the extension origin's IndexedDB, in a
// database of its own: it grows without the limits of `chrome.storage`, and content scripts
// cannot open it. The background adds the texts, the offscreen recorder the recordings (it
// alone has them); the settings view counts, exports and deletes both. The overlay never
// imports this module (an ESLint rule guards that): there, `indexedDB` is the page's.

import { hasKeys, isAnnotationId, isCount, isText } from '../collection/validate'
import { isSite } from '../collection/site'
import { MAX_TEXT } from './protocol'
import { isLanguage, isModelId } from './settings'

export const ARCHIVE_DB = {
  name: 'webdev-browser-extension-archive',
  version: 2,
  /** The texts, in the order they came. */
  store: 'dictations',
  /** The recordings, by the id their text names (`audio`). */
  audio: 'audio',
} as const

type StoreName = typeof ARCHIVE_DB.store | typeof ARCHIVE_DB.audio

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
  /** The id of its recording in the archive, when that was kept. */
  audio?: string
}

/** A dictation's recording: its parts (WebM/Opus) in order, as their bytes. */
export interface ArchivedAudio {
  at: string
  parts: ArrayBuffer[]
  bytes: number
}

export function isArchivedDictation(x: unknown): x is ArchivedDictation {
  return (
    hasKeys(
      x,
      ['at', 'kind', 'text', 'model', 'language'],
      ['site', 'raw', 'uncorrected', 'ms', 'correctModel', 'audio'],
    ) &&
    (x.audio === undefined || isAnnotationId(x.audio)) &&
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
  name: StoreName,
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const opening = indexedDB.open(ARCHIVE_DB.name, ARCHIVE_DB.version)
  // Version 1 had the texts only.
  opening.onupgradeneeded = () => {
    const { objectStoreNames: names } = opening.result
    if (!names.contains(ARCHIVE_DB.store)) {
      opening.result.createObjectStore(ARCHIVE_DB.store, { autoIncrement: true })
    }
    if (!names.contains(ARCHIVE_DB.audio)) opening.result.createObjectStore(ARCHIVE_DB.audio)
  }
  const db = await done(opening)
  try {
    const tx = db.transaction(name, mode)
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
    const result = await done(use(tx.objectStore(name)))
    await committed
    return result
  } finally {
    db.close()
  }
}

/** Keeps one more dictation, after the others. */
export async function archiveDictation(entry: ArchivedDictation): Promise<void> {
  await inStore(ARCHIVE_DB.store, 'readwrite', (store) => store.add(entry))
}

/** Every dictation that can be read, the oldest first. */
export async function loadArchive(): Promise<ArchivedDictation[]> {
  const all: unknown[] = await inStore(ARCHIVE_DB.store, 'readonly', (store) => store.getAll())
  return all.filter(isArchivedDictation)
}

export async function countArchive(): Promise<number> {
  return inStore(ARCHIVE_DB.store, 'readonly', (store) => store.count())
}

const isAudio = (x: unknown): x is ArchivedAudio =>
  hasKeys(x, ['at', 'parts', 'bytes']) &&
  isText(x.at, 40, 1) &&
  isCount(x.bytes) &&
  Array.isArray(x.parts) &&
  x.parts.every((part) => part instanceof ArrayBuffer)

/** Keeps a dictation's recording under `id`, which its text will name. */
export async function archiveAudio(
  id: string,
  parts: ArrayBuffer[],
  at = new Date().toISOString(),
): Promise<void> {
  const bytes = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const record: ArchivedAudio = { at, parts, bytes }
  await inStore(ARCHIVE_DB.audio, 'readwrite', (store) => store.put(record, id))
}

/** The recording `id`, or nothing when it is not there or cannot be read. */
export async function loadAudio(id: string): Promise<ArchivedAudio | undefined> {
  const record: unknown = await inStore(ARCHIVE_DB.audio, 'readonly', (store) => store.get(id))
  return isAudio(record) ? record : undefined
}

/** How many bytes of recordings the archive holds. */
export async function audioBytes(): Promise<number> {
  let bytes = 0
  const opening = indexedDB.open(ARCHIVE_DB.name)
  const db = await done(opening)
  try {
    if (!db.objectStoreNames.contains(ARCHIVE_DB.audio)) return 0
    const cursor = db.transaction(ARCHIVE_DB.audio).objectStore(ARCHIVE_DB.audio).openCursor()
    await new Promise<void>((resolve, reject) => {
      cursor.onerror = () => reject(cursor.error)
      cursor.onsuccess = () => {
        const at = cursor.result
        if (!at) return resolve()
        const size = (at.value as { bytes?: unknown } | null)?.bytes
        if (isCount(size)) bytes += size
        at.continue()
      }
    })
  } finally {
    db.close()
  }
  return bytes
}

/** The texts and the recordings go. */
export async function clearArchive(): Promise<void> {
  await inStore(ARCHIVE_DB.store, 'readwrite', (store) => store.clear())
  await inStore(ARCHIVE_DB.audio, 'readwrite', (store) => store.clear())
}

/** A dictation as the export lists it: with the files of its recording in the ZIP. */
export type ExportedDictation = ArchivedDictation & { audioFiles?: string[] }

/** What Export writes as `dictations.json`. */
export interface ArchiveExport {
  version: 1
  exportedAt: string
  dictations: ExportedDictation[]
}

export const exportOf = (dictations: ExportedDictation[], now = new Date()): ArchiveExport => ({
  version: 1,
  exportedAt: now.toISOString(),
  dictations,
})

/** Where part `n` of the recording `id` lies in the export. */
export const audioFileName = (id: string, n: number) => `audio/${id}-${n + 1}.webm`

/**
 * The export's file name: `dictations-2026-11-15.zip`, by the local date; `-2`, `-3` for the
 * files after the first when the recordings do not fit one.
 */
export function exportName(now = new Date(), volume = 1): string {
  const two = (n: number) => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
  return `dictations-${day}${volume > 1 ? `-${volume}` : ''}.zip`
}

/** Most bytes of recordings in one exported file: each is built in memory. */
export const VOLUME_BYTES = 500_000_000

/**
 * The whole archive as ZIP files' entries, handed to `write` one file at a time: the
 * recordings as `audio/<id>-<n>.webm`, a new file whenever one is full, and `dictations.json`
 * in the last, naming each dictation's files.
 */
export async function exportArchive(
  write: (entries: { name: string; data: Uint8Array }[], volume: number) => Promise<void> | void,
  now = new Date(),
  volumeBytes = VOLUME_BYTES,
): Promise<void> {
  const dictations: ExportedDictation[] = []
  let entries: { name: string; data: Uint8Array }[] = []
  let bytes = 0
  let volume = 1
  for (const entry of await loadArchive()) {
    const audio = entry.audio ? await loadAudio(entry.audio).catch(() => undefined) : undefined
    if (!entry.audio || !audio) {
      dictations.push(entry)
      continue
    }
    const names: string[] = []
    for (const [n, part] of audio.parts.entries()) {
      if (bytes > 0 && bytes + part.byteLength > volumeBytes) {
        await write(entries, volume++)
        entries = []
        bytes = 0
      }
      const name = audioFileName(entry.audio, n)
      entries.push({ name, data: new Uint8Array(part) })
      bytes += part.byteLength
      names.push(name)
    }
    dictations.push({ ...entry, audioFiles: names })
  }
  const json = JSON.stringify(exportOf(dictations, now), null, 2)
  entries.push({ name: 'dictations.json', data: new TextEncoder().encode(json) })
  await write(entries, volume)
}
