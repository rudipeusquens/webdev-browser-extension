// The comment field's selection as the user made it (comment-guard.ts). It is taken from the
// field only during the user's own selection gestures: while a pointer pressed in the field is
// held down, and right after a key that moves the selection. Before any other key, the field
// gets it back: a page's capture listeners see the key first and may have moved it.
//
// A page that moves the selection during such a gesture still chooses where the next edit
// lands; only an editor in a frame of the extension's own would close that (spec section 11).

import type { CommentGuard, FieldState, Selection } from './comment-guard'

/** Keys that move the selection, besides those that edit. */
const NAVIGATION = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

function movesSelection(e: KeyboardEvent, mac: boolean): boolean {
  if (NAVIGATION.has(e.key)) return true
  const letter = e.key.length === 1 ? e.key.toLowerCase() : ''
  // Select all; on macOS also the Emacs keys that move the caret.
  if ((e.ctrlKey || e.metaKey) && letter === 'a') return true
  return mac && e.ctrlKey && letter !== '' && 'aebfnp'.includes(letter)
}

export const fieldState = (el: HTMLTextAreaElement): FieldState => ({
  value: el.value,
  start: el.selectionStart,
  end: el.selectionEnd,
})

/** Puts the field's selection where `want` is, if anywhere. */
export function putBack(el: HTMLTextAreaElement, want: Selection | null) {
  if (want) el.setSelectionRange(want.start, want.end)
}

const pressed = (el: Element) => {
  try {
    return el.matches(':active')
  } catch {
    return false
  }
}

export function useFieldSelection(guard: CommentGuard, mac: boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let frame = 0

  const take = (el: HTMLTextAreaElement) => guard.select(el.selectionStart, el.selectionEnd)

  /**
   * Call first from the field's own key, `beforeinput` and `compositionstart` listeners: a
   * gesture's selection not taken yet is taken now, else the user's is put back.
   */
  function settle(el: HTMLTextAreaElement) {
    if (timer !== undefined || frame) {
      clearTimeout(timer)
      timer = undefined
      take(el)
    } else putBack(el, guard.misplaced(fieldState(el)))
  }

  /** Call from the field's `keydown`; a key that moves the selection is followed. */
  function keydown(e: KeyboardEvent, el: HTMLTextAreaElement) {
    // A selection set while an input method writes would end what it writes.
    if (!e.isTrusted || e.isComposing) return
    settle(el)
    if (!movesSelection(e, mac)) return
    // After the key's default action.
    timer = setTimeout(() => {
      timer = undefined
      take(el)
    })
  }

  /** Call from the field's `pointerdown`: followed until the pointer is let go. */
  function pointerdown(e: PointerEvent, el: HTMLTextAreaElement) {
    if (!e.isTrusted) return
    cancelAnimationFrame(frame)
    const step = () => {
      take(el)
      // A press in the field keeps it active until it ends, also outside of it.
      frame = pressed(el) ? requestAnimationFrame(step) : 0
    }
    frame = requestAnimationFrame(step)
  }

  /** The selection the overlay sets itself, such as the caret at the end on opening. */
  function set(el: HTMLTextAreaElement, caret: number) {
    el.setSelectionRange(caret, caret)
    guard.select(caret, caret)
  }

  function stop() {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
  }

  return { settle, keydown, pointerdown, set, stop }
}
