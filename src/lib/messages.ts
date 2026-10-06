// Messages between the extension's contexts. Every receiver checks shapes with these guards:
// a content script runs next to hostile page code, so nothing is trusted by type alone.

import type { CodeOrigin, PageInfo, Target } from './collection/model'
import { LIMITS } from './collection/model'
import {
  hasKeys,
  isAnnotationId,
  isComment,
  isObject,
  isPageInfo,
  isPageUrl,
  isTarget,
  isText,
} from './collection/validate'

export type Mode = 'browse' | 'element' | 'area'
export const MODES: readonly Mode[] = ['browse', 'element', 'area']

/** Overlay or side panel → background, which is the only writer of the collection. */
export type CollectionMessage =
  | { type: 'annotation:add'; id: string; page: PageInfo; target: Target; comment: string }
  | { type: 'annotation:update'; id: string; comment: string }
  | { type: 'annotation:remove'; id: string }
  | { type: 'collection:clear' }

/** Overlay → background: the code origins of the elements these selectors match. */
export type OriginMessage = { type: 'origin:read'; selectors: string[] }

/** Overlay → background: which items of its page it found and which it did not. */
export type AnchorMessage = {
  type: 'anchors:report'
  pageKey: string
  found: string[]
  missing: string[]
}

export type BackgroundMessage = CollectionMessage | OriginMessage | AnchorMessage

/** Most ids one `anchors:report` lists in each of its lists. */
const MAX_REPORTED = 1000

const isIdList = (x: unknown): x is string[] =>
  Array.isArray(x) && x.length <= MAX_REPORTED && x.every(isAnnotationId)

/** Most selectors one `origin:read` asks for: an area's container and its elements. */
export const MAX_ORIGIN_SELECTORS = LIMITS.areaElements + 1

/** Side panel → overlay of the active tab. */
export type OverlayMessage =
  | { type: 'overlay:status' }
  | { type: 'overlay:set-mode'; mode: Mode }
  | { type: 'overlay:highlight'; id: string | null }
  | { type: 'overlay:reveal'; id: string }
  | { type: 'overlay:set-pins'; visible: boolean }

/** Overlay → side panel: something the panel shows has changed; ask again. */
export type PanelMessage = { type: 'overlay:changed' }

export type Message = BackgroundMessage | OverlayMessage | PanelMessage

/** The overlay's reply to `overlay:status`. */
export interface OverlayStatus {
  host: string
  pageKey: string
  mode: Mode
  /** Whether the pins are shown. */
  pins: boolean
}

export type Reply = { ok: true } | { ok: false; error: string }

/** The background's reply to `origin:read`, one entry per selector. */
export type OriginReply =
  { ok: true; origins: (CodeOrigin | null)[] } | { ok: false; error: string }

const isMode = (x: unknown): x is Mode => MODES.includes(x as Mode)

export function isBackgroundMessage(x: unknown): x is BackgroundMessage {
  if (!isObject(x)) return false
  switch (x.type) {
    case 'annotation:add':
      return (
        hasKeys(x, ['type', 'id', 'page', 'target', 'comment']) &&
        isAnnotationId(x.id) &&
        isPageInfo(x.page) &&
        isTarget(x.target) &&
        isComment(x.comment)
      )
    case 'annotation:update':
      return hasKeys(x, ['type', 'id', 'comment']) && isAnnotationId(x.id) && isComment(x.comment)
    case 'annotation:remove':
      return hasKeys(x, ['type', 'id']) && isAnnotationId(x.id)
    case 'collection:clear':
      return hasKeys(x, ['type'])
    case 'anchors:report':
      return (
        hasKeys(x, ['type', 'pageKey', 'found', 'missing']) &&
        isPageUrl(x.pageKey) &&
        isIdList(x.found) &&
        isIdList(x.missing)
      )
    case 'origin:read':
      return (
        hasKeys(x, ['type', 'selectors']) &&
        Array.isArray(x.selectors) &&
        x.selectors.length >= 1 &&
        x.selectors.length <= MAX_ORIGIN_SELECTORS &&
        x.selectors.every((selector) => isText(selector, LIMITS.selector, 1))
      )
    default:
      return false
  }
}

export function isOverlayMessage(x: unknown): x is OverlayMessage {
  if (!isObject(x)) return false
  switch (x.type) {
    case 'overlay:status':
      return hasKeys(x, ['type'])
    case 'overlay:set-mode':
      return hasKeys(x, ['type', 'mode']) && isMode(x.mode)
    case 'overlay:highlight':
      return hasKeys(x, ['type', 'id']) && (x.id === null || isAnnotationId(x.id))
    case 'overlay:reveal':
      return hasKeys(x, ['type', 'id']) && isAnnotationId(x.id)
    case 'overlay:set-pins':
      return hasKeys(x, ['type', 'visible']) && typeof x.visible === 'boolean'
    default:
      return false
  }
}

export function isPanelMessage(x: unknown): x is PanelMessage {
  return hasKeys(x, ['type']) && x.type === 'overlay:changed'
}

export function isMessage(x: unknown): x is Message {
  return isBackgroundMessage(x) || isOverlayMessage(x) || isPanelMessage(x)
}

export function isOverlayStatus(x: unknown): x is OverlayStatus {
  return (
    hasKeys(x, ['host', 'pageKey', 'mode', 'pins']) &&
    isText(x.host, 255, 1) &&
    isText(x.pageKey, 8192, 1) &&
    isMode(x.mode) &&
    typeof x.pins === 'boolean'
  )
}
