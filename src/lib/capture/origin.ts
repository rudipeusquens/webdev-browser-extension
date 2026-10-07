// Code origin of an element (spec section 6): the Vue components that rendered it, read in
// the page's world by the bridge (origin-bridge.ts) and checked here, or the source
// attributes an Astro dev server writes into the page (source-attributes.ts reads them).
// Both come from the page: they are validated, cleaned and capped like any other page text.
// No DOM here: the background, a service worker, parses the bridge's answers.

import type { CodeOrigin } from '../collection/model'
import { LIMITS } from '../collection/model'
import { hasKeys, isText } from '../collection/validate'
import { clean } from '../text'

type Entry = CodeOrigin['chain'][number]

/** The longest component chain the bridge reports (origin-bridge.ts). */
const MAX_CHAIN = 32

const cleaned = (x: unknown, max: number): string | undefined => {
  if (typeof x !== 'string') return undefined
  // Longer than any value that could pass: no need to clean it first.
  if (x.length > max * 4) return undefined
  const value = clean(x)
  return isText(value, max, 1) ? value : undefined
}

// The page writes these: a name is an identifier (`SaveButton`, `el-button`), a file a path
// of a source file in the characters paths use, so neither can carry a sentence that reads as
// an instruction, even before the prompt puts it in a code span.
const NAME = /^[\p{L}_$][\p{L}\p{N}_$.-]*$/u
const FILE = /^(?:[A-Za-z]:)?[\p{L}\p{N}/\\._\-@()[\]+~ ]+\.(?:vue|astro|svelte|[cm]?[jt]sx?|mdx)$/u

const nameOf = (x: unknown) => {
  const name = cleaned(x, LIMITS.name)
  return name && NAME.test(name) ? name : undefined
}
const fileOf = (x: unknown) => {
  const file = cleaned(x, LIMITS.path)
  return file && FILE.test(file) ? file : undefined
}

function entryOf(raw: unknown): Entry | null | undefined {
  if (!hasKeys(raw, [], ['name', 'file'])) return undefined
  const file = fileOf(raw.file)
  if (!file) return null
  const name = nameOf(raw.name)
  return name ? { name, file } : { file }
}

/**
 * The bridge's report for one element as a code origin: components with a file, the
 * innermost five, outermost first. Undefined for anything malformed or without a file.
 */
export function parseVueOrigin(raw: unknown): CodeOrigin | undefined {
  // The bridge sends at most this many; its own cap runs on builtins the page can patch.
  if (!hasKeys(raw, ['chain']) || !Array.isArray(raw.chain)) return undefined
  if (raw.chain.length > MAX_CHAIN) return undefined
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

/** An Astro source from `data-astro-source-file` and `data-astro-source-loc` (`line:col`). */
export function astroSource(file: string | null, loc: string | null): CodeOrigin | undefined {
  const path = fileOf(file)
  if (!path) return undefined
  const line = Number(LINE.exec(loc ?? '')?.[1])
  return { framework: 'astro', chain: [line >= 1 ? { file: path, line } : { file: path }] }
}

const INSPECTOR = /^(.+):(\d{1,7}):\d{1,7}$/

export interface InspectorLine {
  file: string
  line: number
}

/** A `data-v-inspector` value (`file:line:col`, written by `vite-plugin-vue-inspector`). */
export function inspectorLine(value: string | null): InspectorLine | undefined {
  const match = INSPECTOR.exec(value ?? '')
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
  inspector: InspectorLine | undefined,
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
