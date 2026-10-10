// Which items the panel lists and the pages pin (spec section 5): one choice for every site,
// kept in storage.local under its own key. The panel asks the background to write it.

import { hasKeys } from './collection/validate'
import { loadStored, watchStored } from './storage'
import type { Annotation } from './collection/model'

export const VIEW_KEY = 'view'

/** `all`: open and done; `with-deleted`: everything. */
export type Filter = 'open' | 'all' | 'with-deleted'
export const FILTERS: readonly Filter[] = ['open', 'all', 'with-deleted']

export interface View {
  filter: Filter
}

export const isFilter = (x: unknown): x is Filter => FILTERS.includes(x as Filter)

export function isView(x: unknown): x is View {
  return hasKeys(x, ['filter']) && isFilter(x.filter)
}

const parse = (value: unknown): View => (isView(value) ? value : { filter: 'open' })

export const loadView = (): Promise<View> => loadStored(VIEW_KEY, parse)

/** Calls `cb` with the new view whenever it changes; returns a function that stops. */
export const watchView = (cb: (view: View) => void): (() => void) =>
  watchStored(VIEW_KEY, parse, cb)

/** Whether `filter` lists and pins `item`. */
export function shows(item: Pick<Annotation, 'status'>, filter: Filter): boolean {
  if (filter === 'open') return item.status === 'open'
  if (filter === 'all') return item.status !== 'deleted'
  return true
}
