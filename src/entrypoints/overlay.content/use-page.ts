// The page the overlay is on, by its key: single-page apps change it without a reload
// (`pushState`, `replaceState`, back and forward), and the Navigation API reports all of them.

import { onBeforeUnmount, onMounted, type Ref, ref } from 'vue'
import { pageKey } from '@/lib/collection/page-key'

type Navigation = { navigation?: EventTarget }

export function usePage(): { key: Ref<string> } {
  const key = ref(pageKey(location.href))
  const update = () => {
    const next = pageKey(location.href)
    if (next !== key.value) key.value = next
  }
  // The Navigation API exists in every Chrome this extension supports; the fallback is for
  // tests. The page's own scripts cannot change this world's `window`.
  const navigation = (window as Navigation).navigation
  onMounted(() => {
    if (navigation) {
      navigation.addEventListener('currententrychange', update)
    } else {
      window.addEventListener('popstate', update)
      window.addEventListener('hashchange', update)
    }
  })
  onBeforeUnmount(() => {
    navigation?.removeEventListener('currententrychange', update)
    window.removeEventListener('popstate', update)
    window.removeEventListener('hashchange', update)
  })
  return { key }
}
