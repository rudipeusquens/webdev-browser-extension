// The pins of the page's items: where each item is placed, its pin, its outline or its
// shaded text, and the highlight the panel asks for. Text items are found again while the
// page changes, and the panel learns which items were found.

import { computed, onBeforeUnmount, type Ref, watch } from 'vue'
import { browser } from 'wxt/browser'
import { queryFirst } from '@/lib/capture/dom'
import { findText } from '@/lib/capture/find-text'
import type { Collection } from '@/lib/collection/model'
import { STATUS_BADGE, type Tone, toneOf } from '@/lib/status'
import { type Filter, shows } from '@/lib/view'
import type { SiteJobs } from '@/lib/voice/jobs'
import { createAnchorStatus } from './anchor-status'
import {
  clippersOf,
  isLiveRange,
  type LiveAnchor,
  outlineBox,
  pinPositions,
  placeItems,
  pruneLive,
  visibleBounds,
} from './pins'
import { createTextMarks, type Marks, pageSurface } from './text-marks'

/** Text items are searched again at most this often while the page changes. */
const REANCHOR_EVERY = 300

/** Outline colors by tone: drawn fully while its pin is hovered. */
const OUTLINE: Record<Tone, { normal: string; strong: string }> = {
  open: { normal: 'border-blue-600/70', strong: 'border-blue-600' },
  done: { normal: 'border-green-700/70', strong: 'border-green-700' },
  deleted: { normal: 'border-red-600/70', strong: 'border-red-600' },
  draft: { normal: 'border-zinc-500/70', strong: 'border-zinc-500' },
}

interface PinsInput {
  collection: Ref<Collection | null>
  page: Ref<string>
  filter: Ref<Filter>
  /** What was marked in this session, by item id: more precise than the stored selector. */
  live: Map<string, LiveAnchor>
  frame: Ref<number>
  layout: Ref<number>
  pinsShown: Ref<boolean>
  hoveredPin: Ref<string | null>
  highlighted: Ref<string | null>
  jobs: Ref<SiteJobs>
  /** The open popover: the item it edits has the popover's own marking. */
  draft: Readonly<Ref<{ edit?: { id: string } } | null>>
}

