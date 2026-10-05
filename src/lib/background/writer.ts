// The single writer of the collection. Messages arrive concurrently from every tab and the
// side panel; each one reads, changes and writes storage, so they run strictly one after another.

import { browser } from 'wxt/browser'
import type { Collection } from '../collection/model'
import { addAnnotation, clearAll, removeAnnotation, updateComment } from '../collection/ops'
import { COLLECTION_KEY, loadCollection } from '../collection/store'
import type { BackgroundMessage, Reply } from '../messages'

function apply(c: Collection, msg: BackgroundMessage, now: string): Collection | string {
  switch (msg.type) {
    case 'annotation:add': {
      const { id, page, target } = msg
      const next = addAnnotation(c, { id, page, target, comment: msg.comment.trim() }, now)
      return next === c ? 'This item already exists.' : next
    }
    case 'annotation:update': {
      const next = updateComment(c, msg.id, msg.comment.trim(), now)
      return next === c ? 'This item no longer exists.' : next
    }
    case 'annotation:remove': {
      const next = removeAnnotation(c, msg.id)
      return next === c ? 'This item no longer exists.' : next
    }
    case 'collection:clear':
      return clearAll()
  }
}

export function createWriter(now = () => new Date().toISOString()) {
  let queue: Promise<unknown> = Promise.resolve()
  return (msg: BackgroundMessage): Promise<Reply> => {
    const run = queue.then(async (): Promise<Reply> => {
      const next = apply(await loadCollection(), msg, now())
      if (typeof next === 'string') return { ok: false, error: next }
      await browser.storage.local.set({ [COLLECTION_KEY]: next })
      return { ok: true }
    })
    queue = run.catch(() => undefined)
    return run.catch((): Reply => ({ ok: false, error: 'Could not save.' }))
  }
}
