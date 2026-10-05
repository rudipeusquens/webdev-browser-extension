import { beforeEach, describe, expect, it } from 'vitest'
import { buildSelector, cssEscape, isStableClass, isStableId } from '@/lib/capture/selector'

const $ = (selector: string) => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`fixture has no ${selector}`)
  return el
}

/** Builds the selector and checks it matches exactly `el`. */
function selectorFor(el: Element): string {
  const selector = buildSelector(el)
  const matches = document.querySelectorAll(selector)
  expect(matches.length, selector).toBe(1)
  expect(matches[0], selector).toBe(el)
  return selector
}

const depth = (selector: string) => selector.split(' > ').length

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('buildSelector', () => {
  it('prefers a stable unique id', () => {
    document.body.innerHTML = '<div><button id="save">Save</button></div>'
    expect(selectorFor($('button'))).toBe('#save')
  })

  it.each([':r1:', '«r2»', '_r_3_', 'v-12', 'el-123456', 'radix-5', 'headlessui-menu-button-1'])(
    'skips the generated-looking id %s',
    (id) => {
      document.body.innerHTML = '<p><button>Other</button></p><div><button>Save</button></div>'
      const button = $('div > button')
      button.id = id
      expect(selectorFor(button)).not.toContain('#')
    },
  )

  it('uses data-testid and data-test', () => {
    document.body.innerHTML =
      '<div><button data-testid="save">A</button><button data-test="cancel">B</button></div>'
    expect(selectorFor($('[data-testid]'))).toBe('[data-testid="save"]')
    expect(selectorFor($('[data-test]'))).toBe('[data-test="cancel"]')
  })

  it('anchors on an ancestor test id', () => {
    document.body.innerHTML =
      '<section data-testid="plans"><div><span>Pro</span></div></section><div><span>x</span></div>'
    expect(selectorFor($('section span'))).toBe('[data-testid="plans"] > div > span')
  })

  it('skips CSS-module and hash classes', () => {
    document.body.innerHTML =
      '<section><div class="Button_root__x7f2a card">A</div><div>B</div></section>'
    expect(selectorFor($('.card'))).toBe('div.card')
  })

  it('skips utility variants, arbitrary values and state classes', () => {
    document.body.innerHTML =
      '<nav class="css-1h2k3l sc-bdVaJa jsx-123 svelte-1abc2d w-[123px] md:flex w-1/2 !mt-0 is-active active menu">A</nav><nav>B</nav>'
    expect(selectorFor($('nav'))).toBe('nav.menu')
  })

  it('takes at most two classes, those without digits first', () => {
    document.body.innerHTML = '<p class="h-12 px-6 rounded-md bg-primary">A</p><p>B</p>'
    expect(selectorFor($('p'))).toBe('p.rounded-md.bg-primary')
  })

  it('gives identical siblings their own nth-of-type', () => {
    document.body.innerHTML =
      '<ul><li class="item">A</li><li class="item">B</li><li class="item">C</li></ul>'
    const items = [...document.querySelectorAll('li')]
    const selectors = items.map(selectorFor)
    expect(new Set(selectors).size).toBe(3)
    expect(selectors[1]).toBe('li.item:nth-of-type(2)')
  })

  it('counts nth-of-type among elements of the same tag only', () => {
    document.body.innerHTML = '<div><h2>T</h2><p>A</p><p>B</p></div>'
    expect(selectorFor($('p:last-child'))).toBe('p:nth-of-type(2)')
  })

  it('stays within 8 levels when that is enough', () => {
    const levels = 20
    document.body.innerHTML = `<main>${'<div>'.repeat(levels)}<b>x</b>${'</div>'.repeat(levels)}</main>${'<div>'.repeat(levels)}<i>x</i>${'</div>'.repeat(levels)}<b>y</b>`
    const selector = selectorFor($('main b'))
    expect(depth(selector)).toBeLessThanOrEqual(8)
  })

  it('walks past 8 levels when only that is unique', () => {
    const chain = `${'<div>'.repeat(12)}<b>x</b>${'</div>'.repeat(12)}`
    document.body.innerHTML = `<section class="a">${chain}</section><section class="b">${chain}</section>`
    expect(selectorFor($('section.b b'))).toMatch(/^section\.b > /)
  })

  // happy-dom cannot parse hex escapes (`#\\31 st`) or escaped quotes in attribute strings;
  // ids starting with a digit and test ids with quotes are checked in Chrome
  // (tests/e2e/element-mode.e2e.test.ts).
  it('escapes special characters in ids and classes', () => {
    document.body.innerHTML = '<div id="a.b">1</div><p class="x.y">3</p><p>4</p>'
    expect(selectorFor($('[id="a.b"]'))).toBe('#a\\.b')
    expect(selectorFor($('[class="x.y"]'))).toBe('p.x\\.y')
  })

  it('handles body and elements without a parent element', () => {
    expect(buildSelector(document.body)).toBe('body')
    expect(buildSelector(document.documentElement)).toBe('html')
  })
})

describe('isStableId', () => {
  it('rejects empty, long and whitespace ids', () => {
    expect(isStableId('')).toBe(false)
    expect(isStableId('a'.repeat(65))).toBe(false)
    expect(isStableId('a b')).toBe(false)
    expect(isStableId('profile')).toBe(true)
    expect(isStableId('step-2')).toBe(true)
  })
})

describe('isStableClass', () => {
  it('keeps semantic and plain utility classes', () => {
    for (const name of ['card', 'actions', 'h-12', 'text-2xl', 'bg-red-500', 'grid-cols-3']) {
      expect(isStableClass(name), name).toBe(true)
    }
  })

  it('rejects classes over 40 characters', () => {
    expect(isStableClass('a'.repeat(41))).toBe(false)
  })
})

describe('cssEscape', () => {
  it('follows CSS.escape', () => {
    expect(cssEscape('a.b')).toBe('a\\.b')
    expect(cssEscape('1st')).toBe('\\31 st')
    expect(cssEscape('-1')).toBe('-\\31 ')
    expect(cssEscape('-')).toBe('\\-')
    expect(cssEscape('a\u0000b')).toBe('a�b')
    expect(cssEscape('é_-')).toBe('é_-')
  })
})
