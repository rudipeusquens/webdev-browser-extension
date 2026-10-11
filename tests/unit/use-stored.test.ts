import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { keepNewest, useStored } from '@/composables/use-stored'
import { withSetup } from './helpers/with-setup'

const parse = (value: unknown) => (typeof value === 'string' ? value : '')

function setup(key: string | null) {
  const current = ref<string | null>(key)
  const { result: stored, wrapper: host } = withSetup(() => useStored(current, parse))
  return { stored, current, host }
}

describe('keepNewest', () => {
  it('applies what was loaded unless a change, or a value chosen, came first', () => {
    const applied: string[] = []
    const plain = keepNewest((value: string) => applied.push(value))
    plain.loaded('read')
    const changed = keepNewest((value: string) => applied.push(value))
    changed.changed('change')
    changed.loaded('older read')
    changed.changed('later change')
    expect(applied).toEqual(['read', 'change', 'later change'])
  })
})

describe('useStored', () => {
  it('reads its key, says when it has, and follows changes', async () => {
    await fakeBrowser.storage.local.set({ a: 'first' })
    const { stored } = setup('a')
    expect(stored.loaded.value).toBe(false)
    await flushPromises()
    expect(stored.loaded.value).toBe(true)
    expect(stored.value.value).toBe('first')
    await fakeBrowser.storage.local.set({ a: 'second' })
    await flushPromises()
    expect(stored.value.value).toBe('second')
  })

  it('reads again, not loaded meanwhile, when the key changes, and holds nothing without one', async () => {
    await fakeBrowser.storage.local.set({ a: 'A', b: 'B' })
    const { stored, current } = setup('a')
    await flushPromises()
    current.value = 'b'
    await Promise.resolve()
    expect(stored.loaded.value).toBe(false)
    expect(stored.value.value).toBe('')
    await flushPromises()
    expect(stored.value.value).toBe('B')
    current.value = null
    await flushPromises()
    expect(stored.value.value).toBe('')
    expect(stored.loaded.value).toBe(true)
  })
})
