import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from '@/lib/ids'
import { isAnnotationId } from '@/lib/collection/validate'

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is 32 hex characters and a valid annotation id', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(isAnnotationId(id)).toBe(true)
  })

  it('differs between calls', () => {
    expect(newId()).not.toBe(newId())
  })

  it('works where crypto.randomUUID is missing (insecure contexts)', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    expect(newId()).toMatch(/^[0-9a-f]{32}$/)
  })
})
