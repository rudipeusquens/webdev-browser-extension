import { describe, expect, it } from 'vitest'
import { pageKey } from '@/lib/collection/page-key'

describe('pageKey', () => {
  it('drops the hash', () => {
    expect(pageKey('http://localhost:3000/settings#billing')).toBe('http://localhost:3000/settings')
  })

  it('keeps the query', () => {
    expect(pageKey('http://localhost:3000/settings?tab=2#x')).toBe(
      'http://localhost:3000/settings?tab=2',
    )
  })

  it('keeps a trailing slash distinct', () => {
    expect(pageKey('http://localhost:3000/a')).not.toBe(pageKey('http://localhost:3000/a/'))
  })

  it('normalizes an origin-only URL to its root path', () => {
    expect(pageKey('http://localhost:3000')).toBe('http://localhost:3000/')
  })
})
