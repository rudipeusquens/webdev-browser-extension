// The overlay's stylesheet, made for its closed shadow root. `all: initial` on the host resets
// what the page sets there, except custom properties and `direction`: those still inherit into
// the shadow tree. A page could make the overlay transparent or swap its buttons and still
// pass the visibility check (use-unobscured.ts), so everything the overlay reads is declared
// again inside, where no page style reaches.

/** The element WXT puts the app in: the only element child of the shadow root. */
const CONTAINER = ':host > div'

/**
 * Tailwind's registered variables (`@property`, moved into the page's <head> by WXT, where the
 * page can remove them) on every element of the overlay, as if they were registered.
 */
function registeredDefaults(css: string): string {
  const declarations = [...css.matchAll(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g)].map(
    ([, name, body = '']) => {
      const value = /initial-value:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? 'initial'
      // A registered length computes `0` to `0px`; unregistered, `calc(3px + 0)` is invalid.
      const length = /syntax:\s*"<length>"/.test(body)
      return `${name}:${length && value === '0' ? '0px' : value}`
    },
  )
  return declarations.length
    ? `@layer properties{*,::before,::after,::backdrop{${declarations.join(';')}}}`
    : ''
}

export function overlayCss(styles: string): string {
  // Ours get a name no page uses: registrations in the <head> also apply to the page, and
  // `inherits: false` would break inheritance of the page's own --tw-* variables.
  const css = styles.replaceAll('--tw-', '--webdev-tw-').replaceAll(':root', CONTAINER)
  return `${css}${registeredDefaults(css)}${CONTAINER}{direction:ltr}`
}
