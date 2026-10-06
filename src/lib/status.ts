// How a status looks, in the panel and on the page (spec section 8). White numbers keep at
// least 4.5:1 contrast on each of these.

import type { Status } from './collection/model'

export const STATUS_NAME: Record<Status, string> = {
  open: 'Open',
  done: 'Done',
  deleted: 'Deleted',
}

/** Tailwind classes of a numbered badge or pin. */
export const STATUS_BADGE: Record<Status, string> = {
  open: 'bg-blue-600',
  done: 'bg-green-700',
  deleted: 'bg-red-600',
}

/**
 * Tailwind classes of the boxes that mark a pin's target on the page: the line, its fill (a
 * hovered or highlighted target), the lighter fill of one being edited, the label, and the
 * lines of a text being edited. A new pin is open: blue.
 */
export const STATUS_MARK: Record<
  Status,
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
}
