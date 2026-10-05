// A CSS selector that matches exactly one element (spec section 6, "Selector").

import {
  attributeOf,
  childrenOf,
  classesOf,
  idOf,
  MAX_DEPTH,
  matchesSelector,
  ownerDocumentOf,
  parentOf,
  tagOf,
} from './dom'

const GENERATED_ID = [
  /^:r[0-9a-z]*:$/i, // React useId (≤ 19.0)
  /^«r[0-9a-z]*»$/i, // React useId (19.1)
  /^_r_[0-9a-z]*_$/i, // React useId (≥ 19.2)
  /^v-\d+$/, // Vue
  /\d{4,}/, // long digit runs: counters, timestamps
  /^(?:radix|reka|headlessui|mui|chakra)-/i, // component libraries
  /\s/,
]

const UNSTABLE_CLASS = [
  /__[A-Za-z0-9_-]{4,}$/, // CSS modules: Button_root__x7f2a
  /^(?:css|sc|jsx|emotion|svelte|astro|tw)-[A-Za-z0-9_-]+$/, // CSS-in-JS and scoped hashes
  /[[\]:/!@]/, // Tailwind arbitrary values, variants, fractions, important
  /\d{4,}/,
  /^(?:is-|has-)?(?:active|open|opened|selected|hover|hovered|focus|focused|focus-visible|visible|hidden|show|shown|disabled|checked|current|expanded|collapsed|loading)$/i,
]

const TEST_ATTRIBUTES = ['data-testid', 'data-test']

export function isStableId(id: string): boolean {
  return id.length > 0 && id.length <= 64 && !GENERATED_ID.some((re) => re.test(id))
}

/** A hash-like part mixes letters and digits over five or more characters (`x7f2a`). */
const isHashPart = (part: string) => part.length >= 5 && /\d/.test(part) && /[a-z]/i.test(part)

export function isStableClass(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 40 &&
    !UNSTABLE_CLASS.some((re) => re.test(name)) &&
    !name.split(/[-_]/).some(isHashPart)
  )
}

/** `CSS.escape` (CSSOM), available in every context including test environments. */
export function cssEscape(value: string): string {
  let result = ''
  const first = value.charCodeAt(0)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    const char = value.charAt(i)
    const digit = code >= 0x30 && code <= 0x39
    if (code === 0) result += '�'
    else if (
      (code >= 0x01 && code <= 0x1f) ||
      code === 0x7f ||
      (i === 0 && digit) ||
      (i === 1 && digit && first === 0x2d)
    )
      result += `\\${code.toString(16)} `
    else if (i === 0 && value.length === 1 && code === 0x2d) result += `\\${char}`
    else if (code >= 0x80 || code === 0x2d || code === 0x5f || digit || /[A-Za-z]/.test(char))
      result += char
    else result += `\\${char}`
  }
  return result
}

function isUnique(root: ParentNode, selector: string): boolean {
  try {
    return root.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}

/** `#id`, `[data-testid="…"]` or `[data-test="…"]` when it is stable and unique. */
function anchorOf(el: Element, root: ParentNode): string | undefined {
  const candidates: string[] = []
  const id = idOf(el)
  if (isStableId(id)) candidates.push(`#${cssEscape(id)}`)
  for (const name of TEST_ATTRIBUTES) {
    const value = attributeOf(el, name)
    if (value && value.length <= 64) candidates.push(`[${name}="${cssEscape(value)}"]`)
  }
  return candidates.find((selector) => isUnique(root, selector))
}

/** Tag plus up to two stable classes, with `:nth-of-type` when a sibling matches as well. */
function segment(el: Element): string {
  const classes = classesOf(el)
    .filter(isStableClass)
    .sort((a, b) => Number(/\d/.test(a)) - Number(/\d/.test(b)))
    .slice(0, 2)
  const tag = tagOf(el)
  const base = [cssEscape(tag), ...classes.map((name) => `.${cssEscape(name)}`)].join('')
  const parent = parentOf(el)
  const siblings = parent ? childrenOf(parent) : []
  if (siblings.filter((sibling) => matchesSelector(sibling, base)).length <= 1) return base
  const sameTag = siblings.filter((sibling) => tagOf(sibling) === tag)
  return `${base}:nth-of-type(${sameTag.indexOf(el) + 1})`
}

/**
 * Walks up from `el` and stops at the first unique selector, usually within
 * `LIMITS.selectorDepth` levels. In self-similar trees it goes further, up to the root: a
 * selector matching the wrong element is worse than a long one.
 */
export function buildSelector(el: Element, root: ParentNode = ownerDocumentOf(el)): string {
  const parts: string[] = []
  let node: Element | null = el
  for (let depth = 0; node && depth < MAX_DEPTH; depth++, node = parentOf(node)) {
    const anchor = anchorOf(node, root)
    if (anchor) return [anchor, ...parts].join(' > ')
    parts.unshift(segment(node))
    const selector = parts.join(' > ')
    if (isUnique(root, selector)) return selector
  }
  return parts.join(' > ')
}
