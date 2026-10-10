import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  childNodeAt,
  deepActiveElement,
  documentOf,
  nextNodeOf,
  parentNodeOf,
  queryFirst,
  shadowRootOf,
} from '@/lib/capture/dom'

// A named control shadows the property of its form with the same name, in the content
// script's world too. An own property on the instance has the same effect.
function shadow(target: object, name: string) {
  const impostor = document.createElement('input')
  Object.defineProperty(target, name, { value: impostor, configurable: true })
  return impostor
}

beforeEach(() => {
  document.body.innerHTML = '<form><button id="save">Save</button><p>Text</p></form>'
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

type Dom = { openOrClosedShadowRoot(el: Element): ShadowRoot | undefined }
const chromeDom = () => (globalThis as unknown as { chrome: { dom: Dom } }).chrome.dom

describe('queries', () => {
  it('search the document', () => {
    expect(queryFirst(document, '#save')?.textContent).toBe('Save')
  })

  it('search inside an element whose named controls shadow the query methods', () => {
    const form = document.querySelector('form') as HTMLFormElement
    shadow(form, 'querySelector')
    expect(queryFirst(form, 'p')?.textContent).toBe('Text')
  })

  it('return nothing for selectors the browser cannot parse', () => {
    expect(queryFirst(document, 'div[[')).toBeNull()
  })
})

describe('shadowRootOf', () => {
  it('finds an open shadow root when a named control shadows the property', () => {
    const host = document.createElement('div')
    const root = host.attachShadow({ mode: 'open' })
    document.body.append(host)
    shadow(host, 'shadowRoot')
    expect(shadowRootOf(host)).toBe(root)
  })

  it('asks chrome.dom for closed shadow roots', () => {
    const host = document.createElement('div')
    const closed = host.attachShadow({ mode: 'closed' })
    vi.spyOn(chromeDom(), 'openOrClosedShadowRoot').mockReturnValue(closed)
    expect(shadowRootOf(host)).toBe(closed)
  })

  it('is null without a shadow root', () => {
    vi.spyOn(chromeDom(), 'openOrClosedShadowRoot').mockReturnValue(undefined)
    expect(shadowRootOf(document.body)).toBeNull()
  })

  it('is null for SVG and MathML elements, which Chrome refuses to look into', () => {
    // Only HTML elements can have a shadow root; Chrome throws for every other element.
    const refusing = vi.spyOn(chromeDom(), 'openOrClosedShadowRoot').mockImplementation((el) => {
      if (!(el instanceof HTMLElement)) {
        throw new TypeError(
          'Error in invocation of dom.openOrClosedShadowRoot(HTMLElement element)',
        )
      }
      return el.shadowRoot ?? undefined
    })
    document.body.innerHTML = '<svg><a href="#x"><rect width="1" height="1"></rect></a></svg>'
    // happy-dom parses <math> as HTML; Chrome, like the standard, as MathML.
    const math = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math')
    math.append(document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mi'))
    document.body.append(math)
    const foreign = [...document.querySelectorAll('svg, svg a, rect'), math, ...math.children]
    expect(foreign).toHaveLength(5)
    for (const el of foreign) expect(shadowRootOf(el), el.localName).toBeNull()
    // Not asked at all: the overlay looks at every element of a page when it starts.
    expect(refusing).not.toHaveBeenCalled()
  })

  it('is null when chrome.dom refuses an element for any other reason', () => {
    vi.spyOn(chromeDom(), 'openOrClosedShadowRoot').mockImplementation(() => {
      throw new TypeError('Error in invocation of dom.openOrClosedShadowRoot(HTMLElement element)')
    })
    expect(shadowRootOf(document.body)).toBeNull()
  })
})

describe('deepActiveElement', () => {
  it('follows the focus into open and closed shadow roots', () => {
    const outer = document.createElement('div')
    const open = outer.attachShadow({ mode: 'open' })
    const inner = document.createElement('div')
    open.append(inner)
    const closed = inner.attachShadow({ mode: 'closed' })
    const input = document.createElement('input')
    closed.append(input)
    document.body.append(outer)
    vi.spyOn(chromeDom(), 'openOrClosedShadowRoot').mockImplementation((el) =>
      el === inner ? closed : undefined,
    )
    input.focus()
    expect(deepActiveElement(document)).toBe(input)
  })

  it('is the focused element of the document outside shadow roots', () => {
    vi.spyOn(chromeDom(), 'openOrClosedShadowRoot').mockReturnValue(undefined)
    const button = document.querySelector('#save') as HTMLButtonElement
    button.focus()
    expect(deepActiveElement(document)).toBe(button)
  })
})

describe('node reads', () => {
  it('see the real tree through a form whose named controls shadow them', () => {
    const form = document.querySelector('form') as HTMLFormElement
    for (const name of ['childNodes', 'parentNode', 'nextSibling', 'ownerDocument']) {
      shadow(form, name)
    }
    expect(childNodeAt(form, 1)).toBe(document.querySelector('p'))
    expect(childNodeAt(form, 5)).toBeNull()
    expect(parentNodeOf(form)).toBe(document.body)
    expect(nextNodeOf(form)).toBeNull()
    expect(documentOf(form)).toBe(document)
    expect(documentOf(document)).toBe(document)
  })
})
