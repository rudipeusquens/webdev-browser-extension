// The innermost component of the element the pointer rests on in Element mode, for its label:
// looked up through its code origins (origins.ts) once the pointer has rested for a moment.

import { onBeforeUnmount, type Ref, ref, watch } from 'vue'
import { buildSelector } from '@/lib/capture/selector'
import type { Mode } from '@/lib/messages'
import { readOrigins } from './origins'

/** How long the pointer rests on an element before its component is looked up. */
const HOVER_DWELL = 150

export function useComponentNames(hovered: Ref<Element | null>, mode: Ref<Mode>) {
  // The innermost component of elements looked up while hovering, for the label. A WeakMap is
  // not reactive: `componentsSeen` changes whenever an entry is added.
  const components = new WeakMap<Element, string | null>()
  const componentsSeen = ref(0)
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  let askingComponent = false

  function componentOf(el: Element): string | null | undefined {
    void componentsSeen.value
    return components.get(el)
  }

  /** Looks up the component of the element the pointer rests on; one lookup at a time. */
  async function askComponent(el: Element) {
    if (askingComponent || components.has(el)) return
    askingComponent = true
    try {
      const [origin] = await readOrigins([el], [buildSelector(el)])
      components.set(el, origin?.chain.at(-1)?.name ?? null)
      componentsSeen.value++
    } catch {
      components.set(el, null)
    } finally {
      askingComponent = false
    }
    // The pointer moved on meanwhile.
    const now = hovered.value
    if (now && now !== el && mode.value === 'element') void askComponent(now)
  }

  watch(hovered, (el) => {
    clearTimeout(hoverTimer)
    if (el && mode.value === 'element' && !components.has(el)) {
      hoverTimer = setTimeout(() => void askComponent(el), HOVER_DWELL)
    }
  })

  onBeforeUnmount(() => clearTimeout(hoverTimer))
  return { componentOf }
}
