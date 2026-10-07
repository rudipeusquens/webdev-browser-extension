import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type Ref, ref } from 'vue'

// happy-dom has no Intersection Observer v2: a fake one reports what each test says.
let report: ((visible: boolean) => void) | undefined

class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    report = (visible) =>
      callback(
        [{ isIntersecting: true, isVisible: visible } as unknown as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
  }
  observe() {}
  disconnect() {}
}

async function mountWatcher(onCovered: () => void) {
  // The module checks for visibility support when it loads.
  vi.resetModules()
  const { useUnobscured } = await import('@/entrypoints/overlay.content/use-unobscured')
  let unobscured: Ref<boolean> | undefined
  mount(
    defineComponent({
      setup() {
        const el = ref<HTMLElement | null>(null)
        unobscured = useUnobscured(el, onCovered)
        return () => h('div', { ref: el })
      },
    }),
    { attachTo: document.body },
  )
  await vi.dynamicImportSettled()
  return () => unobscured?.value
}

describe('useUnobscured', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    vi.stubGlobal(
      'IntersectionObserverEntry',
      class {
        get isVisible() {
          return true
        }
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    report = undefined
    document.body.innerHTML = ''
  })

  // A page could take its cover away as the pointer is pressed: the click that follows would
  // land on an overlay the developer did not see.
  it('lets clicks through only once the element was seen for half a second', async () => {
    const unobscured = await mountWatcher(() => undefined)
    expect(unobscured()).toBe(false)
    report?.(true)
    vi.advanceTimersByTime(499)
    expect(unobscured()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(unobscured()).toBe(true)
  })

  it('holds clicks back at once when something covers it, and says so', async () => {
    const covered = vi.fn()
    const unobscured = await mountWatcher(covered)
    report?.(true)
    vi.advanceTimersByTime(500)
    report?.(false)
    expect(unobscured()).toBe(false)
    expect(covered).toHaveBeenCalledTimes(1)
    // Seen again: the wait starts over.
    report?.(true)
    vi.advanceTimersByTime(499)
    expect(unobscured()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(unobscured()).toBe(true)
  })
})
