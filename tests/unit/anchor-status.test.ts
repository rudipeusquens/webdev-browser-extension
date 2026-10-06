import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AnchorReport,
  createAnchorStatus,
  MISSING_AFTER,
} from '@/entrypoints/overlay.content/anchor-status'

const PAGE = 'http://localhost:3000/'

describe('createAnchorStatus', () => {
  let reports: AnchorReport[]
  let status: ReturnType<typeof createAnchorStatus>

  beforeEach(() => {
    vi.useFakeTimers()
    reports = []
    status = createAnchorStatus((report) => reports.push(report))
  })

  afterEach(() => {
    status.stop()
    vi.useRealTimers()
  })

  it('reports found items right away', async () => {
    status.update(PAGE, ['a', 'b'], [])
    await vi.advanceTimersByTimeAsync(300)
    expect(reports).toEqual([{ pageKey: PAGE, found: ['a', 'b'], missing: [] }])
  })

  it('reports a missing item only after it stayed missing', async () => {
    status.update(PAGE, [], ['a'])
    await vi.advanceTimersByTimeAsync(MISSING_AFTER - 100)
    expect(reports).toEqual([])
    await vi.advanceTimersByTimeAsync(200)
    expect(reports).toEqual([{ pageKey: PAGE, found: [], missing: ['a'] }])
  })

  it('reports nothing for an item that comes back in time (HMR)', async () => {
    status.update(PAGE, ['a'], [])
    await vi.advanceTimersByTimeAsync(300)
    reports = []
    status.update(PAGE, [], ['a'])
    await vi.advanceTimersByTimeAsync(800)
    status.update(PAGE, ['a'], [])
    await vi.advanceTimersByTimeAsync(3000)
    expect(reports).toEqual([])
  })

  it('reports each change once, batched', async () => {
    for (let i = 0; i < 50; i++) status.update(PAGE, ['a'], ['b'])
    await vi.advanceTimersByTimeAsync(MISSING_AFTER + 300)
    for (let i = 0; i < 50; i++) status.update(PAGE, ['a'], ['b'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(reports).toEqual([
      { pageKey: PAGE, found: ['a'], missing: [] },
      { pageKey: PAGE, found: [], missing: ['b'] },
    ])
  })

  it('reports an item found again after it was reported missing', async () => {
    status.update(PAGE, [], ['a'])
    await vi.advanceTimersByTimeAsync(MISSING_AFTER + 300)
    status.update(PAGE, ['a'], [])
    await vi.advanceTimersByTimeAsync(300)
    expect(reports.at(-1)).toEqual({ pageKey: PAGE, found: ['a'], missing: [] })
  })

  it('starts over on another page', async () => {
    status.update(PAGE, [], ['a'])
    await vi.advanceTimersByTimeAsync(1000)
    status.update(`${PAGE}next`, ['b'], [])
    await vi.advanceTimersByTimeAsync(MISSING_AFTER + 300)
    expect(reports).toEqual([{ pageKey: `${PAGE}next`, found: ['b'], missing: [] }])
  })
})
