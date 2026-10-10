// The extension's settings (spec section 5), in `chrome.storage.local`; only the background
// writes them. The voice settings and the API key have storage keys of their own
// (src/lib/voice/settings.ts, src/lib/voice/key.ts).

import { isObject, isText } from './collection/validate'
import { loadStored, watchStored } from './storage'

export interface Settings {
  /** Sites whose pages load the overlay by themselves: mirrors granted host permissions. */
  rememberedOrigins: string[]
  /** Page headings in the panel show the page's title next to its path. */
  pageTitles: boolean
  /** "Annotate this page" in the page's context menu. */
  contextMenu: boolean
}

/** The settings the panel switches on and off. */
export type Option = 'pageTitles' | 'contextMenu'
export const OPTIONS: readonly Option[] = ['pageTitles', 'contextMenu']

export const SETTINGS_KEY = 'settings'
/** Most remembered sites: one registered script lists them all. */
export const MAX_SITES = 100

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

export const isOption = (x: unknown): x is Option => OPTIONS.includes(x as Option)

function isOrigins(x: unknown): x is string[] {
  return (
    Array.isArray(x) &&
    x.length <= MAX_SITES &&
    x.every(isSiteOrigin) &&
    new Set(x).size === x.length
  )
}

/** What is stored, each part on its own: an option it cannot read is off. */
function parse(value: unknown): Settings {
  const fields = isObject(value) ? value : {}
  return {
    rememberedOrigins: isOrigins(fields.rememberedOrigins) ? fields.rememberedOrigins : [],
    pageTitles: fields.pageTitles === true,
    contextMenu: fields.contextMenu === true,
  }
}

export const defaultSettings = (): Settings => parse(undefined)

export const loadSettings = (): Promise<Settings> => loadStored(SETTINGS_KEY, parse)

/** Calls `cb` with the new settings whenever they change; returns a function that stops. */
export const watchSettings = (cb: (settings: Settings) => void): (() => void) =>
  watchStored(SETTINGS_KEY, parse, cb)
