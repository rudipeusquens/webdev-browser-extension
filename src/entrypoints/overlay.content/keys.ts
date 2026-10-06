// Keyboard decisions of the overlay as pure functions. Only trusted events count: a page can
// dispatch any event it likes, but cannot make it trusted (spec section 11).

import type { Mode } from '@/lib/messages'

type Key = Pick<
  KeyboardEvent,
  'key' | 'isTrusted' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'keyCode'
>

/** Inside the comment field: `Enter` saves (not while composing), `Escape` cancels. */
export function popoverKey(e: Key): 'save' | 'cancel' | null {
  // keyCode 229: some IMEs report composing keys this way only. Escape and Enter belong to
  // the input method while it composes.
  if (!e.isTrusted || e.isComposing || e.keyCode === 229) return null
  if (e.key === 'Escape') return 'cancel'
  if (e.key === 'Enter' && !e.shiftKey) return 'save'
  return null
}

export interface ShortcutState {
  mode: Mode
  /** An element is outlined under the pointer. */
  hovering: boolean
  /** The comment popover is open. */
  drafting: boolean
  /** An area is being dragged. */
  dragging: boolean
  /** Focus is in a page field. */
  editableFocus: boolean
}

export type Shortcut = { mode: Mode } | 'up' | 'down' | 'select' | 'cancel'

/** Keys on the page itself (spec section 8). */
export function pageShortcut(e: Key, state: ShortcutState): Shortcut | null {
  if (!e.isTrusted || e.ctrlKey || e.metaKey || e.altKey || state.editableFocus) return null
  if (e.key === 'Escape') {
    if (state.drafting || state.dragging) return 'cancel'
    return state.mode === 'browse' ? null : { mode: 'browse' }
  }
  if (state.drafting) return null
  if (e.key === 'e' || e.key === 'E') return { mode: 'element' }
  if (e.key === 'a' || e.key === 'A') return { mode: 'area' }
  if (state.mode !== 'element' || !state.hovering) return null
  if (e.key === 'ArrowUp') return 'up'
  if (e.key === 'ArrowDown') return 'down'
  if (e.key === 'Enter') return 'select'
  return null
}
