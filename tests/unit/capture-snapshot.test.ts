import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openingTag, pageInfo, snapshotElement, visibleText } from '@/lib/capture/snapshot'
import { isElementSnapshot, isPageInfo } from '@/lib/collection/validate'
import { chromeLikeVisibility } from './helpers/chrome-visibility'

const $ = (selector: string) => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`fixture has no ${selector}`)
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openingTag', () => {
  it('keeps attributes in source order', () => {
    document.body.innerHTML = '<button type="submit" class="h-12 px-6" disabled>Save</button>'
    expect(openingTag($('button'))).toBe('<button type="submit" class="h-12 px-6" disabled>')
  })

  it('records only type and name of form fields', () => {
    document.body.innerHTML =
      '<input type="email" name="email" value="person@example.com" placeholder="x" data-x="y">' +
      '<textarea name="note" rows="3">secret</textarea>' +
      '<select name="plan"><option value="pro" selected>Pro</option></select>'
    expect(openingTag($('input'))).toBe('<input type="email" name="email">')
    expect(openingTag($('textarea'))).toBe('<textarea name="note">')
    expect(openingTag($('select'))).toBe('<select name="plan">')
  })

  it('records no attributes of options, which hold the values a select offers', () => {
    document.body.innerHTML =
      '<select name="plan" size="3"><optgroup label="Paid"><option value="pro" selected>Pro</option></optgroup></select>'
    expect(openingTag($('option'))).toBe('<option>')
    expect(openingTag($('optgroup'))).toBe('<optgroup>')
  })

  it('caps attribute values at 60 and the tag at 200, keeping the closing bracket', () => {
    document.body.innerHTML = `<div title="${'t'.repeat(100)}">x</div>`
    expect(openingTag($('div'))).toBe(`<div title="${'t'.repeat(59)}…">`)
    const many = Array.from({ length: 20 }, (_, i) => `data-a${i}="${'v'.repeat(20)}"`).join(' ')
    document.body.innerHTML = `<div ${many}>x</div>`
    const tag = openingTag($('div'))
    expect([...tag]).toHaveLength(200)
    expect(tag.endsWith('…>')).toBe(true)
  })

  it('escapes quotes and collapses line breaks in values', () => {
    document.body.innerHTML = '<div title="a &quot;b&quot;\nc">x</div>'
    expect(openingTag($('div'))).toBe('<div title="a &quot;b&quot; c">')
  })
})

describe('visibleText', () => {
  it('collapses whitespace and caps at 120', () => {
    document.body.innerHTML = `<p>${'word '.repeat(60)}</p>`
    const text = visibleText($('p'))
    expect([...text]).toHaveLength(120)
    expect(text.endsWith('…')).toBe(true)
  })

  it('leaves out field values, option labels, scripts and styles inside the element', () => {
    document.body.innerHTML =
      '<form><label>Plan <select><option>Secret plan</option></select></label>' +
      '<textarea>Draft</textarea><input value="typed">' +
      '<script>var inline = 1</script><style>p { color: red }</style>' +
      '<button>Send</button></form>'
    expect(visibleText($('form'))).toBe('Plan Send')
  })

  it('keeps text that cannot be selected', () => {
    document.body.innerHTML = '<button style="user-select: none">Save</button>'
    expect(visibleText($('button'))).toBe('Save')
  })

  it('keeps text inside display: contents wrappers, which Chrome reports as not visible', () => {
    chromeLikeVisibility()
    document.body.innerHTML = '<p><span style="display: contents">Wrapped words</span></p>'
    expect(visibleText($('p'))).toBe('Wrapped words')
  })

  it('is empty for form fields', () => {
    document.body.innerHTML =
      '<textarea>secret</textarea><select><option>Pro</option><option>Free</option></select>'
    expect(visibleText($('textarea'))).toBe('')
    expect(visibleText($('select'))).toBe('')
  })
})

describe('snapshotElement', () => {
  it('builds a valid snapshot with the box in page coordinates', () => {
    document.body.innerHTML = '<main><button class="primary">Save</button></main>'
    const button = $('button')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 10.4, y: 20.6, width: 99.5, height: 30 }),
    )
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(5)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(100)
    const snapshot = snapshotElement(button)
    expect(snapshot).toMatchObject({
      selector: 'button.primary',
      openingTag: '<button class="primary">',
      text: 'Save',
      box: { x: 15, y: 121, width: 100, height: 30 },
    })
    expect(isElementSnapshot(snapshot)).toBe(true)
  })
})

describe('pageInfo', () => {
  it('captures URL, cleaned title, viewport and color scheme', () => {
    document.title = 'Shop\n  settings'
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: query === '(prefers-color-scheme: dark)' }) as MediaQueryList,
    )
    const info = pageInfo(window)
    expect(info).toMatchObject({ title: 'Shop settings', colorScheme: 'dark' })
    expect(info.url).toBe(window.location.href)
    expect(info.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight })
    expect(isPageInfo(info)).toBe(true)
  })

  it('stores the URL without hash and credentials (spec section 6)', () => {
    // Assembled at runtime: the secret scanner rightly flags credentials written in URLs.
    const href = new URL('https://example.com/app?tab=1#access_token=abc')
    href.username = 'user'
    href.password = 'placeholder'
    const win = {
      location: { href: href.href },
      document: { title: 'App' },
      innerWidth: 800,
      innerHeight: 600,
      matchMedia: () => ({ matches: false }),
    } as unknown as Window
    expect(pageInfo(win).url).toBe('https://example.com/app?tab=1')
  })
})
