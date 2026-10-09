// Type guards for data that crosses a trust boundary: stored collections and messages. They
// check shape, types, the caps of `LIMITS` and that no unexpected keys ride along.

import {
  type Annotation,
  type CodeOrigin,
  type Collection,
  CURATED_STYLES,
  type ElementSnapshot,
  type LegacyCollection,
  LIMITS,
  type PageInfo,
  type Rect,
  STATUSES,
  type Status,
  type Target,
} from './model'
import { pageKey } from './page-key'
import { isSite, siteOf } from './site'

export type Fields = Record<string, unknown>

const STYLE_KEYS: ReadonlySet<string> = new Set(CURATED_STYLES)
const PROTOCOLS = new Set(['http:', 'https:', 'file:'])

export function isObject(x: unknown): x is Fields {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** `x` is an object with all `required` keys and nothing beyond `required` and `optional`. */
export function hasKeys(x: unknown, required: string[], optional: string[] = []): x is Fields {
  if (!isObject(x)) return false
  const keys = Object.keys(x)
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  )
}

/** Length in code points, so a cap never depends on how a character is encoded. */
export function codePoints(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i)
    // A high surrogate followed by a low one is a single code point.
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) i++
    }
    n++
  }
  return n
}

export function isText(x: unknown, max: number, min = 0): x is string {
  if (typeof x !== 'string' || x.length > max * 2) return false
  const n = codePoints(x)
  return n >= min && n <= max
}

const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isCount = (x: unknown, min = 0): x is number => Number.isInteger(x) && (x as number) >= min

function isRect(x: unknown): x is Rect {
  return (
    hasKeys(x, ['x', 'y', 'width', 'height']) &&
    isNumber(x.x) &&
    isNumber(x.y) &&
    isNumber(x.width) &&
    isNumber(x.height) &&
    x.width >= 0 &&
    x.height >= 0
  )
}

export function isAnnotationId(x: unknown): x is string {
  return typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)
}

export function isPageUrl(x: unknown): x is string {
  if (!isText(x, LIMITS.url, 1)) return false
  try {
    return PROTOCOLS.has(new URL(x).protocol)
  } catch {
    return false
  }
}

export function isPageInfo(x: unknown): x is PageInfo {
  return (
    hasKeys(x, ['url', 'title', 'viewport', 'colorScheme']) &&
    isPageUrl(x.url) &&
    isText(x.title, LIMITS.title) &&
    hasKeys(x.viewport, ['width', 'height']) &&
    isCount(x.viewport.width) &&
    isCount(x.viewport.height) &&
    (x.colorScheme === 'light' || x.colorScheme === 'dark')
  )
}

function isOrigin(x: unknown): x is CodeOrigin {
  return (
    hasKeys(x, ['framework', 'chain']) &&
    (x.framework === 'vue' || x.framework === 'astro') &&
    Array.isArray(x.chain) &&
    x.chain.length >= 1 &&
    x.chain.length <= LIMITS.originChain &&
    x.chain.every(
      (entry) =>
        hasKeys(entry, ['file'], ['name', 'line']) &&
        isText(entry.file, LIMITS.path, 1) &&
        (entry.name === undefined || isText(entry.name, LIMITS.name, 1)) &&
        (entry.line === undefined || isCount(entry.line, 1)),
    )
  )
}

function isStyles(x: unknown): x is Record<string, string> {
  return (
    isObject(x) &&
    Object.entries(x).every(
      ([key, value]) => STYLE_KEYS.has(key) && isText(value, LIMITS.styleValue),
    )
  )
}

export function isElementSnapshot(x: unknown): x is ElementSnapshot {
  return (
    hasKeys(x, ['selector', 'openingTag', 'text', 'box', 'styles'], ['origin']) &&
    isText(x.selector, LIMITS.selector, 1) &&
    isText(x.openingTag, LIMITS.tag, 1) &&
    isText(x.text, LIMITS.text) &&
    isRect(x.box) &&
    isStyles(x.styles) &&
    (x.origin === undefined || isOrigin(x.origin))
  )
}

