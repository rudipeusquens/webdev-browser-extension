// The keys the settings list (spec section 8). The overlay's handlers live in
// src/entrypoints/overlay.content/keys.ts, the panel's here; tests/unit/shortcuts.test.ts keeps
// the list and the handlers in step.

export interface ShortcutRow {
  /** Alternatives, each written as one key combination. */
  keys: string[]
  action: string
}

export interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

export function isMacPlatform(platform: string): boolean {
  return /^mac/i.test(platform)
}

/** The panel's own keys: Undo and Redo, with ⌘ on macOS and Ctrl elsewhere. */
export function panelKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  mac: boolean,
): 'undo' | 'redo' | null {
  const command = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!command || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !mac && !e.shiftKey) return 'redo'
  return null
}

/**
 * Rec in the panel: `Alt+V` starts and stops it, like dictation in a pin, by the key's place
 * (Option+V types a character on macOS) and not at the key repeat rate; `Escape` cancels it.
 */
export function recKey(
  e: Pick<
    KeyboardEvent,
    'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'repeat' | 'isComposing'
  >,
): 'toggle' | 'cancel' | null {
  if (e.isComposing) return null
  if (e.key === 'Escape') return 'cancel'
  if (e.code === 'KeyV' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    return e.repeat ? null : 'toggle'
  }
  return null
}

/** The platform as the browser names it, for `isMacPlatform`. */
export function currentPlatform(): string {
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData
  return data?.platform || navigator.platform || ''
}

export function shortcutGroups(mac: boolean): ShortcutGroup[] {
  const shift = (key: string) => (mac ? `⇧${key}` : `Shift+${key}`)
  const alt = (key: string) => (mac ? `⌥${key}` : `Alt+${key}`)
  return [
    {
      title: 'On the page',
      rows: [
        { keys: ['E'], action: 'Element mode' },
        { keys: ['A'], action: 'Area mode' },
        { keys: ['Esc'], action: 'Browse mode' },
        { keys: ['P'], action: 'Show or hide the pins' },
      ],
    },
    {
      title: 'Element mode',
      rows: [
        { keys: ['↑'], action: 'Outline the parent' },
        { keys: ['↓'], action: 'Outline the child again' },
        { keys: ['Enter'], action: 'Pin the outlined element' },
      ],
    },
    {
      title: 'Area mode',
      rows: [{ keys: ['Esc'], action: 'Cancel the drag' }],
    },
    {
      title: 'In a pin',
      rows: [
        { keys: ['Enter'], action: 'Save' },
        { keys: [shift('Enter')], action: 'New line' },
        { keys: ['Esc'], action: 'Cancel (a running dictation first)' },
        { keys: [alt('V')], action: 'Start or stop dictation' },
      ],
    },
    {
      title: 'In this panel',
      rows: [
        { keys: [mac ? '⌘Z' : 'Ctrl+Z'], action: 'Undo' },
        { keys: mac ? ['⇧⌘Z'] : ['Ctrl+Shift+Z', 'Ctrl+Y'], action: 'Redo' },
        { keys: [alt('V')], action: 'Start or stop Rec' },
        { keys: ['Esc'], action: 'Cancel Rec' },
      ],
    },
  ]
}
