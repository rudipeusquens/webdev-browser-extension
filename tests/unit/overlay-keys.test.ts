import { describe, expect, it } from 'vitest'
import { pageShortcut, popoverKey } from '@/entrypoints/overlay.content/keys'

// Synthetic events are never trusted, so key handling is tested on plain objects; real key
// presses are covered by the E2E tests.
const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    isTrusted: true,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 0,
    ...extra,
  }) as KeyboardEvent

describe('popoverKey', () => {
  it('saves on Enter and cancels on Escape', () => {
    expect(popoverKey(key('Enter'))).toBe('save')
    expect(popoverKey(key('Escape'))).toBe('cancel')
  })

  it('leaves Shift+Enter, IME composition and other keys to the textarea', () => {
    expect(popoverKey(key('Enter', { shiftKey: true }))).toBeNull()
    expect(popoverKey(key('Enter', { isComposing: true }))).toBeNull()
    expect(popoverKey(key('Enter', { keyCode: 229 }))).toBeNull()
    expect(popoverKey(key('a'))).toBeNull()
  })

  it('ignores untrusted events', () => {
    expect(popoverKey(key('Enter', { isTrusted: false }))).toBeNull()
    expect(popoverKey(key('Escape', { isTrusted: false }))).toBeNull()
  })
})

describe('pageShortcut', () => {
  const idle = { mode: 'browse', hovering: false, drafting: false, editableFocus: false } as const
  const picking = { ...idle, mode: 'element', hovering: true } as const

  it('switches modes with E and Escape', () => {
    expect(pageShortcut(key('e'), idle)).toEqual({ mode: 'element' })
    expect(pageShortcut(key('E'), idle)).toEqual({ mode: 'element' })
    expect(pageShortcut(key('Escape'), picking)).toEqual({ mode: 'browse' })
    expect(pageShortcut(key('Escape'), idle)).toBeNull()
  })

  it('walks and selects while hovering in element mode', () => {
    expect(pageShortcut(key('ArrowUp'), picking)).toBe('up')
    expect(pageShortcut(key('ArrowDown'), picking)).toBe('down')
    expect(pageShortcut(key('Enter'), picking)).toBe('select')
    expect(pageShortcut(key('ArrowUp'), { ...picking, hovering: false })).toBeNull()
    expect(pageShortcut(key('ArrowUp'), { ...picking, mode: 'browse' })).toBeNull()
  })

  it('cancels an open comment on Escape and ignores other keys meanwhile', () => {
    const drafting = { ...picking, drafting: true }
    expect(pageShortcut(key('Escape'), drafting)).toBe('cancel')
    expect(pageShortcut(key('e'), drafting)).toBeNull()
    expect(pageShortcut(key('Enter'), drafting)).toBeNull()
  })

  it('stays out of page fields, modifier combinations and untrusted events', () => {
    expect(pageShortcut(key('e'), { ...idle, editableFocus: true })).toBeNull()
    expect(pageShortcut(key('e', { ctrlKey: true }), idle)).toBeNull()
    expect(pageShortcut(key('e', { metaKey: true }), idle)).toBeNull()
    expect(pageShortcut(key('e', { altKey: true }), idle)).toBeNull()
    expect(pageShortcut(key('e', { isTrusted: false }), idle)).toBeNull()
    expect(pageShortcut(key('Escape', { isTrusted: false }), picking)).toBeNull()
  })
})
