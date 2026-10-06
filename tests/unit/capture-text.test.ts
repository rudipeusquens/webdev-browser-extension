import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codePoints } from '@/lib/collection/validate'
import {
  chipAnchor,
  rangeContainer,
  sameRange,
  selectionRange,
  snapshotRange,
} from '@/lib/capture/text'
import { join, readBackward, readForward, TextReader } from '@/lib/capture/reader'
import { chromeLikeVisibility } from './helpers/chrome-visibility'

const $ = (selector: string) => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`fixture has no ${selector}`)
  return el
}

/** The text node under `root` that contains `needle`, and where `needle` starts in it. */
function find(root: Node, needle: string): { node: Text; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const offset = (node as Text).data.indexOf(needle)
    if (offset >= 0) return { node: node as Text, offset }
  }
  throw new Error(`no text node contains ${needle}`)
}

/** A range from the start of `from` to the end of `to` (both looked up as text). */
function between(from: string, to: string, root: Node = document.body): Range {
  const start = find(root, from)
  const end = find(root, to)
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + to.length)
  return range
}

const over = (text: string, root: Node = document.body) => between(text, text, root)

function select(range: Range) {
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

type Dom = { openOrClosedShadowRoot(el: Element): ShadowRoot | undefined }

beforeEach(() => {
  document.body.innerHTML = ''
  // WXT's fake browser has no chrome.dom; Chrome answers with the element's shadow root.
  const dom = (globalThis as unknown as { chrome: { dom: Dom } }).chrome.dom
  vi.spyOn(dom, 'openOrClosedShadowRoot').mockImplementation((el) => el.shadowRoot ?? undefined)
})

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  vi.restoreAllMocks()
})

