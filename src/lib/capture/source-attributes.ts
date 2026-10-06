// Source locations a dev server writes into the page as attributes: readable from the content
// script's world, unlike Vue's component data (origin-bridge.ts).

import type { CodeOrigin } from '../collection/model'
import { attributeOf, closestOf } from './dom'
import { astroSource, type InspectorLine, inspectorLine } from './origin'

/** The Astro source of the element: the nearest `data-astro-source-file`, with its line. */
export function astroOrigin(el: Element): CodeOrigin | undefined {
  const source = closestOf(el, '[data-astro-source-file]')
  return source
    ? astroSource(
        attributeOf(source, 'data-astro-source-file'),
        attributeOf(source, 'data-astro-source-loc'),
      )
    : undefined
}

/** The template location on the nearest element with `data-v-inspector`. */
export function inspectorOf(el: Element): InspectorLine | undefined {
  const marked = closestOf(el, '[data-v-inspector]')
  return marked ? inspectorLine(attributeOf(marked, 'data-v-inspector')) : undefined
}
