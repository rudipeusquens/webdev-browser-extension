import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  clearBlocked,
  clearFailed,
  isBlocked,
  isFailed,
  markBlocked,
  markFailed,
} from '@/lib/background/tab-status'

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

  it('marks and clears a tab whose overlay did not start, apart from blocked tabs', async () => {
    await markFailed(7)
    expect(await isFailed(7)).toBe(true)
    expect(await isBlocked(7)).toBe(false)
    expect(await isFailed(8)).toBe(false)
    expect(await fakeBrowser.storage.local.get()).toEqual({})
    await clearFailed(7)
    expect(await isFailed(7)).toBe(false)
  })
})
