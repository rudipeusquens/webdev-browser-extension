// Messages between the extension's contexts. Every receiver checks shapes with these guards:
// a content script runs next to hostile page code, so nothing is trusted by type alone.

import type { PageInfo, Target } from './collection/model'
import {
  hasKeys,
  isAnnotationId,
  isComment,
  isObject,
  isPageInfo,
  isTarget,
  isText,
} from './collection/validate'

export type Mode = 'browse' | 'element' | 'area'
export const MODES: readonly Mode[] = ['browse', 'element', 'area']

/** Overlay or side panel → background, which is the only writer of the collection. */
export type BackgroundMessage =
  | { type: 'annotation:add'; id: string; page: PageInfo; target: Target; comment: string }
  | { type: 'annotation:update'; id: string; comment: string }
  | { type: 'annotation:remove'; id: string }
  | { type: 'collection:clear' }

/** Side panel → overlay of the active tab. */
export type OverlayMessage =
  | { type: 'overlay:status' }
  | { type: 'overlay:set-mode'; mode: Mode }
  | { type: 'overlay:highlight'; id: string | null }
  | { type: 'overlay:reveal'; id: string }

/** Overlay → side panel: something the panel shows has changed; ask again. */
export type PanelMessage = { type: 'overlay:changed' }

export type Message = BackgroundMessage | OverlayMessage | PanelMessage

/** The overlay's reply to `overlay:status`. */
export interface OverlayStatus {
  host: string
  pageKey: string
  mode: Mode
}

export type Reply = { ok: true } | { ok: false; error: string }

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
    hasKeys(x, ['host', 'pageKey', 'mode']) &&
    isText(x.host, 255, 1) &&
    isText(x.pageKey, 8192, 1) &&
    isMode(x.mode)
  )
}
