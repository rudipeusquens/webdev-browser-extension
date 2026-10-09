// The single writer of the pins' dictation states (`dictation:<site>`, src/lib/voice/jobs.ts):
// one change at a time, an empty site's key removed.

import { browser } from 'wxt/browser'
import { loadStored } from '../storage'
import { type JobView, JOBS_PREFIX, jobsKey, parseJobs } from '../voice/jobs'

export type DictationsWriter = ReturnType<typeof createDictations>

export function createDictations() {
  let queue: Promise<unknown> = Promise.resolve()

  function inOrder<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  return {
    /** The state of the pin `id` of `site`; null when its dictation is over. */
    set(site: string, id: string, view: JobView | null): Promise<void> {
      return inOrder(async () => {
        const key = jobsKey(site)
        const jobs = await loadStored(key, parseJobs)
        if (view) jobs[id] = view
        else delete jobs[id]
        if (Object.keys(jobs).length === 0) await browser.storage.local.remove(key)
        else await browser.storage.local.set({ [key]: jobs })
      }).catch(() => undefined)
    },

    /** The state of the pin `id` of `site`, as stored. */
    get(site: string, id: string): Promise<JobView | undefined> {
      return inOrder(async () => (await loadStored(jobsKey(site), parseJobs))[id])
    },

    /**
     * The background started: no recorder runs, so nothing is transcribed and no audio is
     * held any more. A cut stays until it is dismissed.
     */
    interrupt(): Promise<void> {
      return inOrder(async () => {
        const stored = await browser.storage.local.get(null)
        const next: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(stored)) {
          if (!key.startsWith(JOBS_PREFIX)) continue
          const jobs = parseJobs(value)
          let changed = false
          for (const [id, view] of Object.entries(jobs)) {
            if (view.state === 'cut' || (view.state === 'failed' && !view.retry)) continue
            changed = true
            const error = view.state === 'failed' ? view.error : 'lost'
            jobs[id] = { ...view, state: 'failed', error, retry: false } as JobView
          }
          if (changed) next[key] = jobs
        }
        if (Object.keys(next).length > 0) await browser.storage.local.set(next)
      }).catch(() => undefined)
    },
  }
}
