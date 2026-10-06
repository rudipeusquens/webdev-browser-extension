// Messages between the extension's contexts. Every receiver checks shapes with these guards:
// a content script runs next to hostile page code, so nothing is trusted by type alone.

import type { CodeOrigin, PageInfo, Target } from './collection/model'
import { LIMITS } from './collection/model'
import { isSite } from './collection/site'
import { isSiteOrigin } from './settings'
import { type Filter, isFilter } from './view'
import { isApiKey, isLanguage, isModelId } from './voice/settings'
import {
  hasKeys,
  isAnnotationId,
  isComment,
  isIdList as isIdSet,
  isObject,
  isPageInfo,
  isPageUrl,
  isTarget,
  isText,
} from './collection/validate'

export type Mode = 'browse' | 'element' | 'area'
export const MODES: readonly Mode[] = ['browse', 'element', 'area']

/**
 * Overlay or side panel → background, which is the only writer of the collections. Each names
 * the site whose collection it changes; `annotation:add` takes it from its page.
 */
export type CollectionMessage =
  | { type: 'annotation:add'; id: string; page: PageInfo; target: Target; comment: string }
  | { type: 'annotation:update'; site: string; id: string; comment: string }
  /** Marks the item deleted; only "Clear all" removes items. */
  | { type: 'annotation:remove'; site: string; id: string }
  /** Deleted → open. */
  | { type: 'annotation:restore'; site: string; id: string }
  /** Done → open. */
  | { type: 'annotation:reopen'; site: string; id: string }
  /** The panel copied exactly these items as a prompt: open ones become done. */
  | { type: 'collection:copied'; site: string; ids: string[] }
  | { type: 'collection:clear'; site: string }

/** Overlay → background: the code origins of the elements these selectors match. */
export type OriginMessage = { type: 'origin:read'; selectors: string[] }

/** Overlay → background: which items of its page it found and which it did not. */
export type AnchorMessage = {
  type: 'anchors:report'
  pageKey: string
  found: string[]
  missing: string[]
}

/** Side panel → background: remember or forget a site (Always enable here). */
export type SiteMessage =
  { type: 'site:remember'; origin: string } | { type: 'site:forget'; origin: string }

/** Side panel → background: undo or redo the site's last change (spec section 5). */
export type HistoryMessage =
  { type: 'history:undo'; site: string } | { type: 'history:redo'; site: string }

/** Side panel → background: list and pin these items from now on (spec section 5). */
export type ViewMessage = { type: 'view:set'; filter: Filter }

/** Side panel → background: open a page of the collection in a tab (Go to). */
export type GoToMessage = { type: 'tab:go'; tabId: number; pageKey: string }

/** Overlay → background: it could not start; the error itself stays in the page's console. */
export type FailedMessage = { type: 'overlay:failed' }

/** Side panel → background: the voice settings and the OpenRouter key (spec section 9). */
export type VoiceSettingsMessage =
  | { type: 'voice:set'; model: string; language: string }
  | { type: 'voice:key:save'; key: string }
  | { type: 'voice:key:remove' }
  | { type: 'voice:key:test' }

/**
 * Overlay → background, from a trusted click in the comment popover: open the microphone page
 * (Grant), or the panel on its settings (Open settings).
 */
export type VoiceRequestMessage = { type: 'voice:grant' } | { type: 'voice:settings' }

/**
 * `storage.session` entry the background writes for **Open settings**: the panel of that window
 * opens its settings, also when it opens only now.
 */
export const PANEL_VIEW_KEY = 'panelView'
export type PanelView = { windowId: number; view: 'settings'; at: number }

export type BackgroundMessage =
  | CollectionMessage
  | OriginMessage
  | AnchorMessage
  | SiteMessage
  | HistoryMessage
  | ViewMessage
  | GoToMessage
  | FailedMessage
  | VoiceSettingsMessage
  | VoiceRequestMessage

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

/**
 * Overlay → side panel: something the panel shows has changed; ask again. It names the overlay,
 * so the panel keeps a line to it even on a tab it does not show.
 */
export type PanelMessage = { type: 'overlay:changed'; instance: string }

/**
 * Background → side panel: the toolbar icon or its shortcut was used on this tab. An open panel
 * of that window whose page is active there closes itself and says so (spec section 8).
 */
export type PanelToggle = { type: 'panel:toggle'; windowId: number; tabId: number }
export type PanelToggleReply = { closing: boolean }

