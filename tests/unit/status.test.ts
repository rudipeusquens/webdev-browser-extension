import { describe, expect, it } from 'vitest'
import { STATUS_BADGE, STATUS_MARK, STATUS_NAME, toneOf, TONES } from '@/lib/status'

describe('tones', () => {
  it('are the statuses, with drafts grey while they are open', () => {
    expect(toneOf({ status: 'open' })).toBe('open')
    expect(toneOf({ status: 'open', draft: true })).toBe('draft')
    expect(toneOf({ status: 'done' })).toBe('done')
    // A deleted draft is in the bin like any pin: red.
    expect(toneOf({ status: 'deleted', draft: true })).toBe('deleted')
  })

  it('each have a name, a badge and marks', () => {
    expect(TONES).toEqual(['open', 'done', 'deleted', 'draft'])
    for (const tone of TONES) {
      expect(STATUS_NAME[tone]).toBeTruthy()
      expect(STATUS_BADGE[tone]).toMatch(/^bg-/)
      expect(Object.values(STATUS_MARK[tone]).every(Boolean)).toBe(true)
    }
    expect(STATUS_NAME.draft).toBe('Draft')
    expect(STATUS_BADGE.draft).toBe('bg-zinc-500')
  })
})
