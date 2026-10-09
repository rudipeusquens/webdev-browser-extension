import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { useStored } from '@/entrypoints/sidepanel/use-stored'

const parse = (value: unknown) => (typeof value === 'string' ? value : '')

function setup(key: string | null) {
  const current = ref<string | null>(key)
  let stored!: ReturnType<typeof useStored<string>>
  const host = mount(
    defineComponent({
      setup() {
        stored = useStored(current, parse)
        return () => null
      },
    }),
  )
  return { stored, current, host }
}

describe('useStored', () => {
  it('reads its key, says when it has, and follows changes', async () => {
    fakeBrowser.reset()
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
    fakeBrowser.reset()
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
