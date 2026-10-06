import { beforeEach, describe, expect, it } from 'vitest'
import { forwardsWheel, isEditable, pickAt, TargetPath } from '@/entrypoints/overlay.content/picker'

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
