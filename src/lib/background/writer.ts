// The single writer of the collections, one per site (spec section 5). Messages arrive
// concurrently from every tab and the side panel; each one reads, changes and writes its site's
// collection, so they run strictly one after another.

import { browser } from 'wxt/browser'
import { splitLegacy } from '../collection/migrate'
import type { Collection } from '../collection/model'
import {
  addAnnotation,
  clearAll,
  emptyBin,
  fillTranscript,
  markCopied,
  setStatus,
  updateComment,
} from '../collection/ops'
import { collectionKey, LEGACY_KEY, readSite, unreadableKey } from '../collection/store'
import { isLegacyCollection } from '../collection/validate'
import type { CollectionMessage, Reply } from '../messages'
import { applyStep, forgetHistory, loadHistory, saveHistory, stepBetween } from './history'

const GONE = 'This pin no longer exists.'

/**
 * The collection after `msg`: the same one when nothing changes (an item in that state
 * already), a reason when the message cannot apply.
 */
function apply(c: Collection, msg: CollectionMessage, now: string): Collection | string {
  const exists = (id: string) => c.items.some((item) => item.id === id)
  const status = (id: string) => c.items.find((item) => item.id === id)?.status
  switch (msg.type) {
    case 'annotation:add': {
      const { id, page, target, draft } = msg
      if (exists(id)) return 'This pin already exists.'
      const next = addAnnotation(c, { id, page, target, comment: msg.comment.trim(), draft }, now)
      return next === c ? 'This page belongs to another site.' : next
    }
    case 'annotation:update':
      if (!exists(msg.id)) return GONE
      return updateComment(c, msg.id, msg.comment.trim(), now, { keep: msg.keep })
    case 'annotation:remove':
      return exists(msg.id) ? setStatus(c, msg.id, 'deleted', now) : GONE
    case 'annotation:restore':
      if (!exists(msg.id)) return GONE
      return status(msg.id) === 'deleted' ? setStatus(c, msg.id, 'open', now) : c
    case 'annotation:reopen':
      if (!exists(msg.id)) return GONE
      return status(msg.id) === 'done' ? setStatus(c, msg.id, 'open', now) : c
    case 'collection:copied':
      return markCopied(c, msg.ids, now)
    case 'collection:clear':
      return clearAll(c, now)
    case 'collection:empty-bin':
      return emptyBin(c)
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What Undo and Redo call the change `msg` made from `before` to `after`. */
function labelOf(msg: CollectionMessage, before: Collection, after: Collection): string {
  const item = (id: string) => {
    const found = after.items.find((i) => i.id === id) ?? before.items.find((i) => i.id === id)
    return `${found?.draft ? 'draft' : 'pin'} ${found?.number ?? ''}`.trim()
  }
  switch (msg.type) {
    case 'annotation:add':
      return `Add ${item(msg.id)}`
    case 'annotation:update': {
      const was = before.items.find((i) => i.id === msg.id)
      const is = after.items.find((i) => i.id === msg.id)
      return was?.draft && !is?.draft ? `Save ${item(msg.id)}` : `Edit ${item(msg.id)}`
    }
    case 'annotation:remove':
      return `Delete ${item(msg.id)}`
    case 'annotation:restore':
      return `Restore ${item(msg.id)}`
    case 'annotation:reopen':
      return `Reopen ${item(msg.id)}`
    case 'collection:copied': {
      const done = after.items.filter(
        (i) => i.status === 'done' && before.items.find((b) => b.id === i.id)?.status === 'open',
      ).length
      if (done === 1 && msg.ids.length === 1) return `Copy ${item(msg.ids[0] ?? '')}`
      return done > 0 ? `Mark ${plural(done, 'pin')} done` : 'Copy as prompt'
    }
    case 'collection:clear':
      return 'Clear all'
    case 'collection:empty-bin':
      return 'Empty bin'
  }
}

const isEmpty = (c: Collection) =>
  c.items.length === 0 &&
  Object.keys(c.pages).length === 0 &&
  c.nextNumber === 1 &&
  c.lastCopy.length === 0

/**
 * The collection of `site` to change. A stored value that no longer validated as it was is
 * copied aside first, once: the change then builds on what of it could be read, and nothing
 * of it is lost.
 */
async function current(site: string): Promise<Collection> {
  const { collection, unreadable } = await readSite(site)
  if (unreadable !== undefined) {
    const key = unreadableKey(site)
    const kept = (await browser.storage.local.get(key))[key]
    if (kept === undefined) await browser.storage.local.set({ [key]: unreadable })
  }
  return collection
}

/** An empty collection is the default: its key goes. */
async function save(c: Collection): Promise<void> {
  const key = collectionKey(c.site)
  if (isEmpty(c)) await browser.storage.local.remove(key)
  else await browser.storage.local.set({ [key]: c })
}

/** What became of a dictation's text (`fill`). */
export type Filled = { ok: true; rest?: string; part?: true } | { ok: false; error: string }

/** Most UTF-8 bytes one site's collection may take: each save writes all of it. */
export const SITE_BUDGET = 4_000_000

const byteSize = (c: Collection) => new TextEncoder().encode(JSON.stringify(c)).length

export function createWriter(
  now = () => new Date().toISOString(),
  { siteBudget = SITE_BUDGET }: { siteBudget?: number } = {},
) {
  let queue: Promise<unknown> = Promise.resolve()

  function inOrder<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  /** A new change: one more undo step, and nothing left to redo. */
  async function record(site: string, step: ReturnType<typeof stepBetween>): Promise<void> {
    if (!step) return
    const h = await loadHistory(site)
    await saveHistory(site, { undo: [...h.undo, step], redo: [] })
  }

  function move(site: string, from: 'undo' | 'redo'): Promise<Reply> {
    const to = from === 'undo' ? 'redo' : 'undo'
    return inOrder(async (): Promise<Reply> => {
      const h = await loadHistory(site)
      const step = h[from].at(-1)
      if (!step) return { ok: false, error: `Nothing to ${from}.` }
      const next = applyStep(await current(site), step, from === 'undo' ? 'before' : 'after')
      if (!next) {
        await forgetHistory(site)
        const done = from === 'undo' ? 'undone' : 'redone'
        return { ok: false, error: `This changed in the meantime; it can no longer be ${done}.` }
      }
      await save(next)
      await saveHistory(site, { ...h, [from]: h[from].slice(0, -1), [to]: [...h[to], step] })
      return { ok: true }
    }).catch((): Reply => ({ ok: false, error: 'Could not save.' }))
  }

  return {
    /** Applies `msg` to the collection of `site`. */
    write(site: string, msg: CollectionMessage): Promise<Reply> {
      return inOrder(async (): Promise<Reply> => {
        const before = await current(site)
        const next = apply(before, msg, now())
        if (typeof next === 'string') return { ok: false, error: next }
        if (next === before) return { ok: true }
        // A new pin or a longer comment must fit the site's budget; every other change frees room.
        const grows = msg.type === 'annotation:add' || msg.type === 'annotation:update'
        if (grows && byteSize(next) > siteBudget) {
          return {
            ok: false,
            error: 'This site holds too much feedback: empty its bin or delete pins first.',
          }
        }
        await save(next)
        // The change is saved; a history that cannot be kept only loses its undo.
        await record(site, stepBetween(before, next, labelOf(msg, before, next))).catch(
          () => undefined,
        )
        return { ok: true }
      }).catch((): Reply => ({ ok: false, error: 'Could not save.' }))
    },

    /**
     * Puts a dictation's text after the comment of the pin `id` (spec section 9): one undo
     * step. `rest` is the whole text when it did not all go in (the pin is gone, the comment
     * limit cut it, the site is full); the caller keeps it elsewhere. `part`: the pin got
     * what fit of it.
     */
    fill(site: string, id: string, text: string): Promise<Filled> {
      return inOrder(async (): Promise<Filled> => {
        const before = await current(site)
        const { collection: next, rest } = fillTranscript(before, id, text, now())
        if (next === before) return rest === undefined ? { ok: true } : { ok: true, rest }
        // The pin gets none of it; it says where the text went, as for a cut.
        if (byteSize(next) > siteBudget) return { ok: true, rest: text, part: true }
        await save(next)
        const number = next.items.find((i) => i.id === id)?.number ?? ''
        await record(site, stepBetween(before, next, `Dictation into pin ${number}`)).catch(
          () => undefined,
        )
        return rest === undefined ? { ok: true } : { ok: true, rest, part: true }
      }).catch((): Filled => ({ ok: false, error: 'Could not save.' }))
    },

    /** Puts back what the site's last change changed. */
    undo: (site: string) => move(site, 'undo'),
    /** Applies again what the last undo put back. */
    redo: (site: string) => move(site, 'redo'),

    /**
     * Splits the collection of milestones 2–5 by site, before any write that comes after it.
     * A site that has a collection already keeps it; an unreadable old collection goes.
     */
    migrate(): Promise<void> {
      return inOrder(async () => {
        const stored = (await browser.storage.local.get(LEGACY_KEY))[LEGACY_KEY]
        if (stored === undefined) return
        if (isLegacyCollection(stored)) {
          const sites = splitLegacy(stored)
          const existing = await browser.storage.local.get(sites.map((c) => collectionKey(c.site)))
          const fresh = sites.filter((c) => existing[collectionKey(c.site)] === undefined)
          if (fresh.length > 0) {
            await browser.storage.local.set(
              Object.fromEntries(fresh.map((c) => [collectionKey(c.site), c])),
            )
          }
        }
        await browser.storage.local.remove(LEGACY_KEY)
      }).catch(() => undefined)
    },
  }
}
