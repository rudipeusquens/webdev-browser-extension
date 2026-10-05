// Pure operations on a collection. They never mutate their input; an operation that changes
// nothing returns the collection it was given.

import type { Annotation, Collection, PageInfo, Target } from './model'
import { pageKey } from './page-key'

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

export function emptyCollection(): Collection {
  return { version: 1, nextNumber: 1, pages: {}, items: [] }
}

export function addAnnotation(c: Collection, input: NewAnnotation, now: string): Collection {
  if (c.items.some((item) => item.id === input.id)) return c
  const key = pageKey(input.page.url)
  const item: Annotation = {
    id: input.id,
    number: c.nextNumber,
    pageKey: key,
    comment: input.comment,
    createdAt: now,
    updatedAt: now,
    target: input.target,
  }
  return {
    ...c,
    nextNumber: c.nextNumber + 1,
    pages: { ...c.pages, [key]: input.page },
    items: [...c.items, item],
  }
}

export function updateComment(c: Collection, id: string, comment: string, now: string): Collection {
  if (!c.items.some((item) => item.id === id)) return c
  return {
    ...c,
    items: c.items.map((item) => (item.id === id ? { ...item, comment, updatedAt: now } : item)),
  }
}

export function removeAnnotation(c: Collection, id: string): Collection {
  const removed = c.items.find((item) => item.id === id)
  if (!removed) return c
  const items = c.items.filter((item) => item !== removed)
  const pages = { ...c.pages }
  if (!items.some((item) => item.pageKey === removed.pageKey)) delete pages[removed.pageKey]
  return { ...c, pages, items }
}

export function clearAll(): Collection {
  return emptyCollection()
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
