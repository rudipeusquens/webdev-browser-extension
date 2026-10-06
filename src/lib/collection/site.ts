// Sites (spec section 5): each has its own collection, numbers, copy, clear and undo history.

import { isSiteOrigin } from '../settings'

/** Every local file belongs to one site. */
const FILES = 'file://'

/**
 * The site of a page: its origin (scheme, host, port) for `http:` and `https:`, `file://` for
 * local files. Throws for anything else, such as `chrome:` or `javascript:` URLs.
 */
export function siteOf(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol === 'file:') return FILES
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin
  throw new Error('Not a page of a site.')
}

/** A site as `siteOf` writes it. */
export function isSite(x: unknown): x is string {
  return x === FILES || isSiteOrigin(x)
}

/** What the panel shows for a site: its host and port, or "Local files". */
export function siteLabel(site: string): string {
  return site === FILES ? 'Local files' : new URL(site).host
}
