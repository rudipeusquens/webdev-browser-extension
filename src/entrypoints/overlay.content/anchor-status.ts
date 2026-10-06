// Which items of the current page were found, for the panel's "Not found" mark and the
// prompt's line. Pages re-render all the time (HMR, slow first renders, animations): an item
// counts as missing only after it stayed missing for a while, and reports are batched.

/** How long an item must stay missing before it is reported. */
export const MISSING_AFTER = 1500
/** Reports go out at most this often. */
const REPORT_EVERY = 250

export interface AnchorReport {
  pageKey: string
  found: string[]
  missing: string[]
}

export function createAnchorStatus(send: (report: AnchorReport) => void) {
  let page = ''
  let missingSince = new Map<string, number>()
  let reported = new Map<string, 'found' | 'missing'>()
  let latest: { found: string[]; missing: string[] } = { found: [], missing: [] }
  let timer: ReturnType<typeof setTimeout> | undefined
  let due = 0

  function schedule(ms: number) {
    const at = Date.now() + ms
    if (timer !== undefined && at >= due) return
    clearTimeout(timer)
    due = at
    timer = setTimeout(flush, ms)
  }

  function flush() {
    timer = undefined
    const now = Date.now()
    const longMissing = (id: string) => now - (missingSince.get(id) ?? now) >= MISSING_AFTER
    const found = latest.found.filter((id) => reported.get(id) !== 'found')
    const missing = latest.missing.filter((id) => reported.get(id) !== 'missing' && longMissing(id))
    for (const id of found) reported.set(id, 'found')
    for (const id of missing) reported.set(id, 'missing')
    if (found.length > 0 || missing.length > 0) send({ pageKey: page, found, missing })
    // Items that are not missing long enough yet: look again when they would be.
    const waits = latest.missing
      .filter((id) => reported.get(id) !== 'missing')
      .map((id) => (missingSince.get(id) ?? now) + MISSING_AFTER - now)
    if (waits.length > 0) schedule(Math.max(0, Math.min(...waits)))
  }

  return {
    /** The items of `pageKey` that have a place on the page now, and those that do not. */
    update(pageKey: string, found: string[], missing: string[]) {
      if (pageKey !== page) {
        page = pageKey
        missingSince = new Map()
        reported = new Map()
        clearTimeout(timer)
        timer = undefined
      }
      const now = Date.now()
      for (const id of found) missingSince.delete(id)
      for (const id of missing) if (!missingSince.has(id)) missingSince.set(id, now)
      latest = { found, missing }
      schedule(REPORT_EVERY)
    },
    stop() {
      clearTimeout(timer)
      timer = undefined
    },
  }
}
