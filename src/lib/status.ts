// How a status looks, in the panel and on the page (spec section 8). White numbers keep at
// least 4.5:1 contrast on each of these.

import { type Annotation, type Status, STATUSES } from './collection/model'

/** A status as it looks: an open draft is grey (spec section 8). */
export type Tone = Status | 'draft'
export const TONES: readonly Tone[] = [...STATUSES, 'draft']

export function toneOf(item: Pick<Annotation, 'status' | 'draft'>): Tone {
  return item.status === 'open' && item.draft ? 'draft' : item.status
}

export const STATUS_NAME: Record<Tone, string> = {
  open: 'Open',
  done: 'Done',
  deleted: 'Deleted',
  draft: 'Draft',
}

/** Tailwind classes of a numbered badge or pin. */
export const STATUS_BADGE: Record<Tone, string> = {
  open: 'bg-blue-600',
  done: 'bg-green-700',
  deleted: 'bg-red-600',
  draft: 'bg-zinc-500',
}

/**
 * Tailwind classes of the boxes that mark a pin's target on the page: the line, its fill (a
 * hovered or highlighted target), the lighter fill of one being edited, the label, and the
 * lines of a text being edited. A new pin is open: blue.
 */
export const STATUS_MARK: Record<
  Tone,
  { line: string; fill: string; soft: string; label: string; lines: string }
> = {
  open: {
    line: 'outline-blue-600',
    fill: 'bg-blue-600/10',
    soft: 'bg-blue-600/5',
    label: 'bg-blue-600',
    lines: 'bg-blue-600/25',
  },
  done: {
    line: 'outline-green-700',
    fill: 'bg-green-700/10',
    soft: 'bg-green-700/5',
    label: 'bg-green-700',
    lines: 'bg-green-700/25',
  },
  deleted: {
    line: 'outline-red-600',
    fill: 'bg-red-600/10',
    soft: 'bg-red-600/5',
    label: 'bg-red-600',
    lines: 'bg-red-600/25',
  },
  draft: {
    line: 'outline-zinc-500',
    fill: 'bg-zinc-500/10',
    soft: 'bg-zinc-500/5',
    label: 'bg-zinc-500',
    lines: 'bg-zinc-500/25',
  },
}
