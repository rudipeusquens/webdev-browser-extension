// The single writer of the Rec notes (spec section 8). The background makes a note when Rec
// stops, fills it when the transcript arrives, and keeps what a pin could not hold; the panel
// deletes them, and may undo that (src/lib/notes/history.ts). Each change reads, changes and
// writes all of them, one after another.

import { newId } from '../ids'
import {
  type Note,
  type NoteJob,
  NOTE_LIMITS,
  NOTES_KEY,
  type Notes,
  parseNotes,
} from '../notes/model'
import {
  emptyNotesHistory,
  NOTES_HISTORY_KEY,
  NOTES_HISTORY_LIMITS,
  type NotesHistory,
  type NoteStep,
  parseNotesHistory,
} from '../notes/history'
import { jsonBytes, loadStored, setOrRemove } from '../storage'
import { interrupted } from '../voice/jobs'
import { serial } from './serial'

export type NotesWriter = ReturnType<typeof createNotes>

/** The notes within their limits: the oldest go, and their ids come back. */
function within(items: Note[]): { items: Note[]; evicted: string[] } {
  const kept = [...items]
  const evicted: string[] = []
  while (
    kept.length > 1 &&
    (kept.length > NOTE_LIMITS.count || jsonBytes({ version: 1, items: kept }) > NOTE_LIMITS.bytes)
  ) {
    const gone = kept.shift()
    if (gone) evicted.push(gone.id)
  }
  return { items: kept, evicted }
}

export function createNotes(now = () => new Date().toISOString(), clock = () => Date.now()) {
  const inOrder = serial()

  const read = () => loadStored(NOTES_KEY, parseNotes)

  async function save(n: Notes): Promise<void> {
    await setOrRemove(NOTES_KEY, n, n.items.length === 0)
  }

  const readHistory = () => loadStored(NOTES_HISTORY_KEY, parseNotesHistory, 'session')

  /** Keeps the steps within their limits, the oldest going first; a history lost loses only Undo. */
  async function saveHistory(h: NotesHistory): Promise<void> {
    let kept: NotesHistory = {
      undo: h.undo.slice(-NOTES_HISTORY_LIMITS.steps),
      redo: h.redo.slice(-NOTES_HISTORY_LIMITS.steps),
    }
    while (
      kept.undo.length + kept.redo.length > 0 &&
      jsonBytes(kept) > NOTES_HISTORY_LIMITS.bytes
    ) {
      kept =
        kept.undo.length > 0
          ? { ...kept, undo: kept.undo.slice(1) }
          : { ...kept, redo: kept.redo.slice(1) }
    }
    const empty = kept.undo.length + kept.redo.length === 0
    await setOrRemove(NOTES_HISTORY_KEY, kept, empty, 'session').catch(() =>
      setOrRemove(NOTES_HISTORY_KEY, emptyNotesHistory(), true, 'session').catch(() => undefined),
    )
  }

  const step = (note: Note): NoteStep => ({ note, at: clock() })

  /** Changes the note `id`; false when it is gone. */
  function change(id: string, next: (note: Note) => Note): Promise<boolean> {
    return inOrder(async () => {
      const n = await read()
      const found = n.items.find((note) => note.id === id)
      if (!found) return false
      await save({ ...n, items: n.items.map((note) => (note === found ? next(note) : note)) })
      return true
    })
  }

  return {
    /**
     * A new note, after the others. The oldest go while there are too many, or too much:
     * their ids come back with the new one's, so their jobs can end.
     */
    create(fields: { text?: string; job?: NoteJob }): Promise<{ id: string; evicted: string[] }> {
      return inOrder(async () => {
        const n = await read()
        const note: Note = { id: newId(), text: fields.text ?? '', createdAt: now() }
        if (fields.job) note.job = fields.job
        const { items, evicted } = within([...n.items, note])
        await save({ version: 1, items })
        return { id: note.id, evicted }
      })
    },

    /**
     * The transcript arrived, `uncorrected` when its correction failed; false when the note was
     * deleted meanwhile.
     */
    fill(id: string, text: string, uncorrected = false): Promise<boolean> {
      return change(id, (note) => ({
        id: note.id,
        text,
        createdAt: note.createdAt,
        ...(uncorrected && { uncorrected }),
      }))
    },

    /** Transcribing again, or failed. */
    mark(id: string, job: NoteJob): Promise<boolean> {
      return change(id, (note) => ({ ...note, job }))
    },

    /**
     * Deletes the note; false when it is gone already. One that has its text can be brought
     * back (`undo`); one still waiting for it goes for good, with its job.
     */
    remove(id: string): Promise<boolean> {
      return inOrder(async () => {
        const n = await read()
        const gone = n.items.find((note) => note.id === id)
        if (!gone) return false
        await save({ ...n, items: n.items.filter((note) => note !== gone) })
        if (gone.text && !gone.job) {
          const h = await readHistory()
          await saveHistory({ undo: [...h.undo, step(gone)], redo: [] })
        }
        return true
      })
    },

    /**
     * Puts the note deleted last back where it was by its time; `evicted`: the oldest notes
     * that went to make room. Null when there is nothing to undo.
     */
    undo(): Promise<{ evicted: string[] } | null> {
      return inOrder(async () => {
        const h = await readHistory()
        const last = h.undo.at(-1)
        if (!last) return null
        const n = await read()
        let evicted: string[] = []
        if (!n.items.some((note) => note.id === last.note.id)) {
          const after = n.items.findIndex((note) => note.createdAt > last.note.createdAt)
          const at = after === -1 ? n.items.length : after
          const next = within([...n.items.slice(0, at), last.note, ...n.items.slice(at)])
          evicted = next.evicted
          await save({ version: 1, items: next.items })
        }
        await saveHistory({ undo: h.undo.slice(0, -1), redo: [...h.redo, step(last.note)] })
        return { evicted }
      })
    },

    /** Deletes again the note the last undo put back; false when there is nothing to redo. */
    redo(): Promise<boolean> {
      return inOrder(async () => {
        const h = await readHistory()
        const last = h.redo.at(-1)
        if (!last) return false
        const n = await read()
        await save({ ...n, items: n.items.filter((note) => note.id !== last.note.id) })
        await saveHistory({ undo: [...h.undo, step(last.note)], redo: h.redo.slice(0, -1) })
        return true
      })
    },

    /**
     * The background started: no recorder runs, so nothing is transcribed and no audio is
     * held any more.
     */
    interrupt(): Promise<void> {
      return inOrder(async () => {
        const n = await read()
        let changed = false
        const items = n.items.map((note): Note => {
          const job = note.job && interrupted(note.job)
          if (job === note.job) return note
          changed = true
          return { ...note, job }
        })
        if (changed) await save({ ...n, items })
      }).catch(() => undefined)
    },
  }
}
