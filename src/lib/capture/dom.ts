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
const SHADOW_ROOT = getter<ShadowRoot | null>(Element.prototype, 'shadowRoot')
const NAMESPACE = getter<string | null>(Element.prototype, 'namespaceURI')
const CHILD_NODES = getter<NodeListOf<ChildNode>>(Node.prototype, 'childNodes')
const PARENT_NODE = getter<ParentNode | null>(Node.prototype, 'parentNode')
const NEXT_NODE = getter<ChildNode | null>(Node.prototype, 'nextSibling')
const NODE_OWNER = getter<Document | null>(Node.prototype, 'ownerDocument')
const NODE_TYPE = getter<number>(Node.prototype, 'nodeType')

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

// The same for any node: a range's boundary can be a form.
export const childNodeAt = (node: Node, index: number): Node | null =>
  CHILD_NODES.call(node)[index] ?? null
export const parentNodeOf = (node: Node): Node | null => PARENT_NODE.call(node)
export const nextNodeOf = (node: Node): Node | null => NEXT_NODE.call(node)
/** The document a node belongs to (a document belongs to itself). */
export const documentOf = (node: Node): Document =>
  NODE_TYPE.call(node) === Node.DOCUMENT_NODE
    ? (node as Document)
    : (NODE_OWNER.call(node) as Document)
export const containsNode = (root: Node, node: Node): boolean =>
  Node.prototype.contains.call(root, node)

// Methods are looked up at call time, on the prototype, never on the element.
export const attributeOf = (el: Element, name: string): string | null =>
  Element.prototype.getAttribute.call(el, name)
export const closestOf = (el: Element, selector: string): Element | null =>
  Element.prototype.closest.call(el, selector)
export const rectOf = (el: Element): DOMRect => Element.prototype.getBoundingClientRect.call(el)

/**
 * Whether `el` is rendered (`checkVisibility`). Chrome reports `display: contents` elements as
 * not visible although their children render, so those ask the nearest ancestor with a box.
 */
export function isRendered(
  el: Element,
  styleOf: (el: Element) => CSSStyleDeclaration,
  options?: CheckVisibilityOptions,
): boolean {
  let box: Element | null = el
  for (let depth = 0; box && depth < MAX_DEPTH; depth++) {
    if (styleOf(box).display !== 'contents') {
      return Element.prototype.checkVisibility?.call(box, options) ?? true
    }
    box = parentOf(box)
  }
  return true
}

/** Whether `el` matches `selector`; false for a selector the browser cannot parse. */
export function matchesSelector(el: Element, selector: string): boolean {
  try {
    return Element.prototype.matches.call(el, selector)
  } catch {
    return false
  }
}

type ShadowAccess = { chrome?: { dom?: { openOrClosedShadowRoot?(el: Element): ShadowRoot } } }

const HTML = 'http://www.w3.org/1999/xhtml'

/** Open and closed shadow roots: content scripts may read both through `chrome.dom`. */
export function shadowRootOf(el: Element): ShadowRoot | null {
  const open = SHADOW_ROOT.call(el)
  if (open) return open
  // Only HTML elements can have one, and chrome.dom throws for any other element: inline
  // SVG icons are on most pages.
  if (NAMESPACE.call(el) !== HTML) return null
  try {
    return (globalThis as ShadowAccess).chrome?.dom?.openOrClosedShadowRoot?.(el) ?? null
  } catch {
    return null
  }
}

/** The focused element, looking into open and closed shadow roots. */
export function deepActiveElement(doc: Document): Element | null {
  let active = doc.activeElement
  for (let depth = 0; active && depth < MAX_DEPTH; depth++) {
    const inner = shadowRootOf(active)?.activeElement
    if (!inner) break
    active = inner
  }
  return active
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

/** Longest walk up the tree any loop may take: a guard against cycles nobody foresaw. */
export const MAX_DEPTH = 4096
