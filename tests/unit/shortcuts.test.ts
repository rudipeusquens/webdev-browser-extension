import { describe, expect, it } from 'vitest'
import {
  pageShortcut,
  popoverKey,
  type ShortcutState,
  spaceKey,
} from '@/entrypoints/overlay.content/keys'
import { isMacPlatform, panelKey, recKey, shortcutGroups } from '@/lib/shortcuts'

const key = (init: Partial<KeyboardEvent>) => ({
  isTrusted: true,
  key: '',
  code: '',
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  keyCode: 0,
  repeat: false,
  ...init,
})

const state = (overrides: Partial<ShortcutState> = {}): ShortcutState => ({
  mode: 'browse',
  hovering: false,
  drafting: false,
  dragging: false,
  editableFocus: false,
  ...overrides,
})

function row(groups: ReturnType<typeof shortcutGroups>, title: string, action: string) {
  const found = groups.find((g) => g.title === title)?.rows.find((r) => r.action === action)
  if (!found) throw new Error(`no row "${action}" in "${title}"`)
  return found
}

describe('the shortcut list', () => {
  const groups = shortcutGroups(false)

  it('has the groups of the spec, in order', () => {
    expect(groups.map((g) => g.title)).toEqual([
      'On the page',
      'Element mode',
      'Area mode',
      'In a pin',
      'In this panel',
    ])
  })

  it('names undo and redo in the panel, the way each platform writes them', () => {
    expect(row(groups, 'In this panel', 'Undo').keys).toEqual(['Ctrl+Z'])
    expect(row(groups, 'In this panel', 'Redo').keys).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y'])
    const mac = shortcutGroups(true)
    expect(row(mac, 'In this panel', 'Undo').keys).toEqual(['⌘Z'])
    expect(row(mac, 'In this panel', 'Redo').keys).toEqual(['⇧⌘Z'])
  })

  // Each row names a key and what it does; the overlay's handlers must do exactly that.
  it.each([
    ['On the page', 'Element mode', 'E', key({ key: 'e' }), state(), { mode: 'element' }],
    ['On the page', 'Area mode', 'A', key({ key: 'a' }), state(), { mode: 'area' }],
    ['On the page', 'Show or hide the pins', 'P', key({ key: 'p' }), state(), 'pins'],
    [
      'On the page',
      'Browse mode',
      'Esc',
      key({ key: 'Escape' }),
      state({ mode: 'element' }),
      { mode: 'browse' },
    ],
    [
      'Element mode',
      'Outline the parent',
      '↑',
      key({ key: 'ArrowUp' }),
      state({ mode: 'element', hovering: true }),
      'up',
    ],
    [
      'Element mode',
      'Outline the child again',
      '↓',
      key({ key: 'ArrowDown' }),
      state({ mode: 'element', hovering: true }),
      'down',
    ],
    [
      'Element mode',
      'Pin the outlined element',
      'Enter',
      key({ key: 'Enter' }),
      state({ mode: 'element', hovering: true }),
      'select',
    ],
    [
      'Area mode',
      'Cancel the drag',
      'Esc',
      key({ key: 'Escape' }),
      state({ mode: 'area', dragging: true }),
      'cancel',
    ],
  ])('%s: %s is %s', (title, action, shown, event, now, expected) => {
    expect(row(groups, title, action).keys).toEqual([shown])
    expect(pageShortcut(event, now)).toEqual(expected)
  })

  it.each([
    ['Save (stops a dictation first; its text follows)', 'Enter', key({ key: 'Enter' }), 'save'],
    ['New line', 'Shift+Enter', key({ key: 'Enter', shiftKey: true }), null],
    ['Close and keep the pin (cancels a dictation first)', 'Esc', key({ key: 'Escape' }), 'cancel'],
    ['Start or stop dictation', 'Alt+V', key({ key: 'v', code: 'KeyV', altKey: true }), 'voice'],
  ])('in a comment: %s is %s', (action, shown, event, expected) => {
    expect(row(groups, 'In a pin', action).keys).toEqual([shown])
    expect(popoverKey(event)).toBe(expected)
  })

  it('starts and stops dictation with Space in an empty comment', () => {
    expect(row(groups, 'In a pin', 'Start or stop dictation (empty comment)').keys).toEqual([
      'Space',
    ])
    const state = { empty: true, ready: true, recording: false, starting: false, blocked: false }
    expect(spaceKey(key({ key: ' ', code: 'Space' }), state)).toBe('dictate')
    expect(spaceKey(key({ key: ' ', code: 'Space' }), { ...state, recording: true })).toBe(
      'dictate',
    )
    expect(spaceKey(key({ key: ' ', code: 'Space' }), { ...state, empty: false })).toBeNull()
  })

  it('writes the keys the way macOS does on a Mac', () => {
    const mac = shortcutGroups(true)
    expect(row(mac, 'In a pin', 'Start or stop dictation').keys).toEqual(['⌥V'])
    expect(row(mac, 'In a pin', 'New line').keys).toEqual(['⇧Enter'])
    expect(row(mac, 'On the page', 'Element mode').keys).toEqual(['E'])
  })

  it.each([
    [false, key({ key: 'z', ctrlKey: true }), 'undo'],
    [false, key({ key: 'Z', ctrlKey: true, shiftKey: true }), 'redo'],
    [false, key({ key: 'y', ctrlKey: true }), 'redo'],
    [false, key({ key: 'z', metaKey: true }), null],
    [false, key({ key: 'z', ctrlKey: true, altKey: true }), null],
    [false, key({ key: 'z' }), null],
    [true, key({ key: 'z', metaKey: true }), 'undo'],
    [true, key({ key: 'z', metaKey: true, shiftKey: true }), 'redo'],
    [true, key({ key: 'y', metaKey: true }), null],
    [true, key({ key: 'z', ctrlKey: true }), null],
  ])('the panel keys on a Mac: %s, %j → %s', (mac, event, expected) => {
    expect(panelKey(event, mac)).toBe(expected)
  })

  it.each([
    ['Start or stop Rec', 'Alt+V', key({ key: 'v', code: 'KeyV', altKey: true }), 'toggle'],
    ['Cancel Rec', 'Esc', key({ key: 'Escape' }), 'cancel'],
  ])('in the panel: %s is %s', (action, shown, event, expected) => {
    expect(row(groups, 'In this panel', action).keys).toEqual([shown])
    expect(recKey(event)).toBe(expected)
  })

  it.each([
    // By the key's place: Option+V types "√" on a Mac.
    [key({ key: '√', code: 'KeyV', altKey: true }), 'toggle'],
    [key({ key: 'v', code: 'KeyV', altKey: true, repeat: true }), null],
    [key({ key: 'v', code: 'KeyV', altKey: true, ctrlKey: true }), null],
    [key({ key: 'V', code: 'KeyV', altKey: true, shiftKey: true }), null],
    [key({ key: 'v', code: 'KeyV', altKey: true, metaKey: true }), null],
    [key({ key: 'v', code: 'KeyV' }), null],
    [key({ key: 'Escape', isComposing: true }), null],
  ])("Rec's keys: %j → %s", (event, expected) => {
    expect(recKey(event)).toBe(expected)
  })

  it("writes Rec's key the way macOS does on a Mac", () => {
    expect(row(shortcutGroups(true), 'In this panel', 'Start or stop Rec').keys).toEqual(['⌥V'])
  })

  it('tells a Mac by its platform', () => {
    expect(isMacPlatform('MacIntel')).toBe(true)
    expect(isMacPlatform('macOS')).toBe(true)
    expect(isMacPlatform('Linux x86_64')).toBe(false)
    expect(isMacPlatform('Win32')).toBe(false)
    expect(isMacPlatform('')).toBe(false)
  })
})
