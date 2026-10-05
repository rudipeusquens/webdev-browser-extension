import { describe, expect, it } from 'vitest'
import { placeNear } from '@/entrypoints/overlay.content/place'

const viewport = { width: 1000, height: 800 }
const size = { width: 288, height: 160 }

describe('placeNear', () => {
  it('goes below the target, aligned with its left edge', () => {
    expect(placeNear({ x: 100, y: 100, width: 200, height: 40 }, size, viewport)).toEqual({
      x: 100,
      y: 148,
    })
  })

  it('goes above when there is no room below', () => {
    expect(placeNear({ x: 100, y: 700, width: 200, height: 40 }, size, viewport)).toEqual({
      x: 100,
      y: 532,
    })
  })

  it('stays inside the right and left edges', () => {
    expect(placeNear({ x: 900, y: 100, width: 80, height: 40 }, size, viewport).x).toBe(704)
    expect(placeNear({ x: -50, y: 100, width: 80, height: 40 }, size, viewport).x).toBe(8)
  })

  it('stays inside the viewport for a target taller than the viewport', () => {
    const { y } = placeNear({ x: 0, y: -400, width: 1000, height: 2000 }, size, viewport)
    expect(y).toBeGreaterThanOrEqual(8)
    expect(y + size.height).toBeLessThanOrEqual(viewport.height - 8)
  })

  it('keeps the margin when the popover is wider than the viewport', () => {
    expect(
      placeNear({ x: 50, y: 0, width: 10, height: 10 }, size, { width: 200, height: 800 }).x,
    ).toBe(8)
  })
})
