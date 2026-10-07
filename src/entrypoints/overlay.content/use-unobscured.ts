// Whether an element of the overlay is seen as it is drawn: nothing the page shows lies over
// it and no effect changes it (Intersection Observer v2). Its buttons act only then: a page
// could otherwise lay a cover over them that lets clicks through, so the developer would
// click something they cannot see (clickjacking). It must have been seen for a moment, too: a
// page could take its cover away just as the pointer is pressed.

import { onScopeDispose, type Ref, ref, watch } from 'vue'

/** Chrome reports visibility from version 74 on; elsewhere nothing is held back. */
const TRACKS_VISIBILITY =
  typeof IntersectionObserverEntry !== 'undefined' &&
  'isVisible' in IntersectionObserverEntry.prototype

/** The shortest delay between visibility checks the browser accepts. */
const DELAY = 100
/** How long the element must have been seen before a click on it counts. */
export const SEEN_FOR = 500

/**
 * True once `target` has been seen for `SEEN_FOR`; `onCovered` is called whenever the
 * browser reports something over it.
 */
export function useUnobscured(
  target: Ref<Element | null>,
  onCovered: () => void = () => undefined,
): Ref<boolean> {
  // Unknown until the first report: held back, as a cover might be there from the start.
  const unobscured = ref(!TRACKS_VISIBILITY)
  let observer: IntersectionObserver | undefined
  let seen: ReturnType<typeof setTimeout> | undefined

  function update(visible: boolean) {
    if (visible) {
      // Reports come only when something changed: one that says seen starts the wait.
      if (!unobscured.value && seen === undefined) {
        seen = setTimeout(() => (unobscured.value = true), SEEN_FOR)
      }
      return
    }
    clearTimeout(seen)
    seen = undefined
    unobscured.value = false
    onCovered()
  }

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
          if (entry) update(entry.isIntersecting && entry.isVisible === true)
        },
        { trackVisibility: true, delay: DELAY } as IntersectionObserverInit,
      )
      observer.observe(el)
    },
    { immediate: true, flush: 'post' },
  )
  onScopeDispose(() => {
    observer?.disconnect()
    clearTimeout(seen)
  })
  return unobscured
}
