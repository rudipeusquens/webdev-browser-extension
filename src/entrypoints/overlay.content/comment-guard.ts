// The page cannot reach the comment field inside the closed shadow root, but while the field
// has focus, `document.execCommand()` called by the page edits it anyway, with trusted
// `input` events. Such edits come without a `beforeinput`, which every edit by the user
// fires first. The guard accepts only trusted edits announced with the same type and text,
// at the place they were announced for: a page that hides the user's own `input` event and
// inserts something else, or the same keystroke over a selection it made, is caught as well.
// The overlay restores the last accepted text and saves nothing else (spec section 11).
//
// The page's capture listeners see every key before the overlay does, and can move the
// field's selection (`execCommand('selectAll')`, `Selection.modify()`): the user's own
// keystroke would then land where the page chose. So the guard also keeps the selection the
// user made, by their own gestures or by edits it accepted; an edit is announced for that
// selection, and the overlay puts it back when the page moved it.

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
/** Deletions of the selection only. */
const DELETES_SELECTION = new Set(['deleteByCut', 'deleteByDrag', 'deleteContent'])
/** Inserts that replace the selection and keep everything around it. */
const INSERTS_AT_SELECTION = new Set(['insertText', 'insertLineBreak', 'insertFromPaste'])
const HISTORY = new Set(['historyUndo', 'historyRedo'])
/** Edits that land elsewhere than the selection: a drop, a spelling suggestion, undo, redo. */
const PLACED_ELSEWHERE = new Set(['insertFromDrop', 'insertReplacementText', ...HISTORY])

/** How much text (UTF-16 code units) the guard keeps to check undo and redo against. */
const KNOWN_TEXT = 1_000_000

type Announcement = Pick<InputEvent, 'isTrusted' | 'defaultPrevented' | 'inputType' | 'data'>
type Edit = Pick<InputEvent, 'isTrusted' | 'inputType' | 'data'>

export interface Selection {
  start: number
  end: number
}

