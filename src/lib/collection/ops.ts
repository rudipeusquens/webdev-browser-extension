// Pure operations on a collection. They never mutate their input; an operation that changes
// nothing returns the collection it was given.

import type { Annotation, Collection, PageInfo, Status, Target } from './model'
import { pageKey } from './page-key'
import { siteOf } from './site'

export interface NewAnnotation {
  id: string
  page: PageInfo
  target: Target
  comment: string
}

export interface PageGroup {
  key: string
  page: PageInfo
  items: Annotation[]
}

export function emptyCollection(site: string): Collection {
  return { version: 2, site, nextNumber: 1, pages: {}, items: [], lastCopy: [] }
}

/** Whether `url` is a page of the site `site`. */
function onSite(url: string, site: string): boolean {
  try {
    return siteOf(url) === site
  } catch {
    return false
  }
}

/** A new open item; nothing for an id that exists or a page of another site. */
export function addAnnotation(c: Collection, input: NewAnnotation, now: string): Collection {
  if (c.items.some((item) => item.id === input.id) || !onSite(input.page.url, c.site)) return c
  const key = pageKey(input.page.url)
  const item: Annotation = {
    id: input.id,
    number: c.nextNumber,
    pageKey: key,
    comment: input.comment,
    createdAt: now,
    updatedAt: now,
    status: 'open',
    target: input.target,
  }
  return {
    ...c,
    nextNumber: c.nextNumber + 1,
    pages: { ...c.pages, [key]: input.page },
    items: [...c.items, item],
  }
}

/**
 * A new comment; a done item whose comment changes is open again (spec section 5). The same
 * collection for an unknown id or the same text.
 */
export function updateComment(c: Collection, id: string, comment: string, now: string): Collection {
  const found = c.items.find((item) => item.id === id)
  if (!found || found.comment === comment) return c
  const status = found.status === 'done' ? 'open' : found.status
  return {
    ...c,
    items: c.items.map((item) =>
      item === found ? { ...item, comment, status, updatedAt: now } : item,
    ),
  }
}

/** The item's new status; the same collection for an unknown id or the status it has. */
export function setStatus(c: Collection, id: string, status: Status, now: string): Collection {
  const found = c.items.find((item) => item.id === id)
  if (!found || found.status === status) return c
  return {
    ...c,
    items: c.items.map((item) => (item === found ? { ...item, status, updatedAt: now } : item)),
  }
}

/**
 * "Copy as prompt" copied `ids`: those still open are done, and `lastCopy` holds the ids that
 * still exist, for "Copy again". Items added meanwhile stay open; deleted ones stay deleted.
 */
export function markCopied(c: Collection, ids: readonly string[], now: string): Collection {
  const copied = new Set(ids)
  const lastCopy = ids.filter((id) => c.items.some((item) => item.id === id))
  const opens = c.items.filter((item) => copied.has(item.id) && item.status === 'open')
  if (opens.length === 0 && lastCopy.join() === c.lastCopy.join()) return c
  return {
    ...c,
    lastCopy,
    items: c.items.map((item) =>
      opens.includes(item) ? { ...item, status: 'done', updatedAt: now } : item,
    ),
  }
}

/** The items with these ids and their pages, as a collection for the formatter. */
export function pick(c: Collection, ids: ReadonlySet<string>): Collection {
  const items = c.items.filter((item) => ids.has(item.id))
  const pages = Object.fromEntries(
    Object.entries(c.pages).filter(([key]) => items.some((item) => item.pageKey === key)),
  )
  return { ...c, pages, items }
}

/** Every item of the site goes, and its numbers start again at 1. */
export function clearAll(c: Collection): Collection {
  return emptyCollection(c.site)
}

/** Pages in the order of their first item, items by number. */
export function groupByPage(c: Collection): PageGroup[] {
  const groups = new Map<string, PageGroup>()
  for (const item of [...c.items].sort((a, b) => a.number - b.number)) {
    const page = c.pages[item.pageKey]
    if (!page) continue
    let group = groups.get(item.pageKey)
    if (!group) {
      group = { key: item.pageKey, page, items: [] }
      groups.set(item.pageKey, group)
    }
    group.items.push(item)
  }
  return [...groups.values()]
}
