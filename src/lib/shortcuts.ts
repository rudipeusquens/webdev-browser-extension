// The keys the settings list (spec section 8). The overlay's handlers live in
// src/entrypoints/overlay.content/keys.ts; tests/unit/shortcuts.test.ts keeps the two in step.

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
        { keys: ['Enter'], action: 'Comment on the outlined element' },
      ],
    },
    {
      title: 'Area mode',
      rows: [{ keys: ['Esc'], action: 'Cancel the drag' }],
    },
    {
      title: 'In a comment',
      rows: [
        { keys: ['Enter'], action: 'Save' },
        { keys: [shift('Enter')], action: 'New line' },
        { keys: ['Esc'], action: 'Cancel (a running dictation first)' },
        { keys: [alt('V')], action: 'Start or stop dictation' },
      ],
    },
  ]
}
