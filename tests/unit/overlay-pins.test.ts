import { beforeEach, describe, expect, it } from 'vitest'
import { pinPosition, resolveTargets } from '@/entrypoints/overlay.content/pins'
import type { Annotation } from '@/lib/collection/model'
import { snapshot } from './helpers/collection'

const item = (id: string, selector: string): Annotation => ({
  id,
  number: 1,
  pageKey: 'http://localhost/',
  comment: 'x',
  createdAt: 'T',
  updatedAt: 'T',
  target: { kind: 'element', element: snapshot({ selector }) },
})

beforeEach(() => {
  document.body.innerHTML = '<main><button id="save">Save</button><p>Text</p></main>'
})

describe('resolveTargets', () => {
  it('prefers the element marked in this session', () => {
    const marked = document.createElement('div')
    document.body.append(marked)
    const found = resolveTargets([item('a', '#save')], new Map([['a', marked]]), document)
    expect(found.get('a')).toBe(marked)
  })

  it('falls back to the selector', () => {
    const found = resolveTargets([item('a', '#save')], new Map(), document)
    expect(found.get('a')).toBe(document.querySelector('#save'))
  })

  it('drops a live element that left the page and uses the selector instead', () => {
    const gone = document.createElement('div')
    const found = resolveTargets([item('a', '#save')], new Map([['a', gone]]), document)
    expect(found.get('a')).toBe(document.querySelector('#save'))
  })

  it('skips selectors that throw or match nothing', () => {
    const found = resolveTargets([item('a', 'div[['), item('b', '#missing')], new Map(), document)
    expect(found.size).toBe(0)
  })
})

describe('pinPosition', () => {
  const viewport = { width: 1000, height: 800 }

  it('centers the pin on the top-right corner', () => {
    expect(pinPosition({ x: 100, y: 100, width: 200, height: 40 }, viewport)).toEqual({
      x: 290,
      y: 90,
    })
  })

  it('keeps a partly visible target pin inside the viewport', () => {
    expect(pinPosition({ x: 900, y: -20, width: 200, height: 40 }, viewport)).toEqual({
      x: 976,
      y: 4,
    })
  })

  it('hides the pin of a target outside the viewport', () => {
    expect(pinPosition({ x: 100, y: -200, width: 100, height: 40 }, viewport)).toBeNull()
    expect(pinPosition({ x: 100, y: 900, width: 100, height: 40 }, viewport)).toBeNull()
    expect(pinPosition({ x: -300, y: 100, width: 100, height: 40 }, viewport)).toBeNull()
  })
})
