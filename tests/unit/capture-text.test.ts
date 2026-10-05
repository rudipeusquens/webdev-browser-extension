import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codePoints } from '@/lib/collection/validate'
import { rangeContainer, rangeHasText, selectionRange, snapshotRange } from '@/lib/capture/text'

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

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

describe('snapshotRange', () => {
  it('captures the selection, its context and the container (spec section 7 example)', () => {
    document.body.innerHTML =
      '<h3>Preferences</h3>' +
      '<section class="prefs"><h3>Manage your Email notifcations and alerts</h3></section>'
    const target = snapshotRange(over('Email notifcations'))
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
    const target = snapshotRange(over('TARGET'))
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
    const target = snapshotRange(range)
    expect(codePoints(target?.selected ?? '')).toBe(500)
    expect(target?.selected.endsWith('…')).toBe(true)
  })

  it('moves whitespace at the edges of the selection into the context', () => {
    document.body.innerHTML = '<p>Manage your\n  Email\nnotifications  and alerts</p>'
    const target = snapshotRange(between('\n  Email', 'notifications  '))
    expect(target?.selected).toBe('Email notifications')
    expect(target?.before).toBe('Manage your ')
    expect(target?.after).toBe(' and alerts')
  })

  it('separates text of different blocks and line breaks with a space', () => {
    document.body.innerHTML = '<article><p>First</p><p>Second</p></article>'
    const target = snapshotRange(between('First', 'Second'))
    expect(target?.selected).toBe('First Second')
    expect(target?.container.selector).toBe('article')

    document.body.innerHTML = '<p>Alpha <b>bold</b> text</p><p>one<br>two</p>'
    expect(snapshotRange(between('Alpha', 'text'))?.selected).toBe('Alpha bold text')
    expect(snapshotRange(between('one', 'two'))?.selected).toBe('one two')
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
    const target = snapshotRange(between('Before', 'After the form'))
    const all = JSON.stringify(target)
    expect(target?.selected).toBe('Before the form After the form')
    for (const secret of ['SECRET', 'Draft', 'Typed', 'Option', 'inline', 'color']) {
      expect(all).not.toContain(secret)
    }
  })

  it('takes context only from the block that holds the selection', () => {
    document.body.innerHTML = '<p>Neighbour paragraph</p><p>Start of this one ends here.</p>'
    const target = snapshotRange(over('this one'))
    expect(target?.before).toBe('Start of ')
    expect(target?.after).toBe(' ends here.')
  })

  it('keeps form field values out of the context', () => {
    document.body.innerHTML = '<p>Name <input name="n"> is TARGET then <textarea>x</textarea>.</p>'
    ;($('input') as HTMLInputElement).value = 'SECRET-VALUE'
    const target = snapshotRange(over('TARGET'))
    expect(target?.before).toBe('Name is ')
    expect(target?.after).toBe(' then .')
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
    const target = snapshotRange(range)
    expect(codePoints(target?.selected ?? '')).toBe(500)
    expect(target?.selected.endsWith('…')).toBe(true)
  })

  it('marks a cut also when the budget ends before 500 characters', () => {
    document.body.innerHTML = `<div><span>early</span>${'<i></i>'.repeat(20000)}<span>late</span></div>`
    const range = document.createRange()
    range.selectNodeContents($('div'))
    expect(snapshotRange(range)?.selected).toBe('early…')
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

describe('rangeHasText', () => {
  it('is true when the range holds text the page shows', () => {
    document.body.innerHTML = '<p>Some words</p>'
    expect(rangeHasText(over('words'))).toBe(true)
  })

  it('is false for whitespace, form fields and scripts only', () => {
    document.body.innerHTML =
      '<div><p>   </p><textarea>Draft</textarea><script>var x</script></div>'
    const range = document.createRange()
    range.selectNodeContents($('div'))
    expect(rangeHasText(range)).toBe(false)
  })
})
