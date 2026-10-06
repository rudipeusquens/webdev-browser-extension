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
