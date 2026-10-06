import { beforeEach, describe, expect, it } from 'vitest'
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
    Object.defineProperties(el, {
      clientHeight: { value: size.height },
      scrollHeight: { value: size.scrollHeight },
      clientWidth: { value: size.height },
      scrollWidth: { value: size.scrollHeight },
      scrollTop: { value: size.scrollTop ?? 0, writable: true },
      scrollLeft: { value: size.scrollTop ?? 0, writable: true },
    })
    return el
  }

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
    expect(wheelTarget(leaf, true, 100)?.id).toBe('inner')
  })

  it('passes a container at its end on to the next one', () => {
    const leaf = nest(
      box('outer', { height: 100, scrollHeight: 500 }),
      box('inner', { height: 100, scrollHeight: 300, scrollTop: 200 }),
    )
    expect(wheelTarget(leaf, true, 100)?.id).toBe('outer')
    // Upwards it can still move.
    expect(wheelTarget(leaf, true, -100)?.id).toBe('inner')
  })

  it('passes a container at its top on when the wheel turns up', () => {
    const leaf = nest(
      box('outer', { height: 100, scrollHeight: 500, scrollTop: 50 }),
      box('inner', { height: 100, scrollHeight: 300 }),
    )
    expect(wheelTarget(leaf, true, -100)?.id).toBe('outer')
  })

  it('is the document once no container can move that way', () => {
    const leaf = nest(box('full', { height: 100, scrollHeight: 300, scrollTop: 200 }))
    expect(wheelTarget(leaf, true, 100)).toBe(document.scrollingElement)
    expect(wheelTarget(document.body, true, 100)).toBe(document.scrollingElement)
    expect(wheelTarget(null, true, 100)).toBeNull()
  })

  it('does not scroll what the page keeps from scrolling', () => {
    const leaf = nest(box('clipped', { height: 100, scrollHeight: 300 }, 'hidden'))
    expect(wheelTarget(leaf, true, 100)).toBe(document.scrollingElement)
  })

  it('looks at the width for a sideways turn', () => {
    const leaf = nest(box('wide', { height: 100, scrollHeight: 300 }))
    expect(wheelTarget(leaf, false, 100)?.id).toBe('wide')
    expect(wheelTarget(leaf, false, -100)).toBe(document.scrollingElement)
  })
})
