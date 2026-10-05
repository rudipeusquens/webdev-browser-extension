import { describe, expect, it } from 'vitest'
import { blockquote, inlineCode, plain, quoted } from '@/lib/format/escape'

describe('inlineCode', () => {
  it('uses a plain fence when there is no backtick', () => {
    expect(inlineCode('div.card')).toBe('`div.card`')
  })

  it('makes the fence longer than the longest backtick run', () => {
    expect(inlineCode('a`b')).toBe('``a`b``')
    expect(inlineCode('a``b`c')).toBe('```a``b`c```')
  })

  it('pads content that starts or ends with a backtick', () => {
    expect(inlineCode('`x')).toBe('`` `x ``')
    expect(inlineCode('x`')).toBe('`` x` ``')
  })
})

describe('quoted', () => {
  it('escapes backslashes and double quotes', () => {
    expect(quoted('say "hi" \\o/')).toBe('"say \\"hi\\" \\\\o/"')
  })

  it('neutralizes HTML tags', () => {
    expect(quoted('<img src=x onerror=alert(1)>')).toBe('"\\<img src=x onerror=alert(1)>"')
  })
})

describe('plain', () => {
  it('escapes only what would start an HTML tag or comment', () => {
    expect(plain('<b>a</b> & a < b <!-- c -->')).toBe('\\<b>a\\</b> & a < b \\<!-- c -->')
    expect(plain('/srv/my_app/*.vue')).toBe('/srv/my_app/*.vue')
  })
})

describe('blockquote', () => {
  it('prefixes every line and keeps empty lines inside the quote', () => {
    expect(blockquote('a\n\nb')).toBe('> a\n>\n> b')
  })

  it('normalizes Windows line breaks and trims trailing blank lines', () => {
    expect(blockquote('a\r\nb\n\n')).toBe('> a\n> b')
  })
})
