import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommentGuard } from '@/entrypoints/overlay.content/comment-guard'

// Events are plain objects: only the browser can make them trusted. The E2E test
// tests/e2e/robustness.e2e.test.ts drives the real attack with document.execCommand.
const before = (inputType: string, data: string | null = 'a', extra: Partial<InputEvent> = {}) =>
  ({ isTrusted: true, defaultPrevented: false, inputType, data, ...extra }) as InputEvent
const input = (inputType: string, data: string | null = 'a') => ({ inputType, data }) as InputEvent

describe('CommentGuard', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('takes an edit by the overlay itself, such as a dictated text, as the verified text', () => {
    const guard = new CommentGuard('Fix this')
    guard.beforeInput(before('insertText', 'x'))
    guard.accept('Fix this and that.')
    expect(guard.verified).toBe('Fix this and that.')
    expect(guard.matches('Fix this and that.')).toBe(true)
    // An announcement from before the overlay's edit covers nothing after it.
    expect(guard.input(input('insertText', 'x'), 'Fix this and that.x')).toBe(false)
    expect(guard.verified).toBe('Fix this and that.')
  })

  it('accepts edits announced by a trusted beforeinput', () => {
    const guard = new CommentGuard('')
    guard.beforeInput(before('insertText'))
    expect(guard.input(input('insertText'), 'a')).toBe(true)
    expect(guard.verified).toBe('a')
  })

  it('rejects an edit nobody announced, such as document.execCommand', () => {
    const guard = new CommentGuard('Mine')
    expect(guard.input(input('insertText'), 'Theirs')).toBe(false)
    expect(guard.verified).toBe('Mine')
  })

  it('rejects other text squeezed in while the user types', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('insertText', 'a'))
    // The page hides the user's own input event and inserts its own text instead.
    expect(guard.input(input('insertText', 'Theirs'), 'MineaTheirs')).toBe(false)
    expect(guard.tampered).toBe(true)
    expect(guard.verified).toBe('Mine')
  })

  it('rejects a second edit that copies the announced one', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('insertText', 'a'))
    expect(guard.input(input('insertText', 'a'), 'Minea')).toBe(true)
    expect(guard.input(input('insertText', 'a'), 'Mineaa')).toBe(false)
  })

  it('rejects an edit of another kind than announced', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('insertText'))
    expect(guard.input(input('historyUndo', null), '')).toBe(false)
  })

  it('ignores untrusted and cancelled announcements', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('insertText', 'a', { isTrusted: false }))
    guard.beforeInput(before('insertText', 'a', { defaultPrevented: true }))
    expect(guard.input(input('insertText'), 'Theirs')).toBe(false)
  })

  it('forgets an announcement once its task is over', () => {
    const guard = new CommentGuard('Mine')
    guard.beforeInput(before('deleteContentForward', null))
    vi.runAllTimers()
    expect(guard.input(input('deleteContentForward', null), 'Min')).toBe(false)
  })

  it('accepts IME composition, which page commands cannot produce', () => {
    const guard = new CommentGuard('')
    expect(guard.input(input('insertCompositionText', 'に'), 'に')).toBe(true)
    expect(guard.verified).toBe('に')
  })

  it('checks the value at save time', () => {
    const guard = new CommentGuard('Mine')
    expect(guard.matches('Mine')).toBe(true)
    expect(guard.matches('Theirs')).toBe(false)
  })
})