describe('snapshotRange', () => {
  it('captures the selection, its context and the container (spec section 7 example)', () => {
    document.body.innerHTML =
      '<h3>Preferences</h3>' +
      '<section class="prefs"><h3>Manage your Email notifcations and alerts</h3></section>'
    const target = snapshotRange(over('Email notifcations'))?.target
    expect(target).toMatchObject({
      kind: 'text',
      selected: 'Email notifcations',
      before: 'Manage your ',
      after: ' and alerts',
    })
    expect(target?.container.selector).toBe('section.prefs > h3')
  })

  it('cuts long context to 40 characters on each side, marked with …', () => {
    const left = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod'
    const right = 'tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam'
    document.body.innerHTML = `<p>${left} TARGET ${right}</p>`
    const target = snapshotRange(over('TARGET'))?.target
    expect(target?.before).toBe(`…${left.slice(-39)} `)
    expect(codePoints(target?.before ?? '')).toBe(41)
    expect(target?.after).toBe(` ${right.slice(0, 39)}…`)
    expect(codePoints(target?.after ?? '')).toBe(41)
  })

  it('caps the selected text at 500 code points', () => {
    document.body.innerHTML = `<p>${'a'.repeat(700)}</p>`
    const p = $('p').firstChild as Text
    const range = document.createRange()
    range.setStart(p, 0)
    range.setEnd(p, 700)
    const target = snapshotRange(range)?.target
    expect(codePoints(target?.selected ?? '')).toBe(500)
    expect(target?.selected.endsWith('…')).toBe(true)
  })

  it('moves whitespace at the edges of the selection into the context', () => {
    document.body.innerHTML = '<p>Manage your\n  Email\nnotifications  and alerts</p>'
    const target = snapshotRange(between('\n  Email', 'notifications  '))?.target
    expect(target?.selected).toBe('Email notifications')
    expect(target?.before).toBe('Manage your ')
    expect(target?.after).toBe(' and alerts')
  })

  it('separates text of different blocks and line breaks with a space', () => {
    document.body.innerHTML = '<article><p>First</p><p>Second</p></article>'
    const target = snapshotRange(between('First', 'Second'))?.target
    expect(target?.selected).toBe('First Second')
    expect(target?.container.selector).toBe('article')

    document.body.innerHTML = '<p>Alpha <b>bold</b> text</p><p>one<br>two</p>'
    expect(snapshotRange(between('Alpha', 'text'))?.target.selected).toBe('Alpha bold text')
    expect(snapshotRange(between('one', 'two'))?.target.selected).toBe('one two')
  })

  it('never reads form fields, scripts or styles inside the selection', () => {
    document.body.innerHTML =
      '<div><p>Before the form</p>' +
      '<form><input name="token"><textarea>Draft text</textarea>' +
      '<select><option>Option label</option></select>' +
      '<script>var inline = 1</script><style>p { color: red }</style></form>' +
      '<p>After the form</p></div>'
    ;($('input') as HTMLInputElement).value = 'SECRET-VALUE'
    ;($('textarea') as HTMLTextAreaElement).value = 'Typed text'
    const target = snapshotRange(between('Before', 'After the form'))?.target
    const all = JSON.stringify(target)
    expect(target?.selected).toBe('Before the form After the form')
    for (const secret of ['SECRET', 'Draft', 'Typed', 'Option', 'inline', 'color']) {
      expect(all).not.toContain(secret)
    }
  })

  it('takes context only from the block that holds the selection', () => {
    document.body.innerHTML = '<p>Neighbour paragraph</p><p>Start of this one ends here.</p>'
    const target = snapshotRange(over('this one'))?.target
    expect(target?.before).toBe('Start of ')
    expect(target?.after).toBe(' ends here.')
  })

  it('keeps form field values out of the context', () => {
    document.body.innerHTML = '<p>Name <input name="n"> is TARGET then <textarea>x</textarea>.</p>'
    ;($('input') as HTMLInputElement).value = 'SECRET-VALUE'
    const target = snapshotRange(over('TARGET'))?.target
    expect(target?.before).toBe('Name is ')
    expect(target?.after).toBe(' then .')
  })

  it('returns the part of the range it read, without white space at its edges', () => {
    document.body.innerHTML = '<p>Manage your\n  Email\nnotifications  and alerts</p>'
    const captured = snapshotRange(between('\n  Email', 'notifications  '))
    expect(captured?.range.toString()).toBe('Email\nnotifications')
  })

  it('takes the paragraph of a triple-click, which Chrome ends at the next block', () => {
    document.body.innerHTML =
      '<main><p id="first">First paragraph says something here.</p>\n' +
      '<p id="second">Second paragraph text.</p></main>'
    const range = document.createRange()
    range.setStart($('#first').firstChild as Text, 0)
    range.setEnd($('#second'), 0)
    const captured = snapshotRange(range)
    expect(captured?.target).toMatchObject({
      selected: 'First paragraph says something here.',
      before: '',
      after: '',
    })
    expect(captured?.target.container.selector).toBe('#first')
    expect(captured?.range.toString()).toBe('First paragraph says something here.')
  })

  it('separates context of other blocks from the selection with a space', () => {
    document.body.innerHTML =
      '<article><h2>Head</h2><p>First</p><p>Second</p><h4>Tail</h4></article>'
    const target = snapshotRange(between('First', 'Second'))?.target
    expect(target?.before).toBe('Head ')
    expect(target?.after).toBe(' Tail')
  })

  it('ends the returned range where reading a huge selection stopped', () => {
    document.body.innerHTML = `<div>${`<span>${'w'.repeat(1000)} </span>`.repeat(10)}</div>`
    const range = document.createRange()
    range.selectNodeContents($('div'))
    const captured = snapshotRange(range)
    expect(range.toString().length).toBe(10010)
    expect(captured?.range.toString().length).toBeLessThan(4100)
  })

  it('keeps text inside display: contents wrappers, which Chrome reports as not visible', () => {
    chromeLikeVisibility()
    document.body.innerHTML =
      '<p>Read the <span style="display: contents">terms of service</span> first.</p>'
    expect(chipAnchor(over('terms of service'))?.toString()).toBe('e')
    expect(snapshotRange(between('Read', 'first.'))?.target.selected).toBe(
      'Read the terms of service first.',
    )
  })

  it('returns null for a collapsed or whitespace-only range', () => {
    document.body.innerHTML = '<p>Some   text</p>'
    const text = $('p').firstChild as Text
    const range = document.createRange()
    range.setStart(text, 2)
    range.setEnd(text, 2)
    expect(snapshotRange(range)).toBeNull()
    range.setStart(text, 4)
    range.setEnd(text, 7)
    expect(snapshotRange(range)).toBeNull()
  })

  it('stops reading huge selections early and marks the cut', () => {
    document.body.innerHTML = `<div>${`<span>${'w'.repeat(1000)} </span>`.repeat(10)}</div>`
    const range = document.createRange()
    range.selectNodeContents($('div'))
    const target = snapshotRange(range)?.target
    expect(codePoints(target?.selected ?? '')).toBe(500)
    expect(target?.selected.endsWith('…')).toBe(true)
  })

  it('marks a cut also when the budget ends before 500 characters', () => {
    document.body.innerHTML = `<div><span>early</span>${'<i></i>'.repeat(20000)}<span>late</span></div>`
    const range = document.createRange()
    range.selectNodeContents($('div'))
    expect(snapshotRange(range)?.target.selected).toBe('early…')
  })

  it('returns null when the budget ends before any text', () => {
    document.body.innerHTML = `<div>${'<i></i>'.repeat(20000)}<span>late</span></div>`
    const range = document.createRange()
    range.selectNodeContents($('div'))
    expect(snapshotRange(range)).toBeNull()
  })
})

