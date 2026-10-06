// Client-side navigation without a router dependency: links push a new URL and the app
// renders the page for it, as vue-router would.
import { readonly, ref } from 'vue'

const path = ref(location.pathname)
addEventListener('popstate', () => (path.value = location.pathname))

export const route = readonly(path)

export function go(to: string) {
  history.pushState(null, '', to)
  path.value = to
}
