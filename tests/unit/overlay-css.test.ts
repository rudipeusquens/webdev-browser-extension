import { describe, expect, it } from 'vitest'
import { overlayCss } from '@/entrypoints/overlay.content/overlay-css'

// A page can set any custom property on the overlay's host (inline, !important): it inherits
// into the shadow tree unless something inside declares it again.
describe('overlayCss', () => {
  it('declares the theme on the container inside the shadow root, not on the host', () => {
    const css = overlayCss(
      ':root{--popover:white}@media (prefers-color-scheme: dark){:root{--popover:black}}' +
        '@layer theme{:root,:host{--spacing:.25rem}}',
    )
    expect(css).not.toContain(':root')
    expect(css).toContain(':host > div{--popover:white}')
    expect(css).toContain('{:host > div{--popover:black}}')
    expect(css).toContain(':host > div,:host{--spacing:.25rem}')
  })

  it('renames Tailwind variables so registrations in the page head fit no page variable', () => {
    expect(overlayCss('.a{box-shadow:var(--tw-shadow)}')).toContain('var(--webdev-tw-shadow)')
  })

  it('sets every registered variable to its initial value on every element of the overlay', () => {
    const css = overlayCss(
      '@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}' +
        '@property --tw-rotate-x{syntax:"*";inherits:false}',
    )
    expect(css).toContain(
      '@layer properties{*,::before,::after,::backdrop{' +
        '--webdev-tw-shadow:0 0 #0000;--webdev-tw-rotate-x:initial}}',
    )
  })

  // Registered as a length, `0` computes to `0px`; unregistered, `calc(3px + 0)` is invalid.
  it('gives a registered length its unit', () => {
    expect(
      overlayCss(
        '@property --tw-ring-offset-width{syntax:"<length>";inherits:false;initial-value:0}',
      ),
    ).toContain('--webdev-tw-ring-offset-width:0px')
  })

  it('keeps the overlay left to right whatever direction the host inherits', () => {
    expect(overlayCss('')).toContain(':host > div{direction:ltr}')
  })
})