describe('selectionRange', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<p id="text">Some selectable words</p><textarea id="field">Field text</textarea>'
  })

  it('is null without a selection or when it is collapsed', () => {
    expect(selectionRange(document)).toBeNull()
    const range = document.createRange()
    range.setStart($('#text').firstChild as Text, 3)
    select(range)
    expect(selectionRange(document)).toBeNull()
  })

  it('returns a copy of the selected range', () => {
    select(over('selectable'))
    const range = selectionRange(document)
    expect(range?.toString()).toBe('selectable')
    select(over('words'))
    expect(range?.toString()).toBe('selectable')
  })

  it('is null while a form field has the focus', () => {
    select(over('selectable'))
    ;($('#field') as HTMLTextAreaElement).focus()
    expect(selectionRange(document)).toBeNull()
  })

  it('is null when the selection starts or ends inside a form field', () => {
    select(between('words', 'Field'))
    expect(selectionRange(document)).toBeNull()
    select(over('Field'))
    expect(selectionRange(document)).toBeNull()
  })
})

describe('rangeContainer', () => {
  it('is the parent element of a text node', () => {
    document.body.innerHTML = '<p><b>bold</b> text</p>'
    expect(rangeContainer(over('bold'))).toBe($('b'))
  })

  it('lifts a range inside a shadow root out to the host', () => {
    document.body.innerHTML = '<x-card></x-card>'
    const host = $('x-card')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<p>Shadow words</p>'
    expect(rangeContainer(over('Shadow', root))).toBe(host)
  })
})

describe('chipAnchor', () => {
  it('is the last character the range shows', () => {
    document.body.innerHTML = '<p>Some words</p>'
    expect(chipAnchor(over('words'))?.toString()).toBe('s')
  })

  it('skips white space, scripts and a triple-click into the next block at the end', () => {
    // A script, not hidden text: happy-dom's TreeWalker.previousNode() loses its place after
    // a skipped element that has children (Chrome follows the spec).
    document.body.innerHTML =
      '<main><p id="a">Ends here. <script>var x</script>  </p>\n<p id="b">Next</p></main>'
    const range = document.createRange()
    range.setStart($('#a').firstChild as Text, 0)
    range.setEnd($('#b'), 0)
    expect(chipAnchor(range)?.toString()).toBe('.')
  })

  it('is null for white space, form fields and scripts only', () => {
    document.body.innerHTML =
      '<div><p>   </p><textarea>Draft</textarea><script>var x</script></div>'
    const range = document.createRange()
    range.selectNodeContents($('div'))
    expect(chipAnchor(range)).toBeNull()
  })

  it('takes the first character when the end is far behind hidden content', () => {
    document.body.innerHTML = `<div><span>early</span>${'<i></i>'.repeat(20000)}</div>`
    const range = document.createRange()
    range.selectNodeContents($('div'))
    expect(chipAnchor(range)?.toString()).toBe('e')
  })

  it('never ends up before the start of the range', () => {
    document.body.innerHTML = '<p>Before <b>   </b></p>'
    const range = document.createRange()
    range.selectNodeContents($('b'))
    expect(chipAnchor(range)).toBeNull()
  })
})

describe('sameRange', () => {
  it('compares both boundaries', () => {
    document.body.innerHTML = '<p>Some words here</p>'
    expect(sameRange(over('words'), over('words'))).toBe(true)
    expect(sameRange(over('words'), over('Some'))).toBe(false)
    expect(sameRange(over('words'), between('words', 'here'))).toBe(false)
  })

  it('is false for ranges in different trees', () => {
    document.body.innerHTML = '<p>Some words</p>'
    const host = document.createElement('div')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<p>Some words</p>'
    document.body.append(host)
    expect(sameRange(over('words'), over('words', root))).toBe(false)
  })
})

describe('readForward', () => {
  it('stops inside one huge text node once it has read its limit', () => {
    document.body.innerHTML = `<pre>${'log line\n'.repeat(300_000)}</pre>`
    const pre = $('pre')
    const read = readForward(new TextReader(window), pre, pre, 0, () => ({ stop: false }), 100)
    expect(join(read.pieces).length).toBeLessThanOrEqual(101)
    expect(read.cut).toBe(true)
  })

  it('stops inside one huge text node also when reading backwards', () => {
    document.body.innerHTML = `<pre>${'log line\n'.repeat(300_000)}</pre>`
    const text = $('pre').firstChild as Text
    const read = readBackward(new TextReader(window), $('pre'), text, text.length, 40)
    expect(join(read.pieces).length).toBeLessThan(1000)
    expect(read.cut).toBe(true)
  })

  it('reads nothing from a boundary at the end of its root', () => {
    document.body.innerHTML = '<h3>Heading</h3><p>Neighbour paragraph</p>'
    const h3 = $('h3')
    const read = readForward(
      new TextReader(window),
      h3,
      h3,
      h3.childNodes.length,
      () => ({
        stop: false,
      }),
      100,
    )
    expect(join(read.pieces)).toBe('')
  })
})
