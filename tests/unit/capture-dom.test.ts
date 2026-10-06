import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  childNodeAt,
  deepActiveElement,
  documentOf,
  nextNodeOf,
  parentNodeOf,
  queryAll,
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
    expect(queryAll(document, 'form > *')).toHaveLength(2)
  })

  it('search inside an element whose named controls shadow the query methods', () => {
    const form = document.querySelector('form') as HTMLFormElement
    shadow(form, 'querySelector')
    shadow(form, 'querySelectorAll')
    expect(queryFirst(form, 'p')?.textContent).toBe('Text')
    expect(queryAll(form, 'button, p')).toHaveLength(2)
  })

  it('return nothing for selectors the browser cannot parse', () => {
    expect(queryFirst(document, 'div[[')).toBeNull()
    expect(queryAll(document, 'div[[')).toEqual([])
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
