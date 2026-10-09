import { describe, expect, it, vi } from 'vitest'
import {
  type CaretPoint,
  createLinkSelect,
  pageSelectSurface,
  type SelectGate,
  selectModifier,
  type SelectSurface,
  wordAt,
} from '@/entrypoints/overlay.content/link-select'

const host = { id: 'host' } as unknown as EventTarget
const link = { id: 'link' } as unknown as EventTarget
const text = document.createTextNode('pricing details for teams')

/** The caret under x is at offset x of `text`; the selection is recorded. */
function surface() {
  const selected: [number, number][] = []
  const s: SelectSurface = {
    caretAt: (x) => (x < 0 ? null : { node: text, offset: x }),
    select: (base, extent) => void selected.push([base.offset, extent.offset]),
  }
  return { s, selected }
}

function gate(overrides: Partial<SelectGate> = {}): SelectGate {
  return { host, mac: false, active: () => true, editable: () => false, ...overrides }
}

/** A mouse event as the listeners see it, with spies for what they may call. */
function event(init: Partial<MouseEvent> = {}) {
  const target = init.target ?? link
  return {
    isTrusted: true,
    button: 0,
    buttons: 1,
    detail: 1,
    clientX: 2,
    clientY: 10,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target,
    composedPath: () => [target],
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...init,
  } as unknown as MouseEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopImmediatePropagation: ReturnType<typeof vi.fn>
  }
}

describe('the select modifier', () => {
  it('is Ctrl elsewhere and ⌘ on macOS, where Ctrl+click is a right click', () => {
    expect(selectModifier(event({ ctrlKey: true }), false)).toBe(true)
    expect(selectModifier(event({ metaKey: true }), false)).toBe(false)
    expect(selectModifier(event({ metaKey: true }), true)).toBe(true)
    expect(selectModifier(event({ ctrlKey: true }), true)).toBe(false)
    expect(selectModifier(event(), false)).toBe(false)
  })
})

describe('the word at a caret', () => {
  const at = (offset: number): CaretPoint => ({ node: text, offset })

  it('is the word around it, also at its ends', () => {
    expect(wordAt(at(2))?.map((p) => p.offset)).toEqual([0, 7])
    expect(wordAt(at(8))?.map((p) => p.offset)).toEqual([8, 15])
    expect(wordAt(at(15))?.map((p) => p.offset)).toEqual([8, 15])
  })

  it('is nothing outside a text node', () => {
    expect(wordAt({ node: document.createElement('a'), offset: 0 })).toBeNull()
  })
})

