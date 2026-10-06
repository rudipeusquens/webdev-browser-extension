// Remembered sites: origins whose pages load the overlay by themselves (spec section 8). The
// developer remembers a site in the panel, which asks Chrome for access first; the background
// keeps the settings, Chrome's grants and the registered overlay script in step, one change
// at a time.

import { browser } from 'wxt/browser'
import type { Reply } from '../messages'
import { loadSettings, originPattern, type Settings, SETTINGS_KEY } from '../settings'

const SCRIPT_ID = 'overlay'
export const OVERLAY_SCRIPT = 'content-scripts/overlay.js'

async function register(origins: string[]) {
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
  if (origins.length === 0) {
    if (registered.length > 0)
      await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] })
    return
  }
  const script = {
    id: SCRIPT_ID,
    matches: origins.map(originPattern),
    js: [OVERLAY_SCRIPT],
    runAt: 'document_idle' as const,
    persistAcrossSessions: true,
  }
  if (registered.length > 0) await browser.scripting.updateContentScripts([script])
  else await browser.scripting.registerContentScripts([script])
}

const granted = (origin: string) =>
  browser.permissions.contains({ origins: [originPattern(origin)] }).catch(() => false)

export function createSites() {
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  async function save(settings: Settings, origins: string[]) {
    const next = { ...settings, rememberedOrigins: [...new Set(origins)].sort() }
    await browser.storage.local.set({ [SETTINGS_KEY]: next })
    await register(next.rememberedOrigins)
  }

  return {
    /** Remembers `origin` once Chrome grants access to it. */
    remember: (origin: string): Promise<Reply> =>
      inOrder(async () => {
        if (!(await granted(origin))) {
          return { ok: false, error: 'Chrome did not grant access to this site.' }
        }
        const settings = await loadSettings()
        await save(settings, [...settings.rememberedOrigins, origin])
        return { ok: true }
      }),

    /** Forgets `origin` and gives Chrome's access back. */
    forget: (origin: string): Promise<Reply> =>
      inOrder(async () => {
        const settings = await loadSettings()
        await save(
          settings,
          settings.rememberedOrigins.filter((o) => o !== origin),
        )
        // Fails for access the manifest requires (test builds); forgetting still holds.
        await browser.permissions.remove({ origins: [originPattern(origin)] }).catch(() => false)
        return { ok: true }
      }),

    /** Drops origins Chrome no longer grants and writes the registration again. */
    reconcile: (): Promise<string[]> =>
      inOrder(async () => {
        const settings = await loadSettings()
        const kept: string[] = []
        for (const origin of settings.rememberedOrigins)
          if (await granted(origin)) kept.push(origin)
        await save(settings, kept)
        return kept
      }),

    isRemembered: async (origin: string) =>
      (await loadSettings()).rememberedOrigins.includes(origin),
  }
}
