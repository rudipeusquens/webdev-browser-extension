// Code origins for a new item's snapshots: Vue's components from the page's own world, asked
// through the background by selector, else the Astro source attributes on the elements.

import { browser } from 'wxt/browser'
import { combineOrigin, withInspectorLine } from '@/lib/capture/origin'
import { astroOrigin, inspectorOf } from '@/lib/capture/source-attributes'
import type { CodeOrigin, ElementSnapshot, Target } from '@/lib/collection/model'
import type { OriginReply } from '@/lib/messages'

export type Origins = (CodeOrigin | undefined)[]

/** The elements a target's snapshots were taken from, in snapshot order. */
export interface Sources {
  elements: Element[]
  selectors: string[]
}

export function sourcesOf(target: Target, elements: Element[]): Sources {
  switch (target.kind) {
    case 'element':
      return { elements, selectors: [target.element.selector] }
    case 'text':
      return { elements, selectors: [target.container.selector] }
    case 'area':
      return {
        elements,
        selectors: [target.container, ...target.elements].map((s) => s.selector),
      }
  }
}

/** The origin of each element, in the order given; undefined where none is known. */
export async function readOrigins({ elements, selectors }: Sources): Promise<Origins> {
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
    return combineOrigin(
      found ? withInspectorLine(found, inspectorOf(el)) : undefined,
      astroOrigin(el),
    )
  })
}

const withOrigin = (snapshot: ElementSnapshot, origin: CodeOrigin | undefined) =>
  origin ? { ...snapshot, origin } : snapshot

/** The target with each snapshot's origin, in the order of `sourcesOf`. */
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

/** `promise`'s value, or undefined when it takes longer than `ms`. */
export function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((done) => {
    timer = setTimeout(() => done(undefined), Math.max(0, ms))
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}
