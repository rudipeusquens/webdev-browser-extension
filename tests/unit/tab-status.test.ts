import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { clearBlocked, isBlocked, markBlocked } from '@/lib/background/tab-status'

describe('tab status', () => {
  beforeEach(() => fakeBrowser.reset())

  it('marks and clears a blocked tab in session storage only', async () => {
    expect(await isBlocked(7)).toBe(false)
    await markBlocked(7)
    expect(await isBlocked(7)).toBe(true)
    expect(await isBlocked(8)).toBe(false)
    expect(await fakeBrowser.storage.local.get()).toEqual({})
    await clearBlocked(7)
    expect(await isBlocked(7)).toBe(false)
  })
})
