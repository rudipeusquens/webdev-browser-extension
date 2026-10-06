// The single writer of the collections, one per site (spec section 5). Messages arrive
// concurrently from every tab and the side panel; each one reads, changes and writes its site's
// collection, so they run strictly one after another.

import { browser } from 'wxt/browser'
import { splitLegacy } from '../collection/migrate'
import type { Collection } from '../collection/model'
import { addAnnotation, clearAll, markCopied, setStatus, updateComment } from '../collection/ops'
import { collectionKey, LEGACY_KEY, loadSite } from '../collection/store'
import { isLegacyCollection } from '../collection/validate'
import type { CollectionMessage, Reply } from '../messages'
import { applyStep, forgetHistory, loadHistory, saveHistory, stepBetween } from './history'

const GONE = 'This item no longer exists.'

/**
 * The collection after `msg`: the same one when nothing changes (an item in that state
 * already), a reason when the message cannot apply.
 */
function apply(c: Collection, msg: CollectionMessage, now: string): Collection | string {
  const exists = (id: string) => c.items.some((item) => item.id === id)
  const status = (id: string) => c.items.find((item) => item.id === id)?.status
  switch (msg.type) {
    case 'annotation:add': {
      const { id, page, target } = msg
      if (exists(id)) return 'This item already exists.'
      const next = addAnnotation(c, { id, page, target, comment: msg.comment.trim() }, now)
      return next === c ? 'This page belongs to another site.' : next
    }
    case 'annotation:update':
      return exists(msg.id) ? updateComment(c, msg.id, msg.comment.trim(), now) : GONE
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
      return clearAll(c)
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What Undo and Redo call the change `msg` made from `before` to `after`. */
function labelOf(msg: CollectionMessage, before: Collection, after: Collection): string {
  const item = (id: string) => {
    const found = after.items.find((i) => i.id === id) ?? before.items.find((i) => i.id === id)
    return `pin ${found?.number ?? ''}`.trim()
  }
  switch (msg.type) {
    case 'annotation:add':
      return `Add ${item(msg.id)}`
    case 'annotation:update':
      return `Edit ${item(msg.id)}`
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
      return done > 0 ? `Mark ${plural(done, 'pin')} done` : 'Copy as prompt'
    }
    case 'collection:clear':
      return 'Clear all'
  }
}

const isEmpty = (c: Collection) =>
  c.items.length === 0 &&
  Object.keys(c.pages).length === 0 &&
  c.nextNumber === 1 &&
  c.lastCopy.length === 0

/** An empty collection is the default: its key goes. */
async function save(c: Collection): Promise<void> {
  const key = collectionKey(c.site)
  if (isEmpty(c)) await browser.storage.local.remove(key)
  else await browser.storage.local.set({ [key]: c })
}

export function createWriter(now = () => new Date().toISOString()) {
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
      const next = applyStep(await loadSite(site), step, from === 'undo' ? 'before' : 'after')
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
        const current = await loadSite(site)
        const next = apply(current, msg, now())
        if (typeof next === 'string') return { ok: false, error: next }
        if (next === current) return { ok: true }
        await save(next)
        // The change is saved; a history that cannot be kept only loses its undo.
        await record(site, stepBetween(current, next, labelOf(msg, current, next))).catch(
          () => undefined,
        )
        return { ok: true }
      }).catch((): Reply => ({ ok: false, error: 'Could not save.' }))
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
