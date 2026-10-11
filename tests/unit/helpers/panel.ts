import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from '@/entrypoints/sidepanel/App.vue'

let wrapper: VueWrapper | undefined

/** The element with `data-testid="id"`; throws when there is none. */
export const byTestId = (id: string, root: ParentNode = document) => {
  const el = root.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`no ${id}`)
  return el
}

/** All the text on the page. */
export const body = () => document.body.textContent ?? ''

/** Opens the side panel in the document and lets its first loads settle. */
export async function mountPanel() {
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
}

/** Closes the panel (its document goes on). */
export function closePanel() {
  wrapper?.unmount()
  wrapper = undefined
}

/** For `afterEach`: closes the panel and empties the document. */
export function teardownPanel() {
  closePanel()
  document.body.innerHTML = ''
}

/** Clicks the element with `data-testid="id"` and lets the panel settle. */
export async function click(id: string) {
  byTestId(id).click()
  await flushPromises()
}
