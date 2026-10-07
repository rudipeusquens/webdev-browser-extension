// Undo and redo (spec section 5): every change of a site's collection is one step in that
// site's history in storage.session (content scripts cannot read it), with a small entry of
// labels for the panel's buttons. A step holds what it changed, before and after; undo puts
// the before side back only where the collection still looks like the after side.

import { browser } from 'wxt/browser'
import type { Annotation, Collection, PageInfo } from '../collection/model'

export const HISTORY_LIMIT = 50
/**
 * Most characters of one site's history: storage.session (10 MB) also holds the missing items,
 * the tab status and the panel's view, which must always find room.
 */
export const HISTORY_BYTES = 1_000_000
export const HISTORY_PREFIX = 'history:'
export const LABELS_PREFIX = 'historyLabels:'

export interface Step {
  /** What the panel's tooltip names: "Delete item 3", "Mark 4 items done", "Clear all". */
  label: string
  items: { id: string; before?: Annotation; after?: Annotation }[]
  pages: { key: string; before?: PageInfo; after?: PageInfo }[]
  nextNumber: [number, number]
  lastCopy: [string[], string[]]
}

export interface History {
  undo: Step[]
  redo: Step[]
}

export interface Labels {
  undo?: string
  redo?: string
}

type Side = 'before' | 'after'

/** Deep equality of plain data, whatever the order of keys. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every((k) => same(x[k], y[k]))
}

/** What changed from `before` to `after`; null when nothing did. */
export function stepBetween(before: Collection, after: Collection, label: string): Step | null {
  const items: Step['items'] = []
  const ids = new Set([...before.items, ...after.items].map((item) => item.id))
  for (const id of ids) {
    const was = before.items.find((item) => item.id === id)
    const is = after.items.find((item) => item.id === id)
    if (!same(was, is)) items.push({ id, ...(was && { before: was }), ...(is && { after: is }) })
  }
  const pages: Step['pages'] = []
  for (const key of new Set([...Object.keys(before.pages), ...Object.keys(after.pages)])) {
    const was = before.pages[key]
    const is = after.pages[key]
    if (!same(was, is)) pages.push({ key, ...(was && { before: was }), ...(is && { after: is }) })
  }
  const unchanged =
    items.length === 0 &&
    pages.length === 0 &&
    before.nextNumber === after.nextNumber &&
    same(before.lastCopy, after.lastCopy)
  if (unchanged) return null
  return {
    label,
    items,
    pages,
    nextNumber: [before.nextNumber, after.nextNumber],
    lastCopy: [before.lastCopy, after.lastCopy],
  }
}

/**
 * The collection with the step's `to` side put in place; null when the collection does not
 * look like the step's other side, where the step would overwrite a change it does not know.
 */
export function applyStep(c: Collection, step: Step, to: Side): Collection | null {
  const from: Side = to === 'before' ? 'after' : 'before'
  const index = to === 'before' ? 0 : 1
  const other = 1 - index
  if (c.nextNumber !== step.nextNumber[other] || !same(c.lastCopy, step.lastCopy[other])) {
    return null
  }
  const items = new Map(c.items.map((item) => [item.id, item]))
  for (const change of step.items) {
    if (!same(items.get(change.id), change[from])) return null
    const next = change[to]
    if (next) items.set(change.id, next)
    else items.delete(change.id)
  }
  const pages = { ...c.pages }
  for (const change of step.pages) {
    if (!same(pages[change.key], change[from])) return null
    const next = change[to]
    if (next) pages[change.key] = next
    else delete pages[change.key]
  }
  return {
    ...c,
    nextNumber: step.nextNumber[index],
    lastCopy: step.lastCopy[index],
    pages,
    items: [...items.values()].sort((a, b) => a.number - b.number),
  }
}

const historyKey = (site: string) => `${HISTORY_PREFIX}${site}`
const labelsKey = (site: string) => `${LABELS_PREFIX}${site}`

const isHistory = (x: unknown): x is History =>
  typeof x === 'object' &&
  x !== null &&
  Array.isArray((x as History).undo) &&
  Array.isArray((x as History).redo)

export async function loadHistory(site: string): Promise<History> {
  const stored = (await browser.storage.session.get(historyKey(site)))[historyKey(site)]
  return isHistory(stored) ? stored : { undo: [], redo: [] }
}

export const labelsOf = (h: History): Labels => ({
  ...(h.undo.length > 0 && { undo: h.undo.at(-1)?.label }),
  ...(h.redo.length > 0 && { redo: h.redo.at(-1)?.label }),
})

/** The history without its oldest step: an undo step first, then a redo step. */
const withoutOldest = (h: History): History =>
  h.undo.length > 1 || h.redo.length === 0
    ? { ...h, undo: h.undo.slice(1) }
    : { ...h, redo: h.redo.slice(1) }

/**
 * Keeps the history and its labels: at most HISTORY_LIMIT steps each way and HISTORY_BYTES in
 * all, the oldest steps going first; when storage.session is full anyway, more of them go, one
 * at a time. When not even one step fits, the site's history is forgotten.
 */
export async function saveHistory(site: string, h: History): Promise<void> {
  let kept: History = {
    undo: h.undo.slice(-HISTORY_LIMIT),
    redo: h.redo.slice(-HISTORY_LIMIT),
  }
  while (kept.undo.length + kept.redo.length > 0 && JSON.stringify(kept).length > HISTORY_BYTES) {
    kept = withoutOldest(kept)
  }
  if (kept.undo.length + kept.redo.length === 0) return forgetHistory(site)
  for (;;) {
    try {
      await browser.storage.session.set({
        [historyKey(site)]: kept,
        [labelsKey(site)]: labelsOf(kept),
      })
      return
    } catch {
      if (kept.undo.length + kept.redo.length <= 1) break
      kept = withoutOldest(kept)
    }
  }
  await forgetHistory(site)
}

export async function forgetHistory(site: string): Promise<void> {
  await browser.storage.session.remove([historyKey(site), labelsKey(site)])
}

/** What the panel's Undo and Redo name for `site`. */
export async function loadLabels(site: string): Promise<Labels> {
  const stored = (await browser.storage.session.get(labelsKey(site)))[labelsKey(site)]
  if (typeof stored !== 'object' || stored === null) return {}
  const { undo, redo } = stored as Labels
  return {
    ...(typeof undo === 'string' && { undo }),
    ...(typeof redo === 'string' && { redo }),
  }
}

/** Calls `cb` with the site's labels whenever they change; returns a function that stops. */
export function watchLabels(site: string, cb: (labels: Labels) => void): () => void {
  const key = labelsKey(site)
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'session' && key in changes) void loadLabels(site).then(cb)
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}