describe('selecting text with the modifier', () => {
  it('puts the caret under the press and extends it with every move, keeping the press from the page', () => {
    const { s, selected } = surface()
    const select = createLinkSelect(s, gate())
    const press = event({ ctrlKey: true, clientX: 0 })
    select.down(press)
    expect(press.preventDefault).toHaveBeenCalled()
    expect(press.stopImmediatePropagation).toHaveBeenCalled()
    select.move(event({ ctrlKey: true, clientX: 4 }))
    select.move(event({ clientX: 15 }))
    expect(selected).toEqual([
      [0, 0],
      [0, 4],
      [0, 15],
    ])
  })

  it('stops at the release, or when a move comes without the button', () => {
    const { s, selected } = surface()
    const select = createLinkSelect(s, gate())
    select.down(event({ ctrlKey: true, clientX: 1 }))
    select.up()
    select.move(event({ clientX: 9 }))
    select.down(event({ ctrlKey: true, clientX: 1 }))
    select.move(event({ clientX: 9, buttons: 0 }))
    select.move(event({ clientX: 12 }))
    expect(selected).toEqual([
      [1, 1],
      [1, 1],
    ])
  })

  it('selects the word under a double click', () => {
    const { s, selected } = surface()
    const select = createLinkSelect(s, gate())
    select.down(event({ ctrlKey: true, clientX: 10, detail: 2 }))
    select.move(event({ clientX: 20 }))
    expect(selected).toEqual([[8, 15]])
  })

  it('skips moves over nothing, or over the overlay', () => {
    const { s, selected } = surface()
    const select = createLinkSelect(s, gate())
    select.down(event({ ctrlKey: true, clientX: 3 }))
    select.move(event({ clientX: -1 }))
    expect(selected).toEqual([[3, 3]])
  })

  it('leaves a press over nothing to the page', () => {
    const { s, selected } = surface()
    const press = event({ ctrlKey: true, clientX: -1 })
    createLinkSelect(s, gate()).down(press)
    expect(press.preventDefault).not.toHaveBeenCalled()
    expect(selected).toEqual([])
  })

  it.each([
    ['without the modifier', event(), gate()],
    ['with another button', event({ ctrlKey: true, button: 2 }), gate()],
    ['for an untrusted event', event({ ctrlKey: true, isTrusted: false }), gate()],
    ['inside the overlay', event({ ctrlKey: true, target: host }), gate()],
    [
      'while inactive (no panel, or not Browse)',
      event({ ctrlKey: true }),
      gate({ active: () => false }),
    ],
    ['with Ctrl on macOS', event({ ctrlKey: true }), gate({ mac: true })],
    ['in a text field', event({ ctrlKey: true }), gate({ editable: () => true })],
  ])('leaves a press to the page %s', (_, e, g) => {
    const { s, selected } = surface()
    createLinkSelect(s, g).down(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(selected).toEqual([])
  })

  it('keeps a click with the modifier from the page: no link opens, no handler runs', () => {
    const { s } = surface()
    const click = event({ ctrlKey: true })
    createLinkSelect(s, gate()).click(click)
    expect(click.preventDefault).toHaveBeenCalled()
    expect(click.stopImmediatePropagation).toHaveBeenCalled()
  })

  it.each([
    ['without the modifier', event(), gate()],
    ['inside the overlay (the chip, a pin)', event({ ctrlKey: true, target: host }), gate()],
    ['while inactive', event({ ctrlKey: true }), gate({ active: () => false })],
    ['for an untrusted event', event({ ctrlKey: true, isTrusted: false }), gate()],
  ])('lets a click through %s', (_, e, g) => {
    const { s } = surface()
    createLinkSelect(s, g).click(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled()
  })
})

describe("the page's surface", () => {
  it('finds no caret inside the overlay', () => {
    const overlay = document.createElement('div')
    const inside = document.createTextNode('pin')
    overlay.append(inside)
    const doc = {
      caretPositionFromPoint: () => ({ offsetNode: inside, offset: 0 }),
    } as unknown as Document
    expect(pageSelectSurface(doc, overlay).caretAt(1, 1)).toBeNull()
    expect(
      pageSelectSurface(
        {
          caretPositionFromPoint: () => ({ offsetNode: overlay, offset: 0 }),
        } as unknown as Document,
        overlay,
      ).caretAt(1, 1),
    ).toBeNull()
  })

  it('falls back to caretRangeFromPoint, and to nothing', () => {
    const range = document.createRange()
    range.setStart(text, 3)
    const doc = { caretRangeFromPoint: () => range } as unknown as Document
    expect(pageSelectSurface(doc, document.createElement('div')).caretAt(1, 1)).toEqual({
      node: text,
      offset: 3,
    })
    expect(
      pageSelectSurface({} as Document, document.createElement('div')).caretAt(1, 1),
    ).toBeNull()
  })

  it('survives a node the page removed meanwhile', () => {
    const doc = {
      getSelection: () => ({
        setBaseAndExtent: () => {
          throw new Error('IndexSizeError')
        },
      }),
    } as unknown as Document
    const at = { node: text, offset: 1 }
    expect(() => pageSelectSurface(doc, document.createElement('div')).select(at, at)).not.toThrow()
  })
})
