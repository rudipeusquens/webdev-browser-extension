import { vi } from 'vitest'

/**
 * Makes `checkVisibility()` answer like Chrome: false for `display: contents` elements,
 * although their children render. happy-dom answers true.
 */
export function chromeLikeVisibility() {
  const original = Element.prototype.checkVisibility
  return vi.spyOn(Element.prototype, 'checkVisibility').mockImplementation(function (
    this: Element,
    options?: CheckVisibilityOptions,
  ) {
    if (getComputedStyle(this).display === 'contents') return false
    return original.call(this, options)
  })
}
