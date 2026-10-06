import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clipBoxes,
  linesOf,
  outlineBox,
  clippersOf,
  type LiveAnchor,
  pinPosition,
  pinPositions,
  placeItems,
  pruneLive,
  visibleBounds,
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

describe('clippers and visible bounds', () => {
  const viewport = { x: 0, y: 0, width: 1000, height: 800 }

  it('are the whole viewport for an element nothing clips', () => {
    expect(clippersOf($('#save'))).toEqual([])
    expect(visibleBounds([], viewport)).toEqual(viewport)
  })

  it('are the part of the viewport inside every ancestor that clips its overflow', () => {
    document.body.innerHTML =
      '<div id="outer" style="overflow: hidden"><div id="mid"><div id="box" style="overflow-y: auto">' +
      '<p id="row">Row</p></div></div></div>'
    boxes.set($('#outer'), { x: 50, y: 50, width: 500, height: 500 })
    boxes.set($('#box'), { x: 100, y: 100, width: 600, height: 80 })
    const clippers = clippersOf($('#row'))
    expect(clippers).toEqual([$('#box'), $('#outer')])
    expect(visibleBounds(clippers, viewport)).toEqual({ x: 100, y: 100, width: 450, height: 80 })
  })

  it("leave out the ancestors of a fixed element, and the element's own overflow", () => {
    document.body.innerHTML =
      '<div id="box" style="overflow: auto"><header id="head" style="position: fixed; overflow: hidden">Head</header></div>'
    expect(clippersOf($('#head'))).toEqual([])
  })

  it("include the element itself for text inside it, which scrolls with the element's content", () => {
    document.body.innerHTML = '<pre id="log" style="overflow: auto">Line one</pre>'
    expect(clippersOf($('#log'))).toEqual([])
    expect(clippersOf($('#log'), true)).toEqual([$('#log')])
  })

  it('leave out boxes an absolutely positioned target escapes', () => {
    document.body.innerHTML =
      '<div id="card" style="position: relative">' +
      '<div id="wrap" style="overflow: hidden"><span id="badge" style="position: absolute">New</span>' +
      '<span id="flow">In flow</span></div></div>'
    expect(clippersOf($('#badge'))).toEqual([])
    expect(clippersOf($('#flow'))).toEqual([$('#wrap')])
  })

  it('keep the box an absolutely positioned target is placed in', () => {
    document.body.innerHTML =
      '<div id="outer" style="overflow: hidden"><div id="box" style="overflow: auto; position: relative">' +
      '<div id="mid" style="overflow: hidden"><span id="badge" style="position: absolute">New</span></div>' +
      '</div></div>'
    expect(clippersOf($('#badge'))).toEqual([$('#box'), $('#outer')])
  })

  it('are empty when a clipping ancestor is off-screen', () => {
    document.body.innerHTML = '<div id="box" style="overflow: auto"><p id="row">Row</p></div>'
    boxes.set($('#box'), { x: 100, y: 900, width: 200, height: 80 })
    expect(visibleBounds(clippersOf($('#row')), viewport)).toBeNull()
  })
})

describe('pinPosition', () => {
  const viewport = { x: 0, y: 0, width: 1000, height: 800 }

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

  it('hides the pin of a target scrolled out of its container', () => {
    const box = { x: 100, y: 100, width: 200, height: 80 }
    expect(pinPosition({ x: 110, y: 200, width: 100, height: 20 }, box)).toBeNull()
    expect(pinPosition({ x: 110, y: 60, width: 100, height: 20 }, box)).toBeNull()
  })

  it('keeps the pin of a target half inside its container within the container', () => {
    const box = { x: 100, y: 100, width: 200, height: 80 }
    expect(pinPosition({ x: 110, y: 90, width: 300, height: 20 }, box)).toEqual({ x: 276, y: 104 })
  })

  it('gives no pin to a target without a box (not rendered)', () => {
    expect(pinPosition({ x: 0, y: 0, width: 0, height: 0 }, viewport)).toBeNull()
    expect(pinPosition({ x: 300, y: 300, width: 0, height: 20 }, viewport)).toBeNull()
  })
})

