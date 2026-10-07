// The data model of spec section 5. Everything here is stored in `chrome.storage.local`.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PageInfo {
  url: string
  title: string
  viewport: { width: number; height: number }
  colorScheme: 'light' | 'dark'
}

export interface CodeOrigin {
  framework: 'vue' | 'astro'
  /** Outermost → innermost. */
  chain: { name?: string; file: string; line?: number }[]
}

export interface ElementSnapshot {
  selector: string
  openingTag: string
  text: string
  /** Page coordinates. */
  box: Rect
  /** Properties from `CURATED_STYLES` only, in that order. */
  styles: Record<string, string>
  origin?: CodeOrigin
}

export type ElementTarget = { kind: 'element'; element: ElementSnapshot }
export type TextTarget = {
  kind: 'text'
  selected: string
  /** Context as captured, including a leading `…` when it was cut. */
  before: string
  /** Context as captured, including a trailing `…` when it was cut. */
  after: string
  container: ElementSnapshot
}
export type AreaTarget = {
  kind: 'area'
  rect: Rect
  container: ElementSnapshot
  elements: ElementSnapshot[]
  moreCount: number
}
export type Target = ElementTarget | TextTarget | AreaTarget

/** Open when created; done once copied as prompt; deleted until "Clear all" removes it. */
export type Status = 'open' | 'done' | 'deleted'
export const STATUSES: readonly Status[] = ['open', 'done', 'deleted']

export interface Annotation {
  id: string
  /** Stable within its site; reset by "Clear all". */
  number: number
  pageKey: string
  comment: string
  createdAt: string
  updatedAt: string
  status: Status
  target: Target
}

/** The items of one site (spec section 5), stored under `collection:<site>`. */
export interface Collection {
  version: 2
  /** `siteOf()` of every page in it. */
  site: string
  nextNumber: number
  /** Key: the page URL without its hash (`pageKey()`). */
  pages: Record<string, PageInfo>
  items: Annotation[]
  /** The ids the last "Copy as prompt" copied, for "Copy again". */
  lastCopy: string[]
}

/** What milestones 2–5 stored: one collection of every site under `collection`. */
export interface LegacyCollection {
  version: 1
  nextNumber: number
  pages: Record<string, PageInfo>
  items: Omit<Annotation, 'status'>[]
}

/** Spec section 6, in output order. */
export const CURATED_STYLES = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'gap',
  'flex-direction',
  'justify-content',
  'align-items',
  'grid-template-columns',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'border',
  'border-radius',
] as const

/** Caps for page-derived strings (code points) and lists. */
export const LIMITS = {
  text: 120,
  selected: 500,
  context: 40,
  originChain: 5,
  areaElements: 10,
  selectorDepth: 8,
  comment: 5000,
  title: 120,
  tag: 200,
  attribute: 60,
  styleValue: 80,
  url: 8192,
  selector: 1000,
  path: 500,
  name: 100,
  /** Ids one "Copy as prompt" remembers, and copies at once. */
  copied: 1000,
} as const
