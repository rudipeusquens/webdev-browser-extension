// What became of a pin's dictation while it is not done (spec sections 5 and 8), under
// `dictation:<site>`: transcribing, failed (with Retry while the recorder holds the audio), or
// cut (the pin got what fit, the whole text went into a Rec note). The panel and the overlay
// show it; only the background writes it. It holds no text and no key, so it lies in
// `storage.local`, where the overlay can read it, and not in `storage.session`.

import { hasKeys, isAnnotationId, isObject, isText } from '../collection/validate'
import { VOICE_ERRORS, type VoiceError } from './protocol'

export type JobView =
  | { state: 'transcribing' }
  | { state: 'failed'; error: VoiceError; detail?: string; retry: boolean }
  | { state: 'cut' }

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
      return (
        hasKeys(x, ['state', 'error', 'retry'], ['detail']) &&
        VOICE_ERRORS.includes(x.error as VoiceError) &&
        typeof x.retry === 'boolean' &&
        (x.detail === undefined || isText(x.detail, 200, 1))
      )
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
