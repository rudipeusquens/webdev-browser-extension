import { vi } from 'vitest'
import type { Browser } from 'wxt/browser'
import { fakeBrowser } from 'wxt/testing/fake-browser'

type Entry = Browser.contextMenus.CreateProperties
type Clicked = (info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) => void

/**
 * Context menu entries and clicks on them, as Chrome 116 has them: WXT's fake browser does not
 * implement them. With `later`, the callbacks run in a later task, as Chrome runs them.
 */
export function fakeContextMenus({ later = false } = {}) {
  const call = (callback?: () => void) => {
    if (later) setTimeout(() => callback?.())
    else callback?.()
  }
  const listeners: Clicked[] = []
  const state = {
    entries: new Map<string | number, Entry>(),
    /** Ids created while an entry with the same id existed: Chrome refuses those. */
    duplicates: [] as (string | number)[],
    /** The user picks the entry `menuItemId` in `tab`. */
    click(menuItemId: string, tab?: Browser.tabs.Tab) {
      const info = { menuItemId, editable: false, pageUrl: 'http://x.test/' }
      for (const listener of listeners) listener(info, tab)
    },
  }
  vi.spyOn(fakeBrowser.contextMenus, 'create').mockImplementation(((
    properties: Entry,
    callback?: () => void,
  ) => {
    const id = properties.id ?? state.entries.size
    if (state.entries.has(id)) state.duplicates.push(id)
    else state.entries.set(id, properties)
    call(callback)
    return id
  }) as never)
  // Callbacks only, no promise: Chrome returns promises here from version 123 on, the
  // manifest allows 116.
  vi.spyOn(fakeBrowser.contextMenus, 'removeAll').mockImplementation(((callback?: () => void) => {
    state.entries.clear()
    call(callback)
  }) as never)
  vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation(((
    listener: Clicked,
  ) => {
    listeners.push(listener)
  }) as never)
  return state
}
