// A counter that changes whenever positions on the page may have changed. Computed rects read
// it, so outlines, the popover and pins follow scrolling, resizing and layout shifts.

import { onBeforeUnmount, onMounted, type Ref, ref } from 'vue'

export function useTracking(): Ref<number> {
  const frame = ref(0)
  let pending = 0
  const bump = () => {
    if (pending) return
    pending = requestAnimationFrame(() => {
      pending = 0
      frame.value++
    })
  }
  const resizes = new ResizeObserver(bump)
  onMounted(() => {
    // Capture phase: scrolling inside any container counts, not only the document.
    window.addEventListener('scroll', bump, { capture: true, passive: true })
    window.addEventListener('resize', bump, { passive: true })
    resizes.observe(document.documentElement)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('scroll', bump, { capture: true })
    window.removeEventListener('resize', bump)
    resizes.disconnect()
    cancelAnimationFrame(pending)
  })
  return frame
}
