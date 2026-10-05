import type { ElementSnapshot, PageInfo } from '@/lib/collection/model'
import type { NewAnnotation } from '@/lib/collection/ops'

export function snapshot(overrides: Partial<ElementSnapshot> = {}): ElementSnapshot {
  return {
    selector: 'div.actions > button',
    openingTag: '<button type="submit">',
    text: 'Save changes',
    box: { x: 10, y: 20, width: 160, height: 48 },
    styles: { display: 'inline-flex' },
    ...overrides,
  }
}

export function page(url: string, overrides: Partial<PageInfo> = {}): PageInfo {
  return {
    url,
    title: 'Example',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    ...overrides,
  }
}

export function elementInput(
  id: string,
  url: string,
  comment = 'Make this wider.',
  element: ElementSnapshot = snapshot(),
): NewAnnotation {
  return { id, page: page(url), target: { kind: 'element', element }, comment }
}