/**
 * Side panel → overlay, on the line it keeps open to every overlay it showed: it moved to
 * another tab. The overlay drops the panel's highlight and keeps its mode; the line goes only
 * when the panel closes (or a new overlay replaces this one).
 */
export type PanelAway = { type: 'panel:away' }

export type Message = BackgroundMessage | OverlayMessage | PanelMessage

/** The overlay's reply to `overlay:status`. */
export interface OverlayStatus {
  host: string
  pageKey: string
  mode: Mode
  /** Whether the pins are shown. */
  pins: boolean
  /** Random id of this overlay: a second toolbar click starts a new one on the same tab. */
  instance: string
}

export type Reply = { ok: true } | { ok: false; error: string }

/** Background → side panels: the key was saved or removed; read it again (never its value). */
export type KeyChanged = { type: 'voice:key:changed' }

export function isKeyChanged(x: unknown): x is KeyChanged {
  return hasKeys(x, ['type']) && x.type === 'voice:key:changed'
}

/** The background's reply to `voice:key:test`. */
export type KeyTestReply = { ok: true; valid: boolean } | { ok: false; error: string }

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
      return (
        hasKeys(x, ['type', 'site', 'id', 'comment']) &&
        isSite(x.site) &&
        isAnnotationId(x.id) &&
        isComment(x.comment)
      )
    case 'annotation:remove':
    case 'annotation:restore':
    case 'annotation:reopen':
      return hasKeys(x, ['type', 'site', 'id']) && isSite(x.site) && isAnnotationId(x.id)
    case 'collection:copied':
      return (
        hasKeys(x, ['type', 'site', 'ids']) &&
        isSite(x.site) &&
        isIdSet(x.ids, LIMITS.copied) &&
        x.ids.length >= 1
      )
    case 'collection:clear':
      return hasKeys(x, ['type', 'site']) && isSite(x.site)
    case 'overlay:failed':
    case 'voice:key:remove':
    case 'voice:key:test':
    case 'voice:grant':
    case 'voice:settings':
      return hasKeys(x, ['type'])
    case 'voice:set':
      return (
        hasKeys(x, ['type', 'model', 'language']) && isModelId(x.model) && isLanguage(x.language)
      )
    case 'voice:key:save':
      return hasKeys(x, ['type', 'key']) && isApiKey(x.key)
    case 'history:undo':
    case 'history:redo':
      return hasKeys(x, ['type', 'site']) && isSite(x.site)
    case 'view:set':
      return hasKeys(x, ['type', 'filter']) && isFilter(x.filter)
    case 'tab:go':
      return (
        hasKeys(x, ['type', 'tabId', 'pageKey']) &&
        Number.isInteger(x.tabId) &&
        (x.tabId as number) >= 0 &&
        isPageUrl(x.pageKey)
      )
    case 'site:remember':
    case 'site:forget':
      return hasKeys(x, ['type', 'origin']) && isSiteOrigin(x.origin)
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
  return (
    hasKeys(x, ['type', 'instance']) && x.type === 'overlay:changed' && isAnnotationId(x.instance)
  )
}

export function isPanelToggle(x: unknown): x is PanelToggle {
  return (
    hasKeys(x, ['type', 'windowId', 'tabId']) &&
    x.type === 'panel:toggle' &&
    Number.isInteger(x.windowId) &&
    Number.isInteger(x.tabId)
  )
}

export function isPanelToggleReply(x: unknown): x is PanelToggleReply {
  return hasKeys(x, ['closing']) && typeof x.closing === 'boolean'
}

export function isPanelAway(x: unknown): x is PanelAway {
  return hasKeys(x, ['type']) && x.type === 'panel:away'
}

export function isMessage(x: unknown): x is Message {
  return isBackgroundMessage(x) || isOverlayMessage(x) || isPanelMessage(x)
}

export function isOverlayStatus(x: unknown): x is OverlayStatus {
  return (
    hasKeys(x, ['host', 'pageKey', 'mode', 'pins', 'instance']) &&
    isAnnotationId(x.instance) &&
    isText(x.host, 255, 1) &&
    isText(x.pageKey, 8192, 1) &&
    isMode(x.mode) &&
    typeof x.pins === 'boolean'
  )
}

export function isPanelView(x: unknown): x is PanelView {
  return (
    hasKeys(x, ['windowId', 'view', 'at']) &&
    Number.isInteger(x.windowId) &&
    x.view === 'settings' &&
    typeof x.at === 'number' &&
    Number.isFinite(x.at)
  )
}
