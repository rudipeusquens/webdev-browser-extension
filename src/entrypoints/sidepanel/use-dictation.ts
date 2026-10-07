// Rec (spec section 8): a dictation in the panel without a pin. Its text goes to the clipboard
// as it is, nothing added, while the pins stay as they are. The clipboard holds what the
// developer did last: a copy of pins clicked while the text was transcribed keeps it, and the
// text is offered for copying by hand instead.

import { computed } from 'vue'
import type { Browser } from 'wxt/browser'
import { useVoice } from '@/composables/use-voice'
import { dictationFailure } from '@/lib/voice/protocol'

export interface DictationHandlers {
  /** Puts the text on the clipboard; false when Chrome refuses. */
  write: (text: string) => boolean
  /** The text is on the clipboard. */
  copied: (atLimit: boolean) => void
  /** The text could not go to the clipboard (`refused`), or a later copy holds it. */
  offer: (text: string, refused: boolean) => void
}

export function useDictation(handlers: DictationHandlers, connect?: () => Browser.runtime.Port) {
  const voice = useVoice(connect)
  /** A copy of pins was clicked after the recording stopped. */
  let outdone = false

  voice.onText((text, atLimit) => {
    if (outdone) handlers.offer(text, false)
    else if (handlers.write(text)) handlers.copied(atLimit)
    else handlers.offer(text, true)
    outdone = false
  })

  return {
    state: voice.state,
    clock: voice.clock,
    busy: voice.busy,
    failure: computed(() => dictationFailure(voice.state.value)),
    /** Starts a dictation, or stops the recording: either is the developer's latest step. */
    toggle() {
      outdone = false
      voice.toggle()
    },
    retry() {
      outdone = false
      voice.retry()
    },
    cancel: voice.cancel,
    /** A copy of pins: a text still being transcribed leaves the clipboard to it. */
    outdo() {
      if (voice.state.value.state === 'transcribing') outdone = true
    },
  }
}
