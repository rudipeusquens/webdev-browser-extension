// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { serial } from '@/lib/background/serial'

/** A task that waits until `go` is called, so tasks can overlap. */
function gate() {
  let go!: () => void
  const open = new Promise<void>((resolve) => (go = resolve))
  return { open, go }
}

describe('serial', () => {
  it('starts each task once the one before has settled', async () => {
    const inOrder = serial()
    const log: string[] = []
    const first = gate()
    const a = inOrder(async () => {
      log.push('a starts')
      await first.open
      log.push('a ends')
      return 'a'
    })
    const b = inOrder(async () => {
      log.push('b runs')
      return 'b'
    })
    await Promise.resolve()
    expect(log).toEqual(['a starts'])
    first.go()
    expect(await Promise.all([a, b])).toEqual(['a', 'b'])
    expect(log).toEqual(['a starts', 'a ends', 'b runs'])
  })

  it('rejects for a failed task and still runs the next one', async () => {
    const inOrder = serial()
    const failed = inOrder(() => Promise.reject(new Error('refused')))
    const next = inOrder(async () => 'next')
    await expect(failed).rejects.toThrow('refused')
    expect(await next).toBe('next')
  })

  it('keeps one queue per call: a waiting task holds up only its own queue', async () => {
    const held = serial()
    const other = serial()
    const first = gate()
    const waiting = held(() => first.open)
    expect(await other(async () => 'other')).toBe('other')
    first.go()
    await waiting
  })
})
