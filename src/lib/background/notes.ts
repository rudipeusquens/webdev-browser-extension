// The single writer of the Rec notes (spec section 8). The background makes a note when Rec
// stops, fills it when the transcript arrives, and keeps what a pin could not hold; the panel
// deletes them. Each change reads, changes and writes all of them, one after another.

import { browser } from 'wxt/browser'
import { newId } from '../ids'
import {
  type Note,
  type NoteJob,
  NOTE_LIMITS,
  NOTES_KEY,
  type Notes,
  parseNotes,
} from '../notes/model'
import { loadStored } from '../storage'

const bytes = (n: Notes) => new TextEncoder().encode(JSON.stringify(n)).length

export type NotesWriter = ReturnType<typeof createNotes>

export function createNotes(now = () => new Date().toISOString()) {
  let queue: Promise<unknown> = Promise.resolve()

  function inOrder<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  const read = () => loadStored(NOTES_KEY, parseNotes)

  async function save(n: Notes): Promise<void> {
    if (n.items.length === 0) await browser.storage.local.remove(NOTES_KEY)
    else await browser.storage.local.set({ [NOTES_KEY]: n })
  }

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
        const items = [...n.items, note]
        const evicted: string[] = []
        while (
          items.length > 1 &&
          (items.length > NOTE_LIMITS.count || bytes({ version: 1, items }) > NOTE_LIMITS.bytes)
        ) {
          const gone = items.shift()
          if (gone) evicted.push(gone.id)
        }
        await save({ version: 1, items })
        return { id: note.id, evicted }
      })
    },

    /** The transcript arrived; false when the note was deleted meanwhile. */
    fill(id: string, text: string): Promise<boolean> {
      return change(id, (note) => ({ id: note.id, text, createdAt: note.createdAt }))
    },

    /** Transcribing again, or failed. */
    mark(id: string, job: NoteJob): Promise<boolean> {
      return change(id, (note) => ({ ...note, job }))
    },

    remove(id: string): Promise<boolean> {
      return inOrder(async () => {
        const n = await read()
        const items = n.items.filter((note) => note.id !== id)
        if (items.length === n.items.length) return false
        await save({ ...n, items })
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
          const job = note.job
          if (!job || (job.state === 'failed' && !job.retry)) return note
          changed = true
          const error = job.state === 'failed' ? job.error : 'lost'
          return { ...note, job: { ...job, state: 'failed', error, retry: false } as NoteJob }
        })
        if (changed) await save({ ...n, items })
      }).catch(() => undefined)
    },
  }
}
