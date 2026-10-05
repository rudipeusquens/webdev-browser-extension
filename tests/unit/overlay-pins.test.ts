import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type LiveAnchor,
  pinPosition,
  pinPositions,
  placeItems,
  pruneLive,
} from '@/entrypoints/overlay.content/pins'
import type { Annotation, Rect, Target } from '@/lib/collection/model'
import { snapshot } from './helpers/collection'

const annotation = (id: string, target: Target): Annotation => ({
  id,
  number: 1,
  pageKey: 'http://localhost/',
  comment: 'x',
  createdAt: 'T',
  updatedAt: 'T',
  target,
})
const element = (id: string, selector: string) =>
  annotation(id, { kind: 'element', element: snapshot({ selector }) })
const text = (id: string, selector: string) =>
  annotation(id, {
    kind: 'text',
    selected: 'Text',
    before: '',
    after: '',
    container: snapshot({ selector }),
  })
const area = (id: string, selector: string, rect: Rect, containerBox: Rect) =>
  annotation(id, {
    kind: 'area',
    rect,
    container: snapshot({ selector, box: containerBox }),
    elements: [],
    moreCount: 0,
  })

const $ = (selector: string) => document.querySelector(selector) as Element
const boxes = new Map<Element, Rect>()

beforeEach(() => {
  document.body.innerHTML =
    '<main><button id="save">Save</button><p id="para">Some <b>bold</b> text</p></main>'
  boxes.clear()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return DOMRect.fromRect(boxes.get(this) ?? { x: 0, y: 0, width: 0, height: 0 })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('placeItems: elements', () => {
  it('prefers the element marked in this session', () => {
    const marked = document.createElement('div')
    document.body.append(marked)
    const found = placeItems([element('a', '#save')], new Map([['a', marked]]), document)
    expect(found.get('a')?.el).toBe(marked)
  })

  it('falls back to the selector', () => {
    const found = placeItems([element('a', '#save')], new Map(), document)
    expect(found.get('a')?.el).toBe($('#save'))
  })

  it('drops a live element that left the page and uses the selector instead', () => {
    const gone = document.createElement('div')
    const found = placeItems([element('a', '#save')], new Map([['a', gone]]), document)
    expect(found.get('a')?.el).toBe($('#save'))
  })

  it('skips selectors that throw or match nothing', () => {
    const found = placeItems([element('a', 'div[['), element('b', '#missing')], new Map(), document)
    expect(found.size).toBe(0)
  })

  it('reads the element box when asked', () => {
    boxes.set($('#save'), { x: 5, y: 6, width: 70, height: 20 })
    const found = placeItems([element('a', '#save')], new Map(), document)
    expect(found.get('a')?.rect()).toEqual({ x: 5, y: 6, width: 70, height: 20 })
  })
})

describe('placeItems: text', () => {
  it('uses the selection marked in this session', () => {
    const range = document.createRange()
    range.selectNodeContents($('b'))
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 40, y: 50, width: 30, height: 12 }),
    )
    const found = placeItems(
      [text('a', '#para')],
      new Map<string, LiveAnchor>([['a', range]]),
      document,
    )
    const placement = found.get('a')
    expect(placement?.range).toBe(range)
    expect(placement?.el).toBe($('b'))
    expect(placement?.rect()).toEqual({ x: 40, y: 50, width: 30, height: 12 })
  })

  it('falls back to the container when the selected nodes are gone', () => {
    const range = document.createRange()
    range.selectNodeContents($('b'))
    $('b').remove()
    boxes.set($('#para'), { x: 1, y: 2, width: 300, height: 20 })
    const found = placeItems(
      [text('a', '#para')],
      new Map<string, LiveAnchor>([['a', range]]),
      document,
    )
    expect(found.get('a')?.range).toBeUndefined()
    expect(found.get('a')?.el).toBe($('#para'))
    expect(found.get('a')?.rect()).toEqual({ x: 1, y: 2, width: 300, height: 20 })
  })
})

describe('placeItems: areas', () => {
  it('keeps the area where it was inside its container', () => {
    // Marked at page (120, 640) inside a container at page (100, 600); the container is now
    // at viewport (100, 50).
    boxes.set($('main'), { x: 100, y: 50, width: 800, height: 400 })
    const item = area(
      'a',
      'main',
      { x: 120, y: 640, width: 300, height: 100 },
      { x: 100, y: 600, width: 800, height: 400 },
    )
    const found = placeItems([item], new Map(), document)
    expect(found.get('a')?.el).toBe($('main'))
    expect(found.get('a')?.rect()).toEqual({ x: 120, y: 90, width: 300, height: 100 })
  })

  it('prefers the container marked in this session', () => {
    const marked = $('#para')
    const item = area(
      'a',
      'main',
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 10, height: 10 },
    )
    expect(placeItems([item], new Map([['a', marked]]), document).get('a')?.el).toBe(marked)
  })
})

describe('pruneLive', () => {
  it('forgets anchors of items that were deleted', () => {
    const live = new Map<string, LiveAnchor>([
      ['a', $('#save')],
      ['b', $('#para')],
    ])
    pruneLive(live, [element('a', '#save')])
    expect([...live.keys()]).toEqual(['a'])
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

describe('pinPositions', () => {
  const viewport = { width: 1000, height: 800 }
  const same = { x: 100, y: 100, width: 200, height: 40 }

  it('moves pins that would cover each other to the left', () => {
    const pins = pinPositions(
      [
        { id: 'a', rect: same },
        { id: 'b', rect: same },
        { id: 'c', rect: same },
      ],
      viewport,
    )
    expect(pins).toEqual([
      { id: 'a', x: 290, y: 90 },
      { id: 'b', x: 268, y: 90 },
      { id: 'c', x: 246, y: 90 },
    ])
  })

  it('drops pins of targets outside the viewport', () => {
    const pins = pinPositions([{ id: 'a', rect: { ...same, y: -500 } }], viewport)
    expect(pins).toEqual([])
  })
})
