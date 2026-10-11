import { afterEach, describe, expect, it, vi } from 'vitest'
import { within } from '@/lib/within'

afterEach(() => {
  vi.useRealTimers()
})

describe('within', () => {
  it('gives the value in time and undefined when it is late', async () => {
    vi.useFakeTimers()
    expect(await within(Promise.resolve(1), 100)).toBe(1)
    const late = within(new Promise(() => undefined), 100)
    await vi.advanceTimersByTimeAsync(100)
    expect(await late).toBeUndefined()
    const past = within(new Promise(() => undefined), -50)
    await vi.advanceTimersByTimeAsync(0)
    expect(await past).toBeUndefined()
  })

  it('gives what it is told to give when the value is late', async () => {
    vi.useFakeTimers()
    const LATE = Symbol('late')
    expect(await within(Promise.resolve(undefined), 100, LATE)).toBeUndefined()
    const late = within(new Promise(() => undefined), 100, LATE)
    await vi.advanceTimersByTimeAsync(100)
    expect(await late).toBe(LATE)
  })

  it('passes a rejection on and clears its timer', async () => {
    vi.useFakeTimers()
    await expect(within(Promise.reject(new Error('gone')), 100)).rejects.toThrow('gone')
    expect(vi.getTimerCount()).toBe(0)
  })
})
