import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { usePage } from '@/entrypoints/overlay.content/use-page'

type WithNavigation = { navigation?: EventTarget }

/** Mounts a component that uses `usePage` and returns its page key ref. */
function mountPage() {
  let key: ReturnType<typeof usePage>['key'] | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        key = usePage().key
        return () => null
      },
    }),
  )
  return { wrapper, key: () => key?.value }
}

beforeEach(() => {
  history.replaceState(null, '', '/start?x=1')
})

afterEach(() => {
  Reflect.deleteProperty(window as WithNavigation, 'navigation')
  vi.restoreAllMocks()
})

describe('usePage with the Navigation API', () => {
  beforeEach(() => {
    ;(window as WithNavigation).navigation = new EventTarget()
  })

  const changed = () =>
    (window as WithNavigation).navigation?.dispatchEvent(new Event('currententrychange'))

  it('follows pushState and drops the hash', async () => {
    const { key } = mountPage()
    expect(key()).toBe(`${location.origin}/start?x=1`)
    history.pushState(null, '', '/next#section')
    changed()
    await nextTick()
    expect(key()).toBe(`${location.origin}/next`)
  })

  it('stays on the same page for a change of the hash only', async () => {
    const { key } = mountPage()
    history.pushState(null, '', '/start?x=1#other')
    changed()
    await nextTick()
    expect(key()).toBe(`${location.origin}/start?x=1`)
  })

  it('stops listening when unmounted', async () => {
    const { wrapper, key } = mountPage()
    wrapper.unmount()
    history.pushState(null, '', '/later')
    changed()
    await nextTick()
    expect(key()).toBe(`${location.origin}/start?x=1`)
  })
})

describe('usePage without the Navigation API', () => {
  it('follows popstate and hashchange', async () => {
    const { key, wrapper } = mountPage()
    history.pushState(null, '', '/back-here')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await nextTick()
    expect(key()).toBe(`${location.origin}/back-here`)
    history.pushState(null, '', '/other?q=2')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await nextTick()
    expect(key()).toBe(`${location.origin}/other?q=2`)
    wrapper.unmount()
    history.pushState(null, '', '/gone')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await nextTick()
    expect(key()).toBe(`${location.origin}/other?q=2`)
  })
})
