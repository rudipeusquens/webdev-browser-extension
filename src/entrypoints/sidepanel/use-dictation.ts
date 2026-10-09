// Rec (spec section 8): a dictation in the panel without a pin. Stopped, it becomes a Rec note
// that waits for its text in the background. Once the text is there, this panel puts it on the
// clipboard as it is, nothing added, if it handed the note over and is still open. The
// clipboard holds what the developer did last: pins or a note copied while the dictation runs
// or is transcribed keep it, unless the developer stops or retries it afterwards; the text is
// offered for copying by hand instead.

import { computed, type Ref, watch } from 'vue'
import type { Browser } from 'wxt/browser'
import { useVoice } from '@/composables/use-voice'
import type { Note } from '@/lib/notes/model'
import { dictationFailure } from '@/lib/voice/protocol'

export interface DictationHandlers {
  /** Puts the text on the clipboard; false when Chrome refuses. */
  write: (text: string) => boolean
  /** The text is on the clipboard. */
  copied: () => void
  /** The text could not go to the clipboard (`refused`), or a later copy holds it. */
  offer: (text: string, refused: boolean) => void
}

export function useDictation(
  handlers: DictationHandlers,
  notes: Ref<readonly Note[]>,
  connect?: () => Browser.runtime.Port,
) {
  /**
   * Notes this panel handed over and waits for, each with whether something was copied
   * since: then its text is offered instead of copied.
   */
  const waiting = new Map<string, boolean>()
  /** Something was copied while the recording runs, and the developer did nothing since. */
  let outdone = false

  // A stop the developer did not ask for (the limit's question unanswered, another recording
  // starting) keeps what was copied meanwhile on the clipboard.
  const handOver = () => voice.stop({ note: true })
  const voice = useVoice(
    {
      handed: (to) => {
        if ('note' in to) waiting.set(to.note, outdone)
        outdone = false
      },
      yielded: handOver,
      timedOut: handOver,
    },
    connect,
  )

  watch(notes, (list) => {
    for (const [id, offered] of [...waiting]) {
      const note = list.find((n) => n.id === id)
      // Deleted, or failed for good: nothing will come.
      if (!note || (note.job?.state === 'failed' && !note.job.retry)) {
        waiting.delete(id)
        continue
      }
      if (note.job || !note.text) continue
      waiting.delete(id)
      if (offered) handlers.offer(note.text, false)
      else if (handlers.write(note.text)) handlers.copied()
      else handlers.offer(note.text, true)
    }
  })

  return {
    state: voice.state,
    clock: voice.clock,
    busy: voice.busy,
    paused: voice.paused,
    failure: computed(() => dictationFailure(voice.state.value)),
    /**
     * Starts a dictation, or stops the recording (also one that ended by itself, for Retry):
     * either is the developer's latest step. While the microphone starts, Rec only looks
     * disabled and this does nothing.
     */
    toggle() {
      if (voice.recording.value) {
        outdone = false
        voice.stop({ note: true })
      } else if (!voice.busy.value) {
        outdone = false
        voice.start()
      }
    },
    resume: voice.resume,
    cancel: voice.cancel,
    /** Retry on a note in this panel: the developer's latest step, its text takes the clipboard. */
    retried(id: string) {
      waiting.set(id, false)
    },
    /**
     * Something else is being copied (pins, a note): call it before it is written, and settle
     * it with whether it reached the clipboard. What Rec records or transcribes meanwhile then
     * leaves the clipboard to it.
     */
    copyingOther(): (written: boolean) => void {
      const before = { outdone, waiting: new Map(waiting) }
      if (voice.busy.value) outdone = true
      for (const id of waiting.keys()) waiting.set(id, true)
      return (written) => {
        if (written) return
        outdone = before.outdone
        for (const [id, offered] of before.waiting) if (waiting.has(id)) waiting.set(id, offered)
      }
    },
  }
}
