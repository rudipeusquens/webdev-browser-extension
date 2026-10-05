// DOM reads that a page cannot redirect. Named form controls shadow their form's own
// properties ("DOM clobbering": `<input name="parentElement">` makes `form.parentElement`
// return the input), which would send walks up the tree in circles. The getters and methods
// on the prototypes always return the real values; the page cannot change this world's
// prototypes, only shadow properties on its own elements. Named images and forms also shadow
// members of `document`, but only in the page's own world: Chrome keeps the content script's
// view of `document` intact (tests/e2e/clobbering.e2e.test.ts).

function getter<T>(proto: object, name: string): (this: unknown) => T {
  for (let p: object | null = proto; p; p = Object.getPrototypeOf(p)) {
    const get = Object.getOwnPropertyDescriptor(p, name)?.get
    if (get) return get as (this: unknown) => T
  }
  throw new Error(`no getter for ${name}`)
}

const PARENT = getter<Element | null>(Element.prototype, 'parentElement')
const OWNER = getter<Document>(Element.prototype, 'ownerDocument')
const CONNECTED = getter<boolean>(Element.prototype, 'isConnected')
const LOCAL_NAME = getter<string>(Element.prototype, 'localName')
const ID = getter<string>(Element.prototype, 'id')
const CLASS_LIST = getter<DOMTokenList>(Element.prototype, 'classList')
const ATTRIBUTES = getter<NamedNodeMap>(Element.prototype, 'attributes')
const CHILDREN = getter<HTMLCollection>(Element.prototype, 'children')
const FIRST_CHILD = getter<Element | null>(Element.prototype, 'firstElementChild')
const NEXT_SIBLING = getter<Element | null>(Element.prototype, 'nextElementSibling')
const TEXT_CONTENT = getter<string | null>(Element.prototype, 'textContent')
const INNER_TEXT = getter<string>(HTMLElement.prototype, 'innerText')
const SHADOW_ROOT = getter<ShadowRoot | null>(Element.prototype, 'shadowRoot')

export const parentOf = (el: Element): Element | null => PARENT.call(el)
export const ownerDocumentOf = (el: Element): Document => OWNER.call(el)
export const isConnected = (el: Element): boolean => CONNECTED.call(el)
export const tagOf = (el: Element): string => LOCAL_NAME.call(el)
export const idOf = (el: Element): string => ID.call(el)
export const classesOf = (el: Element): string[] => [...CLASS_LIST.call(el)]
export const attributesOf = (el: Element): Attr[] => [...ATTRIBUTES.call(el)]
export const childrenOf = (el: Element): Element[] => [...CHILDREN.call(el)]
export const firstChildOf = (el: Element): Element | null => FIRST_CHILD.call(el)
export const nextSiblingOf = (el: Element): Element | null => NEXT_SIBLING.call(el)

// Methods are looked up at call time, on the prototype, never on the element.
export const attributeOf = (el: Element, name: string): string | null =>
  Element.prototype.getAttribute.call(el, name)
export const closestOf = (el: Element, selector: string): Element | null =>
  Element.prototype.closest.call(el, selector)
export const rectOf = (el: Element): DOMRect => Element.prototype.getBoundingClientRect.call(el)

/** Whether `el` matches `selector`; false for a selector the browser cannot parse. */
export function matchesSelector(el: Element, selector: string): boolean {
  try {
    return Element.prototype.matches.call(el, selector)
  } catch {
    return false
  }
}

type ShadowAccess = { chrome?: { dom?: { openOrClosedShadowRoot?(el: Element): ShadowRoot } } }

/** Open and closed shadow roots: content scripts may read both through `chrome.dom`. */
export function shadowRootOf(el: Element): ShadowRoot | null {
  return (
    SHADOW_ROOT.call(el) ??
    (globalThis as ShadowAccess).chrome?.dom?.openOrClosedShadowRoot?.(el) ??
    null
  )
}

/** The first match of `selector`; null for a selector the browser cannot parse. */
export function queryFirst(root: Document | Element, selector: string): Element | null {
  const query =
    root instanceof Document ? Document.prototype.querySelector : Element.prototype.querySelector
  try {
    return query.call(root, selector)
  } catch {
    return null
  }
}

/** Every match of `selector`; empty for a selector the browser cannot parse. */
export function queryAll(root: Document | Element, selector: string): Element[] {
  const query =
    root instanceof Document
      ? Document.prototype.querySelectorAll
      : Element.prototype.querySelectorAll
  try {
    return [...query.call(root, selector)]
  } catch {
    return []
  }
}

/** Rendered text for HTML elements, text content otherwise (SVG). */
export const textOf = (el: Element): string =>
  el instanceof HTMLElement ? INNER_TEXT.call(el) : (TEXT_CONTENT.call(el) ?? '')

/** Longest walk up the tree any loop may take: a guard against cycles nobody foresaw. */
export const MAX_DEPTH = 4096
