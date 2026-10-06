// Snapshots of elements and pages: plain data, capped, without form values (spec section 6).

import type { ElementSnapshot, PageInfo } from '../collection/model'
import { LIMITS } from '../collection/model'
import { pageKey } from '../collection/page-key'
import { clean, collapse, truncate } from '../text'
import { attributesOf, ownerDocumentOf, rectOf, tagOf } from './dom'
import { shownText } from './reader'
import { buildSelector } from './selector'
import { pickStyles } from './styles'

const FORM_FIELDS = new Set(['input', 'textarea', 'select'])
// Their attributes are the values a select offers (`value`, `label`, `selected`).
const OPTIONS = new Set(['option', 'optgroup', 'datalist'])
const isFormField = (el: Element) => FORM_FIELDS.has(tagOf(el))

function recordedAttributes(el: Element): Attr[] {
  if (OPTIONS.has(tagOf(el))) return []
  const all = attributesOf(el)
  return isFormField(el) ? all.filter((a) => a.name === 'type' || a.name === 'name') : all
}

export function openingTag(el: Element): string {
  const attributes = recordedAttributes(el)
  const parts = attributes.map(({ name, value }) =>
    value === ''
      ? name
      : `${name}="${truncate(collapse(value), LIMITS.attribute).replace(/"/g, '&quot;')}"`,
  )
  // The closing bracket survives truncation, so the tag still reads as a tag.
  return `<${truncate([tagOf(el), ...parts].join(' '), LIMITS.tag - 2)}>`
}

/** Text the element shows, never the value or options of a form field. */
export function visibleText(el: Element): string {
  const view = ownerDocumentOf(el).defaultView
  return isFormField(el) || !view ? '' : shownText(el, view, LIMITS.text)
}

export function snapshotElement(el: Element): ElementSnapshot {
  const view = ownerDocumentOf(el).defaultView
  const rect = rectOf(el)
  return {
    selector: truncate(buildSelector(el), LIMITS.selector),
    openingTag: openingTag(el),
    text: visibleText(el),
    box: {
      x: Math.round(rect.x + (view?.scrollX ?? 0)),
      y: Math.round(rect.y + (view?.scrollY ?? 0)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    styles: view ? pickStyles(view.getComputedStyle(el)) : {},
  }
}

export function pageInfo(win: Window): PageInfo {
  return {
    url: pageKey(win.location.href),
    title: clean(win.document.title, LIMITS.title),
    viewport: { width: win.innerWidth, height: win.innerHeight },
    colorScheme: win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  }
}
