import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommentGuard, type FieldState } from '@/entrypoints/overlay.content/comment-guard'

// Events are plain objects: only the browser can make them trusted. The E2E test
// tests/e2e/robustness.e2e.test.ts drives the real attacks with document.execCommand.
const before = (inputType: string, data: string | null = 'a', extra: Partial<InputEvent> = {}) =>
  ({ isTrusted: true, defaultPrevented: false, inputType, data, ...extra }) as InputEvent
const input = (inputType: string, data: string | null = 'a', isTrusted = true) =>
  ({ inputType, data, isTrusted }) as InputEvent
const composition = (isTrusted = true) => ({ isTrusted }) as CompositionEvent
/** The field as it stands, with the caret at the end unless a selection is given. */
const at = (value: string, start = value.length, end = start): FieldState => ({ value, start, end })

describe('CommentGuard', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('takes an edit by the overlay itself, such as a dictated text, as the verified text', () => {
    const guard = new CommentGuard('Fix this')
    guard.beforeInput(before('insertText', 'x'), at('Fix this'))
    guard.accept('Fix this and that.')
    expect(guard.verified).toBe('Fix this and that.')
    expect(guard.matches('Fix this and that.')).toBe(true)
    // An announcement from before the overlay's edit covers nothing after it.
    expect(guard.input(input('insertText', 'x'), 'Fix this and that.x')).toBe(false)
    expect(guard.verified).toBe('Fix this and that.')
  })

  it('accepts edits announced by a trusted beforeinput', () => {
    const guard = new CommentGuard('')
    guard.beforeInput(before('insertText'), at(''))
    expect(guard.input(input('insertText'), 'a')).toBe(true)
    expect(guard.verified).toBe('a')
  })

  it('rejects an edit nobody announced, such as document.execCommand', () => {
    const guard = new CommentGuard('Mine')
    expect(guard.input(input('insertText'), 'Theirs')).toBe(false)
    expect(guard.verified).toBe('Mine')
  })

  it('rejects an untrusted edit, also one that claims to come from an input method', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('insertText', 'a'), at('Mine'))
    expect(guard.input(input('insertText', 'a', false), 'Minea')).toBe(false)
    guard.compositionStart(composition(), at('Mine'))
    expect(guard.input(input('insertCompositionText', 'x', false), 'Minex')).toBe(false)
    expect(guard.verified).toBe('Mine')
  })

  it('rejects other text squeezed in while the user types', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('insertText', 'a'), at('Mine'))
    // The page hides the user's own input event and inserts its own text instead.
    expect(guard.input(input('insertText', 'Theirs'), 'MineaTheirs')).toBe(false)
    expect(guard.verified).toBe('Mine')
  })

  it('rejects a second edit that copies the announced one', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('insertText', 'a'), at('Mine'))
    expect(guard.input(input('insertText', 'a'), 'Minea')).toBe(true)
    expect(guard.input(input('insertText', 'a'), 'Mineaa')).toBe(false)
  })

  it('rejects the announced keystroke landing anywhere but where it was typed', () => {
    // The page stops the user's input event, selects everything and inserts the same key.
    const replayed = new CommentGuard('Keep all of this')
    replayed.beforeInput(before('insertText', '.'), at('Keep all of this'))
    expect(replayed.input(input('insertText', '.'), '.')).toBe(false)
    expect(replayed.verified).toBe('Keep all of this')

    const typed = new CommentGuard('Make it red')
    typed.beforeInput(before('insertText', 'blue'), at('Make it red', 8, 11))
    expect(typed.input(input('insertText', 'blue'), 'Make it blue')).toBe(true)
    typed.select(7, 7)
    typed.beforeInput(before('insertLineBreak', null), at('Make it blue', 7))
    expect(typed.input(input('insertLineBreak', null), 'Make it\n blue')).toBe(true)
    typed.select(0, 0)
    typed.beforeInput(before('insertFromPaste', null), at('Make it\n blue', 0))
    expect(typed.input(input('insertFromPaste', null), 'Please: Make it\n blue')).toBe(true)
    typed.select(0, 0)
    typed.beforeInput(before('insertFromPaste', null), at('Please: Make it\n blue', 0))
    expect(typed.input(input('insertFromPaste', null), 'x')).toBe(false)
  })

  it('accepts a deletion only of the selection or next to the caret', () => {
    const guard = new CommentGuard('Hello wide world')
    guard.beforeInput(before('deleteContentBackward', null), at('Hello wide world'))
    expect(guard.input(input('deleteContentBackward', null), 'Hello wide worl')).toBe(true)
    guard.beforeInput(before('deleteContentBackward', null), at('Hello wide worl'))
    // One character before the caret, not everything.
    expect(guard.input(input('deleteContentBackward', null), '')).toBe(false)
    guard.select(0, 0)
    guard.beforeInput(before('deleteContentForward', null), at('Hello wide worl', 0))
    expect(guard.input(input('deleteContentForward', null), 'ello wide worl')).toBe(true)
    guard.select(4, 9)
    guard.beforeInput(before('deleteContentBackward', null), at('ello wide worl', 4, 9))
    expect(guard.input(input('deleteContentBackward', null), 'ello worl')).toBe(true)
    guard.select(9, 9)
    guard.beforeInput(before('deleteWordBackward', null), at('ello worl'))
    expect(guard.input(input('deleteWordBackward', null), 'ello ')).toBe(true)
    guard.select(0, 0)
    guard.beforeInput(before('deleteWordForward', null), at('ello ', 0))
    // A word forward from the start cannot remove the end.
    expect(guard.input(input('deleteWordForward', null), 'ello')).toBe(false)
    // An emoji is one character to delete.
    const emoji = new CommentGuard('ok 👍🏽')
    emoji.beforeInput(before('deleteContentBackward', null), at('ok 👍🏽'))
    expect(emoji.input(input('deleteContentBackward', null), 'ok ')).toBe(true)
  })

  it('rejects an edit of another kind than announced', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('insertText'), at('Mine'))
    expect(guard.input(input('historyUndo', null), '')).toBe(false)
  })

  it('ignores untrusted and cancelled announcements', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('insertText', 'a', { isTrusted: false }), at('Mine'))
    guard.beforeInput(before('insertText', 'a', { defaultPrevented: true }), at('Mine'))
    expect(guard.input(input('insertText'), 'Minea')).toBe(false)
  })

  it('forgets an announcement once its task is over', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('deleteContentForward', null), at('Mine', 0))
    vi.runAllTimers()
    expect(guard.input(input('deleteContentForward', null), 'ine')).toBe(false)
  })

  it('accepts IME composition only between a trusted compositionstart and compositionend', () => {
    const guard = new CommentGuard('')
    expect(guard.input(input('insertCompositionText', 'に'), 'に')).toBe(false)
    guard.compositionStart(composition(false), at(''))
    expect(guard.input(input('insertCompositionText', 'に'), 'に')).toBe(false)
    guard.compositionStart(composition(), at(''))
    expect(guard.input(input('insertCompositionText', 'に'), 'に')).toBe(true)
    expect(guard.verified).toBe('に')
    guard.compositionEnd(composition())
    // The input method's last edit may follow its end within the same task.
    expect(guard.input(input('insertCompositionText', 'にほ'), 'にほ')).toBe(true)
    vi.runAllTimers()
    expect(guard.input(input('insertCompositionText', 'にほん'), 'にほん')).toBe(false)
    expect(guard.verified).toBe('にほ')
  })

  // A page can move the field's selection before the overlay sees the key (its capture
  // listeners run first): the developer's own Backspace would then delete what the page chose.
  it('puts an edit where the user left the selection, not where the page moved it', () => {
    const text = 'Please do not delete the tests'
    const guard = new CommentGuard(text)
    guard.select(30, 30)
    // The page moved the selection over "not " before the overlay saw the Backspace.
    expect(guard.beforeInput(before('deleteContentBackward', null), at(text, 10, 14))).toEqual({
      start: 30,
      end: 30,
    })
    expect(guard.input(input('deleteContentBackward', null), 'Please do delete the tests')).toBe(
      false,
    )
    // Put back, the edit lands where the user left the caret.
    guard.beforeInput(before('deleteContentBackward', null), at(text, 10, 14))
    expect(guard.input(input('deleteContentBackward', null), 'Please do not delete the test')).toBe(
      true,
    )
    expect(guard.misplaced({ start: 29, end: 29 })).toBeNull()
    expect(guard.misplaced({ start: 0, end: 29 })).toEqual({ start: 29, end: 29 })
  })

  it('follows the selection through the edits it accepts and the overlay makes', () => {
    const guard = new CommentGuard('')
    guard.select(0, 0)
    guard.beforeInput(before('insertText', 'ab'), at(''))
    guard.input(input('insertText', 'ab'), 'ab')
    expect(guard.selection).toEqual({ start: 2, end: 2 })
    guard.select(1, 1)
    guard.beforeInput(before('insertFromPaste', null), at('ab', 1))
    guard.input(input('insertFromPaste', null), 'aXYZb')
    expect(guard.selection).toEqual({ start: 4, end: 4 })
    guard.beforeInput(before('deleteContentBackward', null), at('aXYZb', 4))
    guard.input(input('deleteContentBackward', null), 'aXYb')
    expect(guard.selection).toEqual({ start: 3, end: 3 })
    guard.select(0, 2)
    guard.beforeInput(before('deleteByCut', null), at('aXYb', 0, 2))
    guard.input(input('deleteByCut', null), 'Yb')
    expect(guard.selection).toEqual({ start: 0, end: 0 })
    guard.accept('Yb and more', 5)
    expect(guard.selection).toEqual({ start: 5, end: 5 })
  })

  it('takes undo and redo only back to a text the user had', () => {
    const guard = new CommentGuard('')
    guard.select(0, 0)
    guard.beforeInput(before('insertText', 'mine'), at(''))
    guard.input(input('insertText', 'mine'), 'mine')
    // The page inserted text; the overlay restored the user's.
    expect(guard.input(input('insertText', ' INJECTED'), 'mine INJECTED')).toBe(false)
    guard.beforeInput(before('historyUndo', null), at('mine'))
    expect(guard.input(input('historyUndo', null), '')).toBe(true)
    // The browser's own history still holds the page's edit.
    guard.beforeInput(before('historyRedo', null), at(''))
    expect(guard.input(input('historyRedo', null), 'mine INJECTED')).toBe(false)
    guard.beforeInput(before('historyRedo', null), at(''))
    expect(guard.input(input('historyRedo', null), 'mine')).toBe(true)
  })

  it('accepts a drop only as an insertion, and a drag only of the selection', () => {
    const guard = new CommentGuard('Keep this text')
    guard.select(5, 9)
    // The page selected everything when the drag began.
    guard.beforeInput(before('deleteByDrag', null), at('Keep this text', 0, 14))
    expect(guard.input(input('deleteByDrag', null), '')).toBe(false)
    guard.beforeInput(before('deleteByDrag', null), at('Keep this text', 5, 9))
    expect(guard.input(input('deleteByDrag', null), 'Keep  text')).toBe(true)
    // A drop goes where it is dropped, not at the selection; it removes nothing.
    guard.beforeInput(before('insertFromDrop', null), at('Keep  text', 0))
    expect(guard.input(input('insertFromDrop', null), 'thisKeep  text')).toBe(true)
    guard.beforeInput(before('insertFromDrop', null), at('thisKeep  text', 0, 14))
    expect(guard.input(input('insertFromDrop', null), 'this')).toBe(false)
  })

  it("keeps an input method's text at the selection it started from", () => {
    const guard = new CommentGuard('Keep this')
    guard.select(9, 9)
    // The page selected everything when the input method started.
    expect(guard.compositionStart(composition(), at('Keep this', 0, 9))).toEqual({
      start: 9,
      end: 9,
    })
    expect(guard.input(input('insertCompositionText', 'に'), 'に')).toBe(false)
    expect(guard.input(input('insertCompositionText', 'に'), 'Keep thisに')).toBe(true)
    expect(guard.input(input('insertCompositionText', 'にほ'), 'Keep thisにほ')).toBe(true)
    guard.compositionEnd(composition())
    expect(guard.selection).toEqual({ start: 11, end: 11 })
  })

  it('checks the value at save time', () => {
    const guard = new CommentGuard('Mine')
    expect(guard.matches('Mine')).toBe(true)
    expect(guard.matches('Theirs')).toBe(false)
  })
})