describe('pinPositions', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 800 }
  const same = { x: 100, y: 100, width: 200, height: 40 }

  it('moves pins that would cover each other to the left', () => {
    const pins = pinPositions([
      { id: 'a', rect: same, bounds },
      { id: 'b', rect: same, bounds },
      { id: 'c', rect: same, bounds },
    ])
    expect(pins).toEqual([
      { id: 'a', x: 290, y: 90 },
      { id: 'b', x: 268, y: 90 },
      { id: 'c', x: 246, y: 90 },
    ])
  })

  it('drops pins of targets outside the viewport', () => {
    const pins = pinPositions([
      { id: 'a', rect: { ...same, y: -500 }, bounds },
      { id: 'b', rect: same, bounds: null },
    ])
    expect(pins).toEqual([])
  })
})

describe('outlineBox', () => {
  const viewport: Rect = { x: 0, y: 0, width: 1000, height: 800 }
  const all = { top: true, right: true, bottom: true, left: true }

  it('draws its line just outside a target that is fully visible', () => {
    expect(outlineBox({ x: 100, y: 50, width: 200, height: 40 }, viewport)).toEqual({
      x: 98,
      y: 48,
      width: 204,
      height: 44,
      sides: all,
    })
  })

  it('leaves the line off where a scroll container cuts the target', () => {
    const box = { x: 40, y: 200, width: 300, height: 120 }
    // Half scrolled out at the top of the box.
    expect(outlineBox({ x: 41, y: 180, width: 298, height: 40 }, box)).toEqual({
      x: 39,
      y: 200,
      width: 302,
      height: 22,
      sides: { ...all, top: false },
    })
    // Wider than the box on both sides.
    expect(outlineBox({ x: 0, y: 250, width: 500, height: 20 }, box)?.sides).toEqual({
      top: true,
      right: false,
      bottom: true,
      left: false,
    })
  })

  it('is null for a target that is out of sight or has no box', () => {
    expect(outlineBox({ x: 10, y: 900, width: 50, height: 50 }, viewport)).toBeNull()
    expect(outlineBox({ x: 10, y: 10, width: 0, height: 50 }, viewport)).toBeNull()
  })
})

describe('clipBoxes', () => {
  const bounds: Rect = { x: 40, y: 200, width: 300, height: 60 }

  it('keeps the parts of text lines inside the bounds and drops the rest', () => {
    expect(
      clipBoxes(
        [
          { x: 41, y: 190, width: 100, height: 20 },
          { x: 41, y: 230, width: 400, height: 20 },
          { x: 41, y: 300, width: 100, height: 20 },
          { x: 41, y: 240, width: 0, height: 20 },
        ],
        bounds,
      ),
    ).toEqual([
      { x: 41, y: 200, width: 100, height: 10 },
      { x: 41, y: 230, width: 299, height: 20 },
    ])
  })
})

describe('linesOf', () => {
  const rect = (x: number, y: number, width: number, height: number) =>
    ({ x, y, width, height, top: y, bottom: y + height, left: x, right: x + width }) as DOMRect
  const range = (rects: DOMRect[]) => ({ getClientRects: () => rects }) as unknown as Range

  it('measures a text once: its box for the pin, its lines on screen for the marking', () => {
    const measured = linesOf(
      range([rect(10, -40, 100, 20), rect(10, 100, 300, 20), rect(10, 120, 0, 20)]),
      800,
    )
    // As Range.getBoundingClientRect(): only a rect without width and height is left out.
    expect(measured.rect).toEqual({ x: 10, y: -40, width: 300, height: 180 })
    expect(measured.lines).toEqual([{ x: 10, y: 100, width: 300, height: 20 }])
  })

  it('keeps at most 50 lines and has no box without any', () => {
    const many = Array.from({ length: 80 }, (_, i) => rect(0, i * 10, 50, 10))
    expect(linesOf(range(many), 10000).lines).toHaveLength(50)
    expect(linesOf(range([]), 800)).toEqual({
      rect: { x: 0, y: 0, width: 0, height: 0 },
      lines: [],
    })
  })
})
