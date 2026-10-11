// Code origins for a new item's snapshots: Vue's components from the page's own world, asked
// through the background by selector, else the Astro source attributes on the elements.

import { browser } from 'wxt/browser'
import { withInspectorLine } from '@/lib/capture/origin'
import { astroOrigin, inspectorOf } from '@/lib/capture/source-attributes'
import type { CodeOrigin, ElementSnapshot, Target } from '@/lib/collection/model'
import type { OriginReply } from '@/lib/messages'

export type Origins = (CodeOrigin | undefined)[]

/** The selectors of a target's snapshots, in snapshot order. */
export function selectorsOf(target: Target): string[] {
  switch (target.kind) {
    case 'element':
      return [target.element.selector]
    case 'text':
      return [target.container.selector]
    case 'area':
      return [target.container, ...target.elements].map((s) => s.selector)
  }
}

/**
 * The origin of each element, found by its selector in the page's world or by its
 * attributes, in the order given; undefined where none is known.
 */
export async function readOrigins(elements: Element[], selectors: string[]): Promise<Origins> {
  let vue: (CodeOrigin | null)[] = []
  try {
    const reply = (await browser.runtime.sendMessage({ type: 'origin:read', selectors })) as
      OriginReply | undefined
    if (reply?.ok && reply.origins.length === selectors.length) vue = reply.origins
  } catch {
    // The background is gone (extension reloaded): the attributes still count.
  }
  return elements.map((el, i) => {
    const found = vue[i]
    // Vue first: inside an Astro page, a Vue island knows its components best.
    return found ? withInspectorLine(found, inspectorOf(el)) : astroOrigin(el)
  })
}

const withOrigin = (snapshot: ElementSnapshot, origin: CodeOrigin | undefined) =>
  origin ? { ...snapshot, origin } : snapshot

/** The target with each snapshot's origin, in the order of `selectorsOf`. */
export function withOrigins(target: Target, origins: Origins): Target {
  switch (target.kind) {
    case 'element':
      return { ...target, element: withOrigin(target.element, origins[0]) }
    case 'text':
      return { ...target, container: withOrigin(target.container, origins[0]) }
    case 'area':
      return {
        ...target,
        container: withOrigin(target.container, origins[0]),
        elements: target.elements.map((el, i) => withOrigin(el, origins[i + 1])),
      }
  }
}
