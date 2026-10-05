import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryAll, queryFirst, shadowRootOf } from '@/lib/capture/dom'

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
