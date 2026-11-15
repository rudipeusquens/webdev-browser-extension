// Undo and redo of a deleted Rec note (spec sections 5 and 8), in `storage.session` like the
// sites' histories: gone with the browser session, readable by the panel, never by pages. A
// step holds the note that was deleted; undo puts it back, redo deletes it again.

import { isObject } from '../collection/validate'
import { isNote, type Note } from './model'

export const NOTES_HISTORY_KEY = 'notesHistory'
/** Kept at most each way, and in all; the oldest steps go first. */
export const NOTES_HISTORY_LIMITS = { steps: 20, bytes: 500_000 } as const
/** What the panel's Undo and Redo call the step. */
export const NOTE_STEP_LABEL = 'Delete note'

export interface NoteStep {
  note: Note
  /** When it was done (undo) or undone (redo): the panel's Undo takes the newest step. */
  at: number
}

export interface NotesHistory {
  undo: NoteStep[]
  redo: NoteStep[]
}

export const emptyNotesHistory = (): NotesHistory => ({ undo: [], redo: [] })

const isStep = (x: unknown): x is NoteStep =>
  isObject(x) && isNote(x.note) && typeof x.at === 'number' && Number.isFinite(x.at)

const steps = (x: unknown): NoteStep[] =>
  Array.isArray(x) ? x.filter(isStep).slice(-NOTES_HISTORY_LIMITS.steps) : []

/** What of a stored value can be read: the well-formed steps. */
export function parseNotesHistory(value: unknown): NotesHistory {
  if (!isObject(value)) return emptyNotesHistory()
  return { undo: steps(value.undo), redo: steps(value.redo) }
}
