// Rec notes (spec section 8): what Rec in the panel dictated, kept for every site at once and
// listed above the pages. A note waiting for its transcript has no text yet, and its job's
// state; one that failed keeps the state until it is retried or deleted. Only the background
// writes them; nothing else reads them but the panel.

import { hasKeys, isAnnotationId, isText } from '../collection/validate'
import { isJobView, type JobView } from '../voice/jobs'
import { MAX_TEXT } from '../voice/protocol'

export type NoteJob = Exclude<JobView, { state: 'cut' }>

export interface Note {
  id: string
  /** The transcript as it is; empty while it is transcribed. */
  text: string
  createdAt: string
  job?: NoteJob
}

/** Oldest first. */
export interface Notes {
  version: 1
  items: Note[]
}

export const NOTES_KEY = 'notes'
/** Kept at most; the oldest go first. */
export const NOTE_LIMITS = { count: 50, bytes: 1_000_000 } as const

export const emptyNotes = (): Notes => ({ version: 1, items: [] })

export function isNote(x: unknown): x is Note {
  if (!hasKeys(x, ['id', 'text', 'createdAt'], ['job'])) return false
  const job = x.job
  return (
    isAnnotationId(x.id) &&
    isText(x.text, MAX_TEXT) &&
    isText(x.createdAt, 40, 1) &&
    (job === undefined ? (x.text as string).trim() !== '' : isJobView(job)) &&
    (job === undefined || (job as JobView).state !== 'cut')
  )
}

/** What of a stored value can be read: the well-formed notes, each id once, at most the limit. */
export function parseNotes(value: unknown): Notes {
  if (!hasKeys(value, ['version', 'items']) || value.version !== 1) return emptyNotes()
  if (!Array.isArray(value.items)) return emptyNotes()
  const seen = new Set<string>()
  const items = value.items.filter((note): note is Note => {
    if (!isNote(note) || seen.has(note.id)) return false
    seen.add(note.id)
    return true
  })
  return { version: 1, items: items.slice(-NOTE_LIMITS.count) }
}