export function usePins({
  collection,
  page,
  filter,
  live,
  frame,
  layout,
  pinsShown,
  hoveredPin,
  highlighted,
  jobs,
  draft,
}: PinsInput) {
  /** The items of this page that the filter shows: only they are placed and pinned. */
  const pageItems = computed(() =>
    (collection.value?.items ?? []).filter(
      (item) => item.pageKey === page.value && shows(item, filter.value),
    ),
  )
  const placements = computed(() => {
    // Again after DOM changes, not on every scroll: an element may have been replaced.
    void layout.value
    return placeItems(pageItems.value, live, document)
  })
  // The scroll containers and clipping boxes around each target: looked up with the
  // placements, measured on every frame.
  const clippers = computed(() => {
    const found = new Map<string, Element[]>()
    for (const [id, placement] of placements.value) {
      // A selection lies in its element's content: that element's own scrolling clips it.
      found.set(id, clippersOf(placement.el, !!placement.range))
    }
    return found
  })
  /** The page's placed items while pins are shown, with where each can be seen, now. */
  const shown = computed(() => {
    void frame.value
    if (!pinsShown.value) return []
    const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
    return pageItems.value.flatMap((item) => {
      const placement = placements.value.get(item.id)
      if (!placement) return []
      const bounds = visibleBounds(clippers.value.get(item.id) ?? [], viewport)
      return [{ item, rect: placement.rect(), bounds }]
    })
  })
  const pins = computed(() => {
    const items = new Map(pageItems.value.map((item) => [item.id, item]))
    const onPage = shown.value.map(({ item, rect, bounds }) => ({ id: item.id, rect, bounds }))
    return pinPositions(onPage).map(({ id, x, y }) => ({
      id,
      number: items.get(id)?.number,
      tone: STATUS_BADGE[toneOf(items.get(id) ?? { status: 'open' })],
      transcribing: jobs.value[id]?.state === 'transcribing',
      left: `${x}px`,
      top: `${y}px`,
    }))
  })
  // A pin that goes away under the pointer (hidden, scrolled out of its box) gets no mouseleave.
  watch(pins, (current) => {
    if (hoveredPin.value && !current.some((pin) => pin.id === hoveredPin.value)) {
      hoveredPin.value = null
    }
  })

  /**
   * The line around each pinned element or area. Texts are shaded by the browser instead
   * (text-marks.ts). The item being edited has the popover's own marking.
   */
  const outlines = computed(() => {
    const editing = draft.value?.edit?.id
    return shown.value.flatMap(({ item, rect, bounds }) => {
      if (item.id === editing || !bounds || item.target.kind === 'text') return []
      const strong = item.id === hoveredPin.value
      const box = outlineBox(rect, bounds)
      if (!box) return []
      const side = (on: boolean) => (on ? '2px' : '0')
      // Moved by its transform: scrolling does not make the browser draw the line again.
      const style = {
        transform: `translate(${box.x}px, ${box.y}px)`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        borderTopWidth: side(box.sides.top),
        borderRightWidth: side(box.sides.right),
        borderBottomWidth: side(box.sides.bottom),
        borderLeftWidth: side(box.sides.left),
      }
      const tone = OUTLINE[toneOf(item)][strong ? 'strong' : 'normal']
      return [{ id: item.id, strong, tone, dashed: item.target.kind === 'area', style }]
    })
  })

  const highlight = computed(() => {
    void frame.value
    const item = pageItems.value.find((i) => i.id === highlighted.value)
    const placement = item && placements.value.get(item.id)
    const rect = placement?.rect()
    // A target without a box (not rendered) has nothing to outline.
    if (!item || !rect || rect.width === 0 || rect.height === 0) return null
    return { rect, label: `Pin ${item.number}`, status: toneOf(item) }
  })

  // Pinned texts are shaded by the browser: set again when what is pinned, hovered or edited
  // changes (a text found again changes the placements), never while the page scrolls.
  const textMarks = createTextMarks(pageSurface(document))
  watch(
    [placements, pinsShown, hoveredPin, () => draft.value?.edit?.id],
    () => {
      const marks: Marks = {}
      const editing = draft.value?.edit?.id
      if (pinsShown.value) {
        for (const item of pageItems.value) {
          const range = placements.value.get(item.id)?.range
          // A text not found again has its pin at its container, and no shading.
          if (!range || item.id === editing) continue
          const tone = (marks[toneOf(item)] ??= { normal: [], strong: [] })
          ;(item.id === hoveredPin.value ? tone.strong : tone.normal).push(range)
        }
      }
      textMarks.set(marks)
    },
    { immediate: true },
  )

  watch(collection, (current) => pruneLive(live, current?.items ?? []))

  // Text items without a selection from this session are found again by their text: at once
  // when the page's items change (mount, another page), so the pin does not jump from the
  // container to the text; while the page changes, at most every REANCHOR_EVERY ms, so a page
  // that changes all the time does not keep the overlay searching.
  let reanchorTimer: ReturnType<typeof setTimeout> | undefined
  function reanchorTexts() {
    for (const item of pageItems.value) {
      const { target } = item
      if (target.kind !== 'text' || isLiveRange(live.get(item.id))) continue
      const container = queryFirst(document, target.container.selector)
      if (!container) continue
      try {
        const range = findText(container, target)
        if (range) live.set(item.id, range)
      } catch {
        // A page in the middle of re-rendering: the next layout change tries again.
      }
    }
  }
  watch(pageItems, reanchorTexts, { immediate: true })
  watch(layout, () => {
    reanchorTimer ??= setTimeout(() => {
      reanchorTimer = undefined
      reanchorTexts()
    }, REANCHOR_EVERY)
  })

  // Found and missing items of this page, for the panel's mark and the prompt.
  const anchors = createAnchorStatus((report) => {
    browser.runtime.sendMessage({ type: 'anchors:report', ...report }).catch(() => undefined)
  })
  watch(placements, (placed) => {
    const ids = pageItems.value.map((item) => item.id)
    anchors.update(
      page.value,
      ids.filter((id) => placed.has(id)),
      ids.filter((id) => !placed.has(id)),
    )
  })

  onBeforeUnmount(() => {
    textMarks.stop()
    clearTimeout(reanchorTimer)
    anchors.stop()
  })
  return { pageItems, placements, pins, outlines, highlight }
}
