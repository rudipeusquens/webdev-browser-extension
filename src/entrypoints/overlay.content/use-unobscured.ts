// Whether an element of the overlay is seen as it is drawn: nothing the page shows lies over
// it and no effect changes it (Intersection Observer v2). Its buttons act only then: a page
// could otherwise lay a cover over them that lets clicks through, so the developer would
// click something they cannot see (clickjacking).

import { onScopeDispose, type Ref, ref, watch } from 'vue'

/** Chrome reports visibility from version 74 on; elsewhere nothing is held back. */
const TRACKS_VISIBILITY =
  typeof IntersectionObserverEntry !== 'undefined' &&
  'isVisible' in IntersectionObserverEntry.prototype

/** The shortest delay between visibility checks the browser accepts. */
const DELAY = 100

export function useUnobscured(target: Ref<Element | null>): Ref<boolean> {
  // Unknown until the first report: held back, as a cover might be there from the start.
  const unobscured = ref(!TRACKS_VISIBILITY)
  let observer: IntersectionObserver | undefined

  watch(
    target,
    (el) => {
      observer?.disconnect()
      observer = undefined
      if (!el || !TRACKS_VISIBILITY) return
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries.at(-1) as
            (IntersectionObserverEntry & { isVisible?: boolean }) | undefined
          if (entry) unobscured.value = entry.isIntersecting && entry.isVisible === true
        },
        { trackVisibility: true, delay: DELAY } as IntersectionObserverInit,
      )
      observer.observe(el)
    },
    { immediate: true, flush: 'post' },
  )
  onScopeDispose(() => observer?.disconnect())
  return unobscured
}
