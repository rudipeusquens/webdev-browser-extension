import { vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'

type Script = { id: string; matches?: string[]; js?: string[]; runAt?: string }
type Removed = (permissions: { origins?: string[] }) => void

/**
 * In-memory host permissions, registered content scripts and `permissions.onRemoved`: WXT's
 * fake browser does not implement them. `granted` are the origin patterns Chrome grants.
 */
export function fakeSites(granted: string[] = []) {
  const state = {
    granted: new Set(granted),
    scripts: new Map<string, Script>(),
    removedListeners: [] as Removed[],
    injected: [] as number[],
  }
  vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation((async ({
    origins = [],
  }: {
    origins?: string[]
  }) => origins.every((o) => state.granted.has(o))) as never)
  vi.spyOn(fakeBrowser.permissions, 'request').mockImplementation((async ({
    origins = [],
  }: {
    origins?: string[]
  }) => {
    for (const o of origins) state.granted.add(o)
    return true
  }) as never)
  vi.spyOn(fakeBrowser.permissions, 'remove').mockImplementation((async ({
    origins = [],
  }: {
    origins?: string[]
  }) => {
    for (const o of origins) state.granted.delete(o)
    return true
  }) as never)
  vi.spyOn(fakeBrowser.permissions.onRemoved, 'addListener').mockImplementation(((
    listener: Removed,
  ) => {
    state.removedListeners.push(listener)
  }) as never)
  vi.spyOn(fakeBrowser.scripting, 'getRegisteredContentScripts').mockImplementation(
    (async (filter?: { ids?: string[] }) =>
      [...state.scripts.values()].filter(
        (s) => !filter?.ids || filter.ids.includes(s.id),
      )) as never,
  )
  vi.spyOn(fakeBrowser.scripting, 'registerContentScripts').mockImplementation((async (
    scripts: Script[],
  ) => {
    for (const s of scripts) {
      if (state.scripts.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`)
      state.scripts.set(s.id, s)
    }
  }) as never)
  vi.spyOn(fakeBrowser.scripting, 'updateContentScripts').mockImplementation((async (
    scripts: Script[],
  ) => {
    for (const s of scripts) {
      const old = state.scripts.get(s.id)
      if (!old) throw new Error(`No script with ID '${s.id}'`)
      state.scripts.set(s.id, { ...old, ...s })
    }
  }) as never)
  vi.spyOn(fakeBrowser.scripting, 'unregisterContentScripts').mockImplementation((async (filter?: {
    ids?: string[]
  }) => {
    for (const id of filter?.ids ?? [...state.scripts.keys()]) state.scripts.delete(id)
  }) as never)
  return {
    state,
    /** What Chrome does when access is revoked in chrome://extensions. */
    revoke(origin: string) {
      state.granted.delete(origin)
      for (const listener of state.removedListeners) listener({ origins: [origin] })
    },
  }
}
