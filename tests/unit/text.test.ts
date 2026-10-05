import { describe, expect, it } from 'vitest'
import { clean, collapse, truncate } from '@/lib/text'

describe('collapse', () => {
  it('removes control and bidirectional formatting characters', () => {
    expect(collapse('a\u0000b\u0007c\u007f\u009bd')).toBe('abcd')
    expect(collapse('safe\u202Eevil\u2066x\u2069')).toBe('safeevilx')
  })

  it('collapses whitespace and line breaks without trimming', () => {
    expect(collapse(' a\n\n b\tc\r\nd ')).toBe(' a b c d ')
    expect(collapse('a\u2028b\u00a0c')).toBe('a b c')
  })
})

describe('clean', () => {
  it('collapses and trims', () => {
    expect(clean('  a\n\n b\tc  ')).toBe('a b c')
  })

  it('caps at the limit in code points, ending in an ellipsis', () => {
    expect(clean('x'.repeat(120), 120)).toBe('x'.repeat(120))
    expect(clean('x'.repeat(121), 120)).toBe(`${'x'.repeat(119)}…`)
  })
})

describe('truncate', () => {
  it('never splits a surrogate pair', () => {
    expect(truncate('😀'.repeat(5), 3)).toBe('😀😀…')
  })

  it('leaves short strings alone', () => {
    expect(truncate('abc', 3)).toBe('abc')
  })
})