/** The field when an edit was announced: its text and selection. */
export interface FieldState extends Selection {
  value: string
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

/** How many characters `before` and `value` share at their start, and then at their end. */
function shared(before: string, value: string): { prefix: number; suffix: number } {
  const most = Math.min(before.length, value.length)
  let prefix = 0
  while (prefix < most && before[prefix] === value[prefix]) prefix++
  let suffix = 0
  while (
    suffix < most - prefix &&
    before[before.length - 1 - suffix] === value[value.length - 1 - suffix]
  )
    suffix++
  return { prefix, suffix }
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

/** Whether `value` is `at.value` with its selection replaced by something, the rest kept. */
function replacesSelection(at: FieldState, value: string): boolean {
  const kept = at.value.slice(0, at.start)
  const after = at.value.slice(at.end)
  return (
    value.startsWith(kept) && value.endsWith(after) && value.length >= kept.length + after.length
  )
}

/** Whether the announced edit, made where it was announced, turns the field into `value`. */
function landsWhereAnnounced(edit: Pending, value: string): boolean {
  const { value: before, start, end } = edit.at
  const { inputType, data } = edit
  if (inputType === 'insertText' && data !== null) {
    return value === before.slice(0, start) + data + before.slice(end)
  }
  if (inputType === 'insertLineBreak') {
    return value === `${before.slice(0, start)}\n${before.slice(end)}`
  }
  if (INSERTS_AT_SELECTION.has(inputType)) return replacesSelection(edit.at, value)
  // A drop adds what was dragged and removes nothing.
  if (inputType === 'insertFromDrop') {
    const { prefix, suffix } = shared(before, value)
    return value.length > before.length && prefix + suffix === before.length
  }
  const backward = DELETES_BACKWARD.has(inputType)
  if (!backward && !DELETES_FORWARD.has(inputType) && !DELETES_SELECTION.has(inputType)) {
    return true
  }
  const run = removedRun(before, value)
  if (!run) return false
  const startsAt = (at: number) => at >= run.from && at <= run.to
  // A selection goes as a whole, also with Backspace or Delete.
  if (start !== end) return run.length === end - start && startsAt(start)
  if (DELETES_SELECTION.has(inputType)) return false
  const at = backward ? start - run.length : start
  if (!startsAt(at)) return false
  const removed = before.slice(at, at + run.length)
  return !inputType.startsWith('deleteContent') || isOneCharacter(removed)
}

/** Where the caret is after an accepted edit. */
function caretAfter(edit: Pending, value: string): number {
  const { value: before, start, end } = edit.at
  const { inputType } = edit
  // Before what followed the selection.
  if (INSERTS_AT_SELECTION.has(inputType)) return value.length - (before.length - end)
  if (start === end && DELETES_BACKWARD.has(inputType))
    return start - (before.length - value.length)
  if (DELETES_BACKWARD.has(inputType) || DELETES_FORWARD.has(inputType)) return start
  if (DELETES_SELECTION.has(inputType)) return start
  // A drop, a suggestion, undo or redo: after what changed.
  return value.length - shared(before, value).suffix
}

const differ = (a: Selection, b: Selection) => a.start !== b.start || a.end !== b.end

export class CommentGuard {
  /** The text as last changed by the user. */
  verified: string
  /** An unannounced edit was seen. */
  tampered = false
  private chosen: Selection | null = null
  private pending: Pending[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private composing = false
  private compositionTimer: ReturnType<typeof setTimeout> | undefined
  /** The field when the input method started, with the selection it started from. */
  private composition: FieldState | null = null
  /** Texts the user had, oldest first: where undo and redo may go. */
  private known: string[] = []
  private knownLength = 0

  constructor(initial: string) {
    this.verified = initial
    this.remember(initial)
  }

  /** The selection the user made, as the guard expects it; null until the overlay sets one. */
  get selection(): Selection | null {
    return this.chosen && { ...this.chosen }
  }

  /** A selection the user made by a gesture of their own, or the overlay set. */
  select(start: number, end: number): void {
    this.chosen = { start, end }
  }

  /** The selection to put back when the field's is not the one the user made, else null. */
  misplaced(at: Selection): Selection | null {
    return this.chosen && differ(this.chosen, at) ? { ...this.chosen } : null
  }

  /**
   * Call from a `beforeinput` listener on the field, with the field as it stands. Returns the
   * selection to put back: the edit is announced for it.
   */
  beforeInput(e: Announcement, at: FieldState): Selection | null {
    // An input method's edits are checked against where it started (compositionStart).
    if (!e.isTrusted || e.defaultPrevented || COMPOSITION.has(e.inputType)) return null
    const moved = PLACED_ELSEWHERE.has(e.inputType) ? null : this.misplaced(at)
    this.pending.push({
      inputType: e.inputType,
      data: e.data,
      at: moved ? { value: at.value, ...moved } : at,
    })
    // The browser edits and fires `input` within the same task; an announcement left over
    // after that (a no-op edit) must not cover a later edit by the page.
    clearTimeout(this.timer)
    this.timer = setTimeout(() => (this.pending = []))
    return moved
  }

  /**
   * Call from `compositionstart` on the field: an input method edits it from now on, at the
   * selection the user made. Returns the selection to put back, as `beforeInput` does.
   */
  compositionStart(e: Pick<CompositionEvent, 'isTrusted'>, at: FieldState): Selection | null {
    if (!e.isTrusted) return null
    clearTimeout(this.compositionTimer)
    this.composing = true
    const moved = this.misplaced(at)
    const { start, end } = moved ?? at
    this.composition = { value: this.verified, start, end }
    return moved
  }

  /** Call from `compositionend`: its last edit may still follow within this task. */
  compositionEnd(e: Pick<CompositionEvent, 'isTrusted'>): void {
    if (!e.isTrusted) return
    clearTimeout(this.compositionTimer)
    this.compositionTimer = setTimeout(() => (this.composing = false))
  }

  /** Call from an `input` listener with the field's new value; false means: restore. */
  input(e: Edit, value: string): boolean {
    if (e.isTrusted && COMPOSITION.has(e.inputType)) {
      const from = this.composition
      if (!this.composing || !from || !replacesSelection(from, value)) return this.reject()
      this.take(value, value.length - (from.value.length - from.end))
      return true
    }
    const edit = e.isTrusted ? this.pending.shift() : undefined
    if (!edit || !this.lands(edit, e, value)) return this.reject()
    this.take(value, caretAfter(edit, value))
    return true
  }

  private lands(edit: Pending, e: Edit, value: string): boolean {
    if (edit.inputType !== e.inputType || edit.data !== e.data) return false
    if (edit.at.value !== this.verified) return false
    // The browser's history also holds the page's edits that were restored.
    if (HISTORY.has(e.inputType)) return this.known.includes(value)
    return landsWhereAnnounced(edit, value)
  }

  private reject(): false {
    this.pending = []
    this.tampered = true
    return false
  }

  private take(value: string, caret: number): void {
    this.verified = value
    this.remember(value)
    this.chosen = { start: caret, end: caret }
  }

  private remember(value: string): void {
    if (this.known.at(-1) === value) return
    this.known.push(value)
    this.knownLength += value.length
    while (this.knownLength > KNOWN_TEXT && this.known.length > 1) {
      this.knownLength -= this.known.shift()?.length ?? 0
    }
  }

  /** The overlay's own edit, such as a dictated text: it becomes the verified text. */
  accept(value: string, caret = value.length): void {
    this.pending = []
    clearTimeout(this.timer)
    this.take(value, caret)
  }

  matches(value: string): boolean {
    return value === this.verified
  }
}
