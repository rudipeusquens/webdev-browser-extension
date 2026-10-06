// The extension's settings (spec section 5), in `chrome.storage.local`; only the background
// writes them. Milestone 5 adds the voice settings.

import { browser } from 'wxt/browser'
import { hasKeys, isText } from './collection/validate'

export interface Settings {
  /** Sites whose pages load the overlay by themselves: mirrors granted host permissions. */
  rememberedOrigins: string[]
}

export const SETTINGS_KEY = 'settings'
const MAX_SITES = 100

export const defaultSettings = (): Settings => ({ rememberedOrigins: [] })

/** An `http:` or `https:` origin as `URL.origin` writes it: no path, user, default port. */
export function isSiteOrigin(x: unknown): x is string {
  if (!isText(x, 255, 1)) return false
  try {
    const url = new URL(x)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === x
  } catch {
    return false
  }
}

/** The match pattern for every page of `origin`. */
export const originPattern = (origin: string) => `${origin}/*`

export function isSettings(x: unknown): x is Settings {
  return (
    hasKeys(x, ['rememberedOrigins']) &&
    Array.isArray(x.rememberedOrigins) &&
    x.rememberedOrigins.length <= MAX_SITES &&
    x.rememberedOrigins.every(isSiteOrigin) &&
    new Set(x.rememberedOrigins).size === x.rememberedOrigins.length
  )
}

const parse = (value: unknown): Settings => (isSettings(value) ? value : defaultSettings())

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY)
  return parse(stored[SETTINGS_KEY])
}

/** Calls `cb` with the new settings whenever they change; returns a function that stops. */
export function watchSettings(cb: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[SETTINGS_KEY]
    if (area === 'local' && change) cb(parse(change.newValue))
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}
