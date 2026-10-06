import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { useTracking } from '@/entrypoints/overlay.content/use-tracking'

const frames = () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)))

function mountTracking() {
  let tracking: ReturnType<typeof useTracking> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        tracking = useTracking()
        return () => null
      },
    }),
  )
  return { wrapper, frame: () => tracking?.frame.value, layout: () => tracking?.layout.value }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useTracking', () => {
  it('counts scrolling as a new frame but not as a layout change', async () => {
    const { wrapper, frame, layout } = mountTracking()
    const [f, l] = [frame() ?? 0, layout() ?? 0]
    window.dispatchEvent(new Event('scroll'))
    await frames()
    expect(frame()).toBe(f + 1)
    expect(layout()).toBe(l)
    wrapper.unmount()
  })

  it('counts DOM changes and resizes as both, once per frame', async () => {
    const { wrapper, frame, layout } = mountTracking()
    const [f, l] = [frame() ?? 0, layout() ?? 0]
    document.body.append(document.createElement('p'))
    document.body.append(document.createElement('p'))
    window.dispatchEvent(new Event('scroll'))
    await frames()
    expect(frame()).toBe(f + 1)
    expect(layout()).toBe(l + 1)
    window.dispatchEvent(new Event('resize'))
    await frames()
    expect(layout()).toBe(l + 2)
    wrapper.unmount()
  })
})
