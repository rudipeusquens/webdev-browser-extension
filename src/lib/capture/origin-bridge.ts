// The origin bridge: runs in the page's own world (`chrome.scripting.executeScript` with
// `world: 'MAIN'`), where Vue's dev build leaves its component instances on the elements it
// renders; the content script's world cannot see them. Chrome serializes the function with
// `toString()`, so it uses nothing from outside its own body: no imports, no helpers, no
// constants of this module. Everything it reads belongs to the page and may throw or lie;
// the extension validates what it returns (`parseVueOrigin` in origin.ts).

/** What the bridge reports for one element: components outermost first, or null. */
export type RawVueOrigin = { chain: { name?: string; file?: string }[] } | null

export function vueOrigins(selectors: string[]): RawVueOrigin[] {
  // Longest walk up the elements, and longest component chain: pages can nest or loop.
  const maxElements = 64
  const maxComponents = 32
  // Cut early so a page cannot make the reply huge; the extension caps again.
  const maxText = 1000
  const text = (x: unknown) => (typeof x === 'string' ? x.slice(0, maxText) : undefined)
  const query = Document.prototype.querySelector
  const parentGetter = Object.getOwnPropertyDescriptor(Node.prototype, 'parentElement')?.get
  const parentOf = (el: Element): Element | null =>
    parentGetter ? (parentGetter.call(el) as Element | null) : el.parentElement

  return selectors.map((selector): RawVueOrigin => {
    try {
      let el: Element | null = query.call(document, selector)
      let instance: unknown
      for (let depth = 0; el && depth < maxElements && !instance; depth++) {
        instance = (el as unknown as { __vueParentComponent?: unknown }).__vueParentComponent
        if (!instance) el = parentOf(el)
      }
      const chain: { name?: string; file?: string }[] = []
      let current = instance as { type?: unknown; parent?: unknown } | null | undefined
      for (; current && chain.length < maxComponents;) {
        const type = current.type as { __name?: unknown; name?: unknown; __file?: unknown }
        chain.push({
          name: text(type?.__name) ?? text(type?.name),
          file: text(type?.__file),
        })
        current = current.parent as typeof current
      }
      return chain.length > 0 ? { chain: chain.reverse() } : null
    } catch {
      return null
    }
  })
}