export function isTarget(x: unknown): x is Target {
  if (!isObject(x)) return false
  switch (x.kind) {
    case 'element':
      return hasKeys(x, ['kind', 'element']) && isElementSnapshot(x.element)
    case 'text':
      return (
        hasKeys(x, ['kind', 'selected', 'before', 'after', 'container']) &&
        isText(x.selected, LIMITS.selected, 1) &&
        // One more for the `…` the capture adds when it cut the context.
        isText(x.before, LIMITS.context + 1) &&
        isText(x.after, LIMITS.context + 1) &&
        isElementSnapshot(x.container)
      )
    case 'area':
      return (
        hasKeys(x, ['kind', 'rect', 'container', 'elements', 'moreCount']) &&
        isRect(x.rect) &&
        isElementSnapshot(x.container) &&
        Array.isArray(x.elements) &&
        x.elements.length <= LIMITS.areaElements &&
        x.elements.every(isElementSnapshot) &&
        isCount(x.moreCount)
      )
    default:
      return false
  }
}

export function isComment(x: unknown): x is string {
  return isText(x, LIMITS.comment) && (x as string).trim() !== ''
}

/** A draft's comment, which may still be empty (spec section 8). */
export const isDraftComment = (x: unknown): x is string => isText(x, LIMITS.comment)

const isTimestamp = (x: unknown): x is string => isText(x, 40, 1)

const ITEM_KEYS = ['id', 'number', 'pageKey', 'comment', 'createdAt', 'updatedAt', 'target']

/** An item without its status, as milestones 2–5 stored it; `optional` keys may follow. */
function isItem(
  x: unknown,
  keys: string[],
  optional: string[] = [],
): x is Omit<Annotation, 'status'> {
  return (
    hasKeys(x, keys, optional) &&
    isAnnotationId(x.id) &&
    isCount(x.number, 1) &&
    isText(x.pageKey, LIMITS.url, 1) &&
    (x.draft === undefined || x.draft === true) &&
    (x.draft ? isDraftComment(x.comment) : isComment(x.comment)) &&
    isTimestamp(x.createdAt) &&
    isTimestamp(x.updatedAt) &&
    isTarget(x.target)
  )
}

export const isStatus = (x: unknown): x is Status => STATUSES.includes(x as Status)

export function isAnnotation(x: unknown): x is Annotation {
  return isItem(x, [...ITEM_KEYS, 'status'], ['draft']) && isStatus((x as Fields).status)
}

export function isIdList(x: unknown, max: number): x is string[] {
  return (
    Array.isArray(x) && x.length <= max && x.every(isAnnotationId) && new Set(x).size === x.length
  )
}

/** Pages keyed by their own key, and items with unique ids and numbers below `nextNumber`. */
function isConsistent(
  pages: Record<string, unknown>,
  items: { id: string; number: number; pageKey: string }[],
  nextNumber: number,
): boolean {
  return (
    Object.entries(pages).every(([key, info]) => isPageInfo(info) && pageKey(info.url) === key) &&
    new Set(items.map((item) => item.id)).size === items.length &&
    new Set(items.map((item) => item.number)).size === items.length &&
    items.every((item) => item.number < nextNumber && Object.hasOwn(pages, item.pageKey))
  )
}

/** Whether the page `url` belongs to `site`. */
export const belongsTo = (url: string, site: string) => {
  try {
    return siteOf(url) === site
  } catch {
    return false
  }
}

export function isCollection(x: unknown): x is Collection {
  if (!hasKeys(x, ['version', 'site', 'nextNumber', 'pages', 'items', 'lastCopy'])) return false
  if (x.version !== 2 || !isSite(x.site) || !isCount(x.nextNumber, 1)) return false
  if (!isObject(x.pages) || !Array.isArray(x.items) || !x.items.every(isAnnotation)) return false
  const site = x.site
  return (
    isConsistent(x.pages, x.items, x.nextNumber) &&
    Object.keys(x.pages).every((key) => belongsTo(key, site)) &&
    isIdList(x.lastCopy, LIMITS.copied)
  )
}

/** The single collection of milestones 2–5 (spec section 5): read once, to split it by site. */
export function isLegacyCollection(x: unknown): x is LegacyCollection {
  if (!hasKeys(x, ['version', 'nextNumber', 'pages', 'items'])) return false
  if (x.version !== 1 || !isCount(x.nextNumber, 1) || !isObject(x.pages)) return false
  if (!Array.isArray(x.items) || !x.items.every((item) => isItem(item, ITEM_KEYS))) return false
  return isConsistent(x.pages, x.items, x.nextNumber)
}
