// Counters that change whenever positions on the page may have changed. `frame` changes on
// scrolling, resizing and DOM changes, so outlines, the popover and pins follow; `layout`
// only on resizing and DOM changes, which can replace elements, so placements are looked up
// again then and not on every scroll. At most one change per animation frame.

import { onBeforeUnmount, onMounted, type Ref, ref } from 'vue'

export function useTracking(): { frame: Ref<number>; layout: Ref<number> } {
  const frame = ref(0)
  const layout = ref(0)
  let pending = 0
  let changed = false
  const bump = () => {
    if (pending) return
    pending = requestAnimationFrame(() => {
      pending = 0
      if (changed) {
        changed = false
        layout.value++
      }
      frame.value++
    })
  }
  const relayout = () => {
    changed = true
    bump()
  }
  const resizes = new ResizeObserver(relayout)
  // Changes inside the overlay's own shadow root are not observed, so this cannot loop.
  const mutations = new MutationObserver(relayout)
  const listeners = new AbortController()
  onMounted(() => {
    const { signal } = listeners
    // Capture phase: scrolling inside any container counts, not only the document.
    window.addEventListener('scroll', bump, { capture: true, passive: true, signal })
    window.addEventListener('resize', relayout, { passive: true, signal })
    resizes.observe(document.documentElement)
    mutations.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
  })
  onBeforeUnmount(() => {
    listeners.abort()
    resizes.disconnect()
    mutations.disconnect()
    cancelAnimationFrame(pending)
  })
  return { frame, layout }
}
