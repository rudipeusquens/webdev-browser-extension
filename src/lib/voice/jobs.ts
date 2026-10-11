// What became of a pin's dictation while it is not done (spec sections 5 and 8), under
// `dictation:<site>`: transcribing, failed (with Retry while the recorder holds the audio), or
// cut (the pin got what fit, the whole text went into a Rec note). The panel and the overlay
// show it; only the background writes it. It holds no text and no key, so it lies in
// `storage.local`, where the overlay can read it, and not in `storage.session`.

import type { Annotation } from '../collection/model'
import { hasKeys, isAnnotationId, isObject } from '../collection/validate'
import { isFailure, type Failed } from './protocol'

export type JobView = { state: 'transcribing' } | Failed | { state: 'cut' }

/** The dictations of one site's pins, by pin id. */
export type SiteJobs = Record<string, JobView>

export const JOBS_PREFIX = 'dictation:'
export const jobsKey = (site: string) => `${JOBS_PREFIX}${site}`
/** More pins than this never dictate at once. */
const MAX_JOBS = 500

export function isJobView(x: unknown): x is JobView {
  if (!isObject(x)) return false
  switch (x.state) {
    case 'transcribing':
    case 'cut':
      return hasKeys(x, ['state'])
    case 'failed':
      return isFailure(x)
    default:
      return false
  }
}

/** What of a stored value can be read: the well-formed entries. */
export function parseJobs(value: unknown): SiteJobs {
  if (!isObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id, view]) => isAnnotationId(id) && isJobView(view))
      .slice(0, MAX_JOBS),
  ) as SiteJobs
}

/**
 * A pin's or note's job once the background started again: no recorder runs, so nothing is
 * transcribed and no audio is held any more. A cut, and a failure without Retry, stay as they
 * are (the same object).
 */
export function interrupted<J extends JobView>(job: J): J {
  if (job.state === 'cut' || (job.state === 'failed' && !job.retry)) return job
  const error = job.state === 'failed' ? job.error : 'lost'
  return { ...job, state: 'failed', error, retry: false } as J
}

/** Copy as prompt takes open pins whose text is complete: no drafts, nothing transcribed. */
export const copyable = (item: Annotation, jobs: SiteJobs | undefined) =>
  item.status === 'open' && !item.draft && jobs?.[item.id]?.state !== 'transcribing'
