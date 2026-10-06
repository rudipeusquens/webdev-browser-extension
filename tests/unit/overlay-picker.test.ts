import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  forwardsWheel,
  isEditable,
  pickAt,
  TargetPath,
  wheelTarget,
} from '@/entrypoints/overlay.content/picker'

const $ = (selector: string) => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`fixture has no ${selector}`)
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('pickAt', () => {
  const at = (...elements: Element[]) =>
    ({
      elementsFromPoint: () => elements,
      documentElement: document.documentElement,
    }) as unknown as Document

  it('returns the first element under the point that is not the overlay host', () => {
    document.body.innerHTML = '<webdev-overlay></webdev-overlay><button>Save</button>'
    const host = $('webdev-overlay')
    expect(pickAt(at(host, $('button'), document.body), 1, 1, host)).toBe($('button'))
  })

  it('maps the root element to no target', () => {
    const host = document.createElement('webdev-overlay')
    expect(pickAt(at(host, document.documentElement), 1, 1, host)).toBeNull()
    expect(pickAt(at(host), 1, 1, host)).toBeNull()
  })
})

describe('TargetPath', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<main><section><p><b>a</b><i>b</i></p></section></main><webdev-overlay></webdev-overlay>'
  })

  it('walks up and back down the same way', () => {
    const path = new TargetPath($('b'))
    expect(path.up()).toBe($('p'))
    expect(path.up()).toBe($('section'))
    expect(path.down()).toBe($('p'))
    expect(path.down()).toBe($('b'))
  })

  it('stops at the body', () => {
    const path = new TargetPath($('section'))
    path.up()
    expect(path.up()).toBe(document.body)
    expect(path.up()).toBe(document.body)
  })

  it('goes to the first element child on a fresh path and stays at a leaf', () => {
    expect(new TargetPath($('p')).down()).toBe($('b'))
    expect(new TargetPath($('b')).down()).toBe($('b'))
  })

  it('never steps into the overlay host', () => {
    document.body.innerHTML = '<webdev-overlay></webdev-overlay><main>x</main>'
    const path = new TargetPath(document.body, $('webdev-overlay'))
    expect(path.down()).toBe($('main'))
  })
})

describe('isEditable', () => {
  it.each([
    ['<input>', true],
    ['<input type="email">', true],
    ['<input type="checkbox">', false],
    ['<input type="submit">', false],
    ['<textarea></textarea>', true],
    ['<select></select>', true],
    ['<div contenteditable="true">x</div>', true],
    ['<div contenteditable="false">x</div>', false],
    ['<button>x</button>', false],
  ])('%s → %s', (html, expected) => {
    document.body.innerHTML = html
    expect(isEditable(document.body.firstElementChild)).toBe(expected)
  })

  it('treats an element inside a contenteditable region as editable', () => {
    document.body.innerHTML = '<div contenteditable><p><b>x</b></p></div>'
    expect(isEditable($('b'))).toBe(true)
  })

  it('handles no element', () => {
    expect(isEditable(null)).toBe(false)
  })
})

describe('forwardsWheel', () => {
  // Plain objects: happy-dom's WheelEvent ignores modifier keys.
  const wheel = (keys: { ctrlKey?: boolean; metaKey?: boolean }) => ({
    ctrlKey: false,
    metaKey: false,
    ...keys,
  })

  it('scrolls for plain wheel turns', () => {
    expect(forwardsWheel(wheel({}))).toBe(true)
  })

  it('leaves zooming with Ctrl or Cmd to the browser', () => {
    expect(forwardsWheel(wheel({ ctrlKey: true }))).toBe(false)
    expect(forwardsWheel(wheel({ metaKey: true }))).toBe(false)
  })
})

