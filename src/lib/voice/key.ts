// The developer's OpenRouter key (spec section 9), under its own storage key, never inside the
// settings object. The background and the settings view read it; the overlay must never import
// this module (an ESLint rule in eslint.config.mjs guards that).

import { browser } from 'wxt/browser'
import { isApiKey } from './settings'

export { isApiKey }

export const KEY_STORAGE = 'openrouterKey'
const PREFIX = 'sk-or-v1-'

export async function loadKey(): Promise<string | undefined> {
  const stored = await browser.storage.local.get(KEY_STORAGE)
  const key = stored[KEY_STORAGE]
  return isApiKey(key) ? key : undefined
}

/** The key as the settings show it once saved: its prefix and the last four characters. */
export function maskKey(key: string): string {
  return `${key.startsWith(PREFIX) ? PREFIX : ''}…${key.slice(-4)}`
}
