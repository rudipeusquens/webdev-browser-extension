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
    code: '',
    ...extra,
  }) as KeyboardEvent

describe('popoverKey', () => {
  it('saves on Enter and cancels on Escape', () => {
    expect(popoverKey(key('Enter'))).toBe('save')
    expect(popoverKey(key('Escape'))).toBe('cancel')
  })

  it('leaves Escape during IME composition to the input method', () => {
    expect(popoverKey(key('Escape', { isComposing: true }))).toBeNull()
    expect(popoverKey(key('Escape', { keyCode: 229 }))).toBeNull()
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
    expect(popoverKey(key('v', { code: 'KeyV', altKey: true, isTrusted: false }))).toBeNull()
  })

  it('starts and stops dictation on Alt+V, by where the key sits on the keyboard', () => {
    expect(popoverKey(key('v', { code: 'KeyV', altKey: true }))).toBe('voice')
    // macOS types a character with Option+V.
    expect(popoverKey(key('√', { code: 'KeyV', altKey: true }))).toBe('voice')
    expect(popoverKey(key('v', { code: 'KeyV' }))).toBeNull()
  })

  // Held down, Alt+V would start and stop at the key repeat rate, each stop a paid request.
  it('ignores Alt+V repeated by a held key', () => {
    expect(popoverKey(key('v', { code: 'KeyV', altKey: true, repeat: true }))).toBeNull()
  })

  it('leaves Alt+V with other modifiers and during composition alone', () => {
    for (const extra of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { isComposing: true },
      { keyCode: 229 },
    ]) {
      expect(popoverKey(key('v', { code: 'KeyV', altKey: true, ...extra }))).toBeNull()
    }
  })
})

describe('pageShortcut', () => {
  const idle = {
    mode: 'browse',
    hovering: false,
    drafting: false,
    dragging: false,
    editableFocus: false,
  } as const
  const picking = { ...idle, mode: 'element', hovering: true } as const

  it('switches modes with E and Escape', () => {
    expect(pageShortcut(key('e'), idle)).toEqual({ mode: 'element' })
    expect(pageShortcut(key('E'), idle)).toEqual({ mode: 'element' })
    expect(pageShortcut(key('Escape'), picking)).toEqual({ mode: 'browse' })
    expect(pageShortcut(key('Escape'), idle)).toBeNull()
  })

  it('shows and hides the pins with P, in every mode', () => {
    expect(pageShortcut(key('p'), idle)).toBe('pins')
    expect(pageShortcut(key('P'), picking)).toBe('pins')
    expect(pageShortcut(key('p'), { ...idle, mode: 'area' })).toBe('pins')
  })

  it('leaves P to fields, the comment and the browser', () => {
    expect(pageShortcut(key('p'), { ...idle, editableFocus: true })).toBeNull()
    expect(pageShortcut(key('p'), { ...idle, drafting: true })).toBeNull()
    // Ctrl+P and Cmd+P print.
    expect(pageShortcut(key('p', { ctrlKey: true }), idle)).toBeNull()
    expect(pageShortcut(key('p', { metaKey: true }), idle)).toBeNull()
    expect(pageShortcut(key('p', { altKey: true }), idle)).toBeNull()
    expect(pageShortcut(key('p', { isTrusted: false }), idle)).toBeNull()
  })

  it('toggles the pins once while P is held down', () => {
    expect(pageShortcut(key('p', { repeat: true }), idle)).toBeNull()
  })

  it('switches to area mode with A', () => {
    expect(pageShortcut(key('a'), idle)).toEqual({ mode: 'area' })
    expect(pageShortcut(key('A'), picking)).toEqual({ mode: 'area' })
    expect(pageShortcut(key('a'), { ...idle, drafting: true })).toBeNull()
    expect(pageShortcut(key('a'), { ...idle, editableFocus: true })).toBeNull()
    expect(pageShortcut(key('a', { ctrlKey: true }), idle)).toBeNull()
    expect(pageShortcut(key('e'), { ...idle, mode: 'area' })).toEqual({ mode: 'element' })
  })

  it('cancels a drag on Escape before leaving area mode', () => {
    const area = { ...idle, mode: 'area' } as const
    expect(pageShortcut(key('Escape'), { ...area, dragging: true })).toBe('cancel')
    expect(pageShortcut(key('Escape'), area)).toEqual({ mode: 'browse' })
    expect(pageShortcut(key('Enter'), area)).toBeNull()
    expect(pageShortcut(key('ArrowUp'), { ...area, hovering: true })).toBeNull()
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