describe('wheelTarget', () => {
  /** Geometry happy-dom does not compute: this much content, scrolled this far. */
  function measure(
    el: HTMLElement,
    size: { height: number; scrollHeight: number; scrollTop?: number },
  ) {
    for (const key of ['clientHeight', 'scrollHeight', 'clientWidth', 'scrollWidth']) {
      delete (el as unknown as Record<string, unknown>)[key]
    }
    Object.defineProperties(el, {
      clientHeight: { value: size.height, configurable: true },
      scrollHeight: { value: size.scrollHeight, configurable: true },
      clientWidth: { value: size.height, configurable: true },
      scrollWidth: { value: size.scrollHeight, configurable: true },
      scrollTop: { value: size.scrollTop ?? 0, writable: true, configurable: true },
      scrollLeft: { value: size.scrollTop ?? 0, writable: true, configurable: true },
    })
  }

  /** A scroll container with this much content, scrolled this far (happy-dom has no layout). */
  function box(
    id: string,
    size: { height: number; scrollHeight: number; scrollTop?: number },
    overflow = 'auto',
  ) {
    const el = document.createElement('div')
    el.id = id
    el.style.overflowY = overflow
    el.style.overflowX = overflow
    measure(el, size)
    return el
  }

  afterEach(() => {
    document.documentElement.removeAttribute('style')
    document.body.removeAttribute('style')
    for (const key of [
      'clientHeight',
      'scrollHeight',
      'clientWidth',
      'scrollWidth',
      'scrollTop',
      'scrollLeft',
    ]) {
      delete (document.body as unknown as Record<string, unknown>)[key]
    }
  })

  /** The container's id, or what else the turn goes to. */
  const idOf = (target: ReturnType<typeof wheelTarget>) =>
    target instanceof Element ? target.id : target

  function nest(...boxes: HTMLElement[]) {
    let parent: HTMLElement = document.body
    for (const b of boxes) {
      parent.append(b)
      parent = b
    }
    const leaf = document.createElement('p')
    parent.append(leaf)
    return leaf
  }

  it('is the nearest container that can still move that way', () => {
    const leaf = nest(
      box('outer', { height: 100, scrollHeight: 500 }),
      box('inner', { height: 100, scrollHeight: 300 }),
    )
    expect(idOf(wheelTarget(leaf, true, 100))).toBe('inner')
  })

  it('passes a container at its end on to the next one', () => {
    const leaf = nest(
      box('outer', { height: 100, scrollHeight: 500 }),
      box('inner', { height: 100, scrollHeight: 300, scrollTop: 200 }),
    )
    expect(idOf(wheelTarget(leaf, true, 100))).toBe('outer')
    // Upwards it can still move.
    expect(idOf(wheelTarget(leaf, true, -100))).toBe('inner')
  })

  it('passes a container at its top on when the wheel turns up', () => {
    const leaf = nest(
      box('outer', { height: 100, scrollHeight: 500, scrollTop: 50 }),
      box('inner', { height: 100, scrollHeight: 300 }),
    )
    expect(idOf(wheelTarget(leaf, true, -100))).toBe('outer')
  })

  it('is the page once no container can move that way', () => {
    const leaf = nest(box('full', { height: 100, scrollHeight: 300, scrollTop: 200 }))
    expect(wheelTarget(leaf, true, 100)).toBe('page')
    expect(wheelTarget(document.body, true, 100)).toBe('page')
    expect(wheelTarget(null, true, 100)).toBe('page')
  })

  it('does not scroll what the page keeps from scrolling', () => {
    const leaf = nest(box('clipped', { height: 100, scrollHeight: 300 }, 'hidden'))
    expect(wheelTarget(leaf, true, 100)).toBe('page')
  })

  it('scrolls a body that is the scroll container itself', () => {
    // The root does not scroll: the body's own overflow makes it a scroller.
    document.documentElement.style.overflowX = 'hidden'
    document.documentElement.style.overflowY = 'hidden'
    document.body.style.overflowY = 'auto'
    measure(document.body, { height: 600, scrollHeight: 5000 })
    const leaf = nest()
    expect(wheelTarget(leaf, true, 100)).toBe(document.body)
  })

  it("leaves the body alone while its overflow is the viewport's", () => {
    // The root's overflow is visible: the body's goes to the viewport, the body never scrolls.
    document.body.style.overflowY = 'auto'
    measure(document.body, { height: 600, scrollHeight: 5000 })
    expect(wheelTarget(nest(), true, 100)).toBe('page')
  })

  it('scrolls nothing past a container that keeps the wheel at its end', () => {
    const inner = box('modal', { height: 100, scrollHeight: 300, scrollTop: 200 })
    inner.style.setProperty('overscroll-behavior-y', 'contain')
    const leaf = nest(box('outer', { height: 100, scrollHeight: 500 }), inner)
    expect(wheelTarget(leaf, true, 100)).toBeNull()
    // Inside it still moves; sideways it keeps nothing.
    expect(idOf(wheelTarget(leaf, true, -100))).toBe('modal')
  })

  it('looks at the width for a sideways turn', () => {
    const leaf = nest(box('wide', { height: 100, scrollHeight: 300 }))
    expect(idOf(wheelTarget(leaf, false, 100))).toBe('wide')
    expect(wheelTarget(leaf, false, -100)).toBe('page')
  })
})
