// Settings › Sites (spec section 8): every remembered site and every site with feedback.

import { computed, onBeforeUnmount, onMounted, type Ref, shallowRef } from 'vue'
import type { Collection } from '@/lib/collection/model'
import { siteLabel } from '@/lib/collection/site'
import { loadSites, watchSites } from '@/lib/collection/store'

export interface SiteEntry {
  site: string
  /** Open items; 0 when the site has none or is only remembered. */
  open: number
  /** The overlay loads there by itself. */
  remembered: boolean
}

const byLabel = (a: SiteEntry, b: SiteEntry) => {
  const x = siteLabel(a.site).toLowerCase()
  const y = siteLabel(b.site).toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

export function useSites(remembered: Ref<string[]>): { sites: Ref<SiteEntry[]> } {
  const stored = shallowRef<Collection[]>([])
  let latest = 0
  let stop: (() => void) | undefined

  async function read() {
    const run = ++latest
    const sites = await loadSites().catch(() => [])
    // An older read must not overwrite a newer one.
    if (run === latest) stored.value = sites
  }

  onMounted(() => {
    stop = watchSites(() => void read())
    void read()
  })
  onBeforeUnmount(() => stop?.())

  const sites = computed(() => {
    const entries = new Map<string, SiteEntry>()
    for (const c of stored.value) {
      if (c.items.length === 0) continue
      const open = c.items.filter((item) => item.status === 'open').length
      entries.set(c.site, { site: c.site, open, remembered: false })
    }
    for (const site of remembered.value) {
      entries.set(site, { site, open: entries.get(site)?.open ?? 0, remembered: true })
    }
    return [...entries.values()].sort(byLabel)
  })
  return { sites }
}
