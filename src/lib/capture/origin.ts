// Code origin of an element (spec section 6): the Vue components that rendered it, read in
// the page's world by the bridge (origin-bridge.ts) and checked here, or the source
// attributes an Astro dev server writes into the page. Both come from the page: they are
// validated, cleaned and capped like any other page text.

import type { CodeOrigin } from '../collection/model'
import { LIMITS } from '../collection/model'
import { hasKeys, isText } from '../collection/validate'
import { clean } from '../text'
import { attributeOf, closestOf } from './dom'

type Entry = CodeOrigin['chain'][number]

const cleaned = (x: unknown, max: number): string | undefined => {
  if (typeof x !== 'string') return undefined
  // Longer than any value that could pass: no need to clean it first.
  if (x.length > max * 4) return undefined
  const value = clean(x)
  return isText(value, max, 1) ? value : undefined
}

function entryOf(raw: unknown): Entry | null | undefined {
  if (!hasKeys(raw, [], ['name', 'file'])) return undefined
  const file = cleaned(raw.file, LIMITS.path)
  if (!file) return null
  const name = cleaned(raw.name, LIMITS.name)
  return name ? { name, file } : { file }
}

/**
 * The bridge's report for one element as a code origin: components with a file, the
 * innermost five, outermost first. Undefined for anything malformed or without a file.
 */
export function parseVueOrigin(raw: unknown): CodeOrigin | undefined {
  if (!hasKeys(raw, ['chain']) || !Array.isArray(raw.chain)) return undefined
  const chain: Entry[] = []
  for (const item of raw.chain as unknown[]) {
    const entry = entryOf(item)
    if (entry === undefined) return undefined
    if (entry) chain.push(entry)
  }
  if (chain.length === 0) return undefined
  return { framework: 'vue', chain: chain.slice(-LIMITS.originChain) }
}

const LINE = /^(\d{1,7})(?::\d{1,7})?$/

/** The Astro source of the element: the nearest `data-astro-source-file`, with its line. */
export function astroOrigin(el: Element): CodeOrigin | undefined {
  const source = closestOf(el, '[data-astro-source-file]')
  if (!source) return undefined
  const file = cleaned(attributeOf(source, 'data-astro-source-file'), LIMITS.path)
  if (!file) return undefined
  const line = Number(LINE.exec(attributeOf(source, 'data-astro-source-loc') ?? '')?.[1])
  return { framework: 'astro', chain: [line >= 1 ? { file, line } : { file }] }
}

const INSPECTOR = /^(.+):(\d{1,7}):\d{1,7}$/

/** The template location `vite-plugin-vue-inspector` writes on the nearest element. */
export function inspectorOf(el: Element): { file: string; line: number } | undefined {
  const marked = closestOf(el, '[data-v-inspector]')
  const match = marked && INSPECTOR.exec(attributeOf(marked, 'data-v-inspector') ?? '')
  const file = match && cleaned(match[1], LIMITS.path)
  const line = Number(match?.[2])
  return file && line >= 1 ? { file, line } : undefined
}

/** The same file, given absolute or relative to the project root. */
const sameFile = (absolute: string, relative: string) => {
  const tail = relative.replace(/^\.?\/+/, '')
  return absolute === relative || absolute.endsWith(`/${tail}`)
}

/** Adds the inspector's line to the innermost component when it names that component's file. */
export function withInspectorLine(
  origin: CodeOrigin,
  inspector: { file: string; line: number } | undefined,
): CodeOrigin {
  const innermost = origin.chain.at(-1)
  if (!inspector || !innermost || !sameFile(innermost.file, inspector.file)) return origin
  return {
    ...origin,
    chain: [...origin.chain.slice(0, -1), { ...innermost, line: inspector.line }],
  }
}

/** Vue first: inside an Astro page, a Vue island knows its components best. */
export function combineOrigin(
  vue: CodeOrigin | undefined,
  astro: CodeOrigin | undefined,
): CodeOrigin | undefined {
  return vue ?? astro
}
