// The page cannot reach the comment field inside the closed shadow root, but while the field
// has focus, `document.execCommand()` called by the page edits it anyway, with trusted
// `input` events. Such edits come without a `beforeinput`, which every edit by the user
// fires first. The guard accepts only edits announced with the same type and text, so a page
// that hides the user's own `input` event and inserts something else is caught as well; the
// overlay restores the last accepted text and saves nothing else (spec section 11).

const COMPOSITION = new Set([
  'insertCompositionText',
  'deleteCompositionText',
  'insertFromComposition',
])

type Announcement = Pick<InputEvent, 'isTrusted' | 'defaultPrevented' | 'inputType' | 'data'>
type Edit = Pick<InputEvent, 'inputType' | 'data'>

export class CommentGuard {
  /** The text as last changed by the user. */
  verified: string
  /** An unannounced edit was seen. */
  tampered = false
  private pending: Edit[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(initial: string) {
    this.verified = initial
  }

  /** Call from a `beforeinput` listener on the field. */
  beforeInput(e: Announcement): void {
    if (!e.isTrusted || e.defaultPrevented) return
    this.pending.push({ inputType: e.inputType, data: e.data })
    // The browser edits and fires `input` within the same task; an announcement left over
    // after that (a no-op edit) must not cover a later edit by the page.
    clearTimeout(this.timer)
    this.timer = setTimeout(() => (this.pending = []))
  }

  /** Call from an `input` listener with the field's new value; false means: restore. */
  input(e: Edit, value: string): boolean {
    const next = this.pending[0]
    // Composition comes only from an input method; page commands cannot produce it.
    const announced =
      COMPOSITION.has(e.inputType) ||
      (next !== undefined && next.inputType === e.inputType && next.data === e.data)
    if (!announced) {
      this.pending = []
      this.tampered = true
      return false
    }
    if (!COMPOSITION.has(e.inputType)) this.pending.shift()
    this.verified = value
    return true
  }

  matches(value: string): boolean {
    return value === this.verified
  }
}
