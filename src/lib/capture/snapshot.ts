// Snapshots of elements and pages: plain data, capped, without form values (spec section 6).

import type { ElementSnapshot, PageInfo } from '../collection/model'
import { LIMITS } from '../collection/model'
import { pageKey } from '../collection/page-key'
import { clean, collapse, truncate } from '../text'
import { buildSelector } from './selector'
import { pickStyles } from './styles'

const FORM_FIELDS = new Set(['input', 'textarea', 'select'])
const isFormField = (el: Element) => FORM_FIELDS.has(el.localName)

export function openingTag(el: Element): string {
  const attributes = isFormField(el)
    ? [...el.attributes].filter((a) => a.name === 'type' || a.name === 'name')
    : [...el.attributes]
  const parts = attributes.map(({ name, value }) =>
    value === ''
      ? name
      : `${name}="${truncate(collapse(value), LIMITS.attribute).replace(/"/g, '&quot;')}"`,
  )
  // The closing bracket survives truncation, so the tag still reads as a tag.
  return `<${truncate([el.localName, ...parts].join(' '), LIMITS.tag - 2)}>`
}

/** Rendered text, never the value or options of a form field. */
export function visibleText(el: Element): string {
  if (isFormField(el)) return ''
  const rendered = (el as Partial<HTMLElement>).innerText
  return clean(typeof rendered === 'string' ? rendered : (el.textContent ?? ''), LIMITS.text)
}

export function snapshotElement(el: Element): ElementSnapshot {
  const view = el.ownerDocument.defaultView
  const rect = el.getBoundingClientRect()
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
