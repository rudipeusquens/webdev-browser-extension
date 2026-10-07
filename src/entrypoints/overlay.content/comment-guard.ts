// The page cannot reach the comment field inside the closed shadow root, but while the field
// has focus, `document.execCommand()` called by the page edits it anyway, with trusted
// `input` events. Such edits come without a `beforeinput`, which every edit by the user
// fires first. The guard accepts only trusted edits announced with the same type and text,
// at the place they were announced for: a page that hides the user's own `input` event and
// inserts something else, or the same keystroke over a selection it made, is caught as well.
// The overlay restores the last accepted text and saves nothing else (spec section 11).

const COMPOSITION = new Set([
  'insertCompositionText',
  'deleteCompositionText',
  'insertFromComposition',
])

/** Deletions that remove the selection, or from the caret in their direction. */
const DELETES_BACKWARD = new Set([
  'deleteContentBackward',
  'deleteWordBackward',
  'deleteSoftLineBackward',
  'deleteHardLineBackward',
])
const DELETES_FORWARD = new Set([
  'deleteContentForward',
  'deleteWordForward',
  'deleteSoftLineForward',
  'deleteHardLineForward',
])
/** Inserts that replace the selection and keep everything around it. */
const INSERTS_AT_SELECTION = new Set(['insertText', 'insertLineBreak', 'insertFromPaste'])

type Announcement = Pick<InputEvent, 'isTrusted' | 'defaultPrevented' | 'inputType' | 'data'>
type Edit = Pick<InputEvent, 'isTrusted' | 'inputType' | 'data'>

/** The field when an edit was announced: its text and selection. */
export interface FieldState {
  value: string
  start: number
  end: number
}

interface Pending {
  inputType: string
  data: string | null
  at: FieldState
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const isOneCharacter = (text: string) => {
  const it = graphemes.segment(text)[Symbol.iterator]()
  return !it.next().done && it.next().done === true
}

/**
 * Where `value` can come from `before` by removing one run: the possible starts of that run
 * and its length; null when it cannot.
 */
function removedRun(
  before: string,
  value: string,
): { from: number; to: number; length: number } | null {
  const length = before.length - value.length
  if (length <= 0) return null
  let prefix = 0
  while (prefix < value.length && before[prefix] === value[prefix]) prefix++
  let suffix = 0
  while (
    suffix < value.length &&
    before[before.length - 1 - suffix] === value[value.length - 1 - suffix]
  )
    suffix++
  if (prefix + suffix < value.length) return null
  return { from: value.length - suffix, to: prefix, length }
}

/** Whether `value` is what the announced edit makes of the field it was announced for. */
function landsWhereAnnounced(edit: Pending, value: string): boolean {
  const { value: before, start, end } = edit.at
  const { inputType, data } = edit
  if (inputType === 'insertText' && data !== null) {
    return value === before.slice(0, start) + data + before.slice(end)
  }
  if (inputType === 'insertLineBreak') {
    return value === `${before.slice(0, start)}\n${before.slice(end)}`
  }
  if (INSERTS_AT_SELECTION.has(inputType)) {
    const kept = before.slice(0, start)
    const after = before.slice(end)
    return (
      value.startsWith(kept) && value.endsWith(after) && value.length >= kept.length + after.length
    )
  }
  const backward = DELETES_BACKWARD.has(inputType)
  if (!backward && !DELETES_FORWARD.has(inputType) && inputType !== 'deleteByCut') return true
  const run = removedRun(before, value)
  if (!run) return false
  const startsAt = (at: number) => at >= run.from && at <= run.to
  // A selection goes as a whole, also with Backspace or Delete.
  if (start !== end) return run.length === end - start && startsAt(start)
  if (inputType === 'deleteByCut') return false
  const at = backward ? start - run.length : start
  if (!startsAt(at)) return false
  const removed = before.slice(at, at + run.length)
  return !inputType.startsWith('deleteContent') || isOneCharacter(removed)
}

export class CommentGuard {
  /** The text as last changed by the user. */
  verified: string
  /** An unannounced edit was seen. */
  tampered = false
  private pending: Pending[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private composing = false
  private compositionTimer: ReturnType<typeof setTimeout> | undefined

  constructor(initial: string) {
    this.verified = initial
  }

  /** Call from a `beforeinput` listener on the field, with the field as it stands. */
  beforeInput(e: Announcement, at: FieldState): void {
    if (!e.isTrusted || e.defaultPrevented) return
    this.pending.push({ inputType: e.inputType, data: e.data, at })
    // The browser edits and fires `input` within the same task; an announcement left over
    // after that (a no-op edit) must not cover a later edit by the page.
    clearTimeout(this.timer)
    this.timer = setTimeout(() => (this.pending = []))
  }

  /** Call from `compositionstart` on the field: an input method edits it from now on. */
  compositionStart(e: Pick<CompositionEvent, 'isTrusted'>): void {
    if (!e.isTrusted) return
    clearTimeout(this.compositionTimer)
    this.composing = true
  }

  /** Call from `compositionend`: its last edit may still follow within this task. */
  compositionEnd(e: Pick<CompositionEvent, 'isTrusted'>): void {
    if (!e.isTrusted) return
    clearTimeout(this.compositionTimer)
    this.compositionTimer = setTimeout(() => (this.composing = false))
  }

  /** Call from an `input` listener with the field's new value; false means: restore. */
  input(e: Edit, value: string): boolean {
    const accepted =
      e.isTrusted && (COMPOSITION.has(e.inputType) ? this.composing : this.announced(e, value))
    if (!accepted) {
      this.pending = []
      this.tampered = true
      return false
    }
    this.verified = value
    return true
  }

  private announced(e: Edit, value: string): boolean {
    const next = this.pending.shift()
    return (
      next !== undefined &&
      next.inputType === e.inputType &&
      next.data === e.data &&
      next.at.value === this.verified &&
      landsWhereAnnounced(next, value)
    )
  }

  /** The overlay's own edit, such as a dictated text: it becomes the verified text. */
  accept(value: string): void {
    this.pending = []
    clearTimeout(this.timer)
    this.verified = value
  }

  matches(value: string): boolean {
    return value === this.verified
  }
}
