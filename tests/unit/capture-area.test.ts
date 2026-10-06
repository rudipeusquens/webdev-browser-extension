import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { areaContainer, elementsInside, snapshotArea } from '@/lib/capture/area'
import type { Rect } from '@/lib/collection/model'
import { isTarget } from '@/lib/collection/validate'
import { chromeLikeVisibility } from './helpers/chrome-visibility'

const $ = (selector: string) => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`fixture has no ${selector}`)
  return el
}

// happy-dom has no layout: boxes come from this map, hit testing from `hits`.
const boxes = new Map<Element, Rect>()
let hits: Element[] = []
const box = (selector: string, x: number, y: number, width: number, height: number) => {
  for (const el of document.querySelectorAll(selector)) boxes.set(el, { x, y, width, height })
}

beforeEach(() => {
  boxes.clear()
  hits = []
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const r = boxes.get(this) ?? { x: 0, y: 0, width: 0, height: 0 }
    return DOMRect.fromRect(r)
  })
  Object.defineProperty(document, 'elementsFromPoint', { value: () => hits, configurable: true })
  document.body.innerHTML = `
    <main>
      <section class="features">
        <div class="card" id="c1"><span>Fast setup</span></div>
        <div class="card" id="c2"><span>Secure</span></div>
        <div class="card" id="c3"><span>Support</span></div>
      </section>
    </main>`
  box('body', 0, 0, 1000, 2000)
  box('main', 0, 0, 1000, 800)
  box('section', 100, 100, 800, 300)
  box('#c1', 120, 150, 200, 100)
  box('#c2', 340, 150, 200, 100)
  box('#c3', 560, 150, 200, 100)
  box('#c1 span', 130, 160, 100, 20)
  box('#c2 span', 350, 160, 100, 20)
  box('#c3 span', 570, 160, 100, 20)
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'elementsFromPoint')
})

const around = { x: 110, y: 140, width: 660, height: 120 }

describe('areaContainer', () => {
  it('is the nearest element above the hit point whose box holds the rectangle', () => {
    hits = [$('#c2 span'), $('#c2'), $('section'), $('main'), document.body]
    expect(areaContainer(document, around)).toBe($('section'))
  })

  it('skips the overlay host in the hit list', () => {
    const host = document.createElement('webdev-overlay')
    document.body.append(host)
    boxes.set(host, { x: 0, y: 0, width: 1000, height: 2000 })
    hits = [host, $('section'), $('main'), document.body]
    expect(areaContainer(document, around, host)).toBe($('section'))
  })

  it('falls back to body when nothing smaller holds the rectangle', () => {
    hits = [$('#c1')]
    expect(areaContainer(document, { x: -50, y: 0, width: 3000, height: 50 })).toBe(document.body)
    hits = []
    expect(areaContainer(document, around)).toBe(document.body)
  })
})

describe('elementsInside', () => {
  it('lists the topmost elements fully inside, in document order', () => {
    const { elements, total } = elementsInside($('section'), around)
    expect(elements.map((el) => el.id)).toEqual(['c1', 'c2', 'c3'])
    expect(total).toBe(3)
  })

  it('counts the inside child of an element that is only partly inside', () => {
    const { elements } = elementsInside($('section'), { x: 110, y: 140, width: 350, height: 120 })
    expect(elements.map((el) => el.id || el.textContent)).toEqual(['c1', 'Secure'])
  })

  it('keeps ten elements and counts the rest', () => {
    $('section').innerHTML = Array.from({ length: 12 }, (_, i) => `<i id="i${i}"></i>`).join('')
    for (let i = 0; i < 12; i++) box(`#i${i}`, 120 + i * 50, 150, 40, 40)
    const { elements, total } = elementsInside($('section'), {
      x: 110,
      y: 140,
      width: 700,
      height: 60,
    })
    expect(elements).toHaveLength(10)
    expect(total).toBe(12)
  })

  it('finds nothing in an empty spot', () => {
    expect(elementsInside($('section'), { x: 800, y: 300, width: 50, height: 50 })).toEqual({
      elements: [],
      total: 0,
    })
  })

  it('looks through zero-size wrappers', () => {
    $('section').innerHTML = '<div class="contents"><p id="p1">One</p><p id="p2">Two</p></div>'
    box('#p1', 120, 150, 100, 20)
    box('#p2', 120, 180, 100, 20)
    expect(elementsInside($('section'), around).elements.map((el) => el.id)).toEqual(['p1', 'p2'])
  })

  it('looks through display: contents wrappers, which Chrome reports as not visible', () => {
    chromeLikeVisibility()
    $('section').innerHTML =
      '<div style="display: contents"><p id="p1">One</p><p id="p2">Two</p></div>'
    box('#p1', 120, 150, 100, 20)
    box('#p2', 120, 180, 100, 20)
    expect(elementsInside($('section'), around).elements.map((el) => el.id)).toEqual(['p1', 'p2'])
  })

  it('never looks into a select, whose options hold its values (review focus 1)', () => {
    $('section').innerHTML =
      '<select id="list" size="3"><option id="o1" value="a">A</option><option id="o2" value="b">B</option></select>'
    box('#list', 120, 150, 100, 200)
    box('#o1', 120, 150, 100, 20)
    box('#o2', 120, 170, 100, 20)
    expect(elementsInside($('section'), around)).toEqual({ elements: [], total: 0 })
  })

  it('never lists the overlay host or elements that are not rendered', () => {
    const host = document.createElement('webdev-overlay')
    $('section').append(host)
    boxes.set(host, { x: 120, y: 150, width: 10, height: 10 })
    const hidden = $('#c3')
    vi.spyOn(Element.prototype, 'checkVisibility').mockImplementation(function (this: Element) {
      return this !== hidden
    })
    const { elements } = elementsInside($('section'), around, host)
    expect(elements.map((el) => el.id)).toEqual(['c1', 'c2'])
  })

  it('stops after its budget on huge pages', () => {
    const section = $('section')
    section.innerHTML = '<b></b>'.repeat(20000)
    box('section b', 120, 150, 10, 10)
    const started = performance.now()
    const { total } = elementsInside(section, around, undefined, 1000)
    expect(total).toBe(1000)
    expect(performance.now() - started).toBeLessThan(5000)
  })
})

describe('snapshotArea', () => {
  it('stores the rectangle in page coordinates with the container and the elements', () => {
    hits = [$('#c2'), $('section'), $('main'), document.body]
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(10)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(500)
    const { target, container } = snapshotArea(document, { ...around, x: 110.4, width: 659.6 })
    expect(container).toBe($('section'))
    expect(target.rect).toEqual({ x: 120, y: 640, width: 660, height: 120 })
    expect(target.container.selector).toBe('section.features')
    expect(target.elements.map((e) => e.text)).toEqual(['Fast setup', 'Secure', 'Support'])
    expect(target.moreCount).toBe(0)
    expect(isTarget(target)).toBe(true)
  })

  it('reports how many elements did not fit', () => {
    $('section').innerHTML = Array.from({ length: 13 }, (_, i) => `<i id="i${i}"></i>`).join('')
    for (let i = 0; i < 13; i++) box(`#i${i}`, 120 + i * 50, 150, 40, 40)
    hits = [$('section')]
    const { target } = snapshotArea(document, { x: 110, y: 140, width: 700, height: 60 })
    expect(target.elements).toHaveLength(10)
    expect(target.moreCount).toBe(3)
  })
})
