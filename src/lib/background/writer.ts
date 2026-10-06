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

  return {
    /** Applies `msg` to the collection of `site`. */
    write(site: string, msg: CollectionMessage): Promise<Reply> {
      return inOrder(async (): Promise<Reply> => {
        const current = await loadSite(site)
        const next = apply(current, msg, now())
        if (typeof next === 'string') return { ok: false, error: next }
        if (next !== current) await save(next)
        return { ok: true }
      }).catch((): Reply => ({ ok: false, error: 'Could not save.' }))
    },

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
