// Rec (spec section 8): a dictation in the panel without a pin. Its text goes to the clipboard
// as it is, nothing added, while the pins stay as they are. The clipboard holds what the
// developer did last: pins copied while the dictation runs keep it, unless the developer stops
// or retries it afterwards; the text is offered for copying by hand instead.

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
  /** Pins reached the clipboard while this dictation ran, and the developer did nothing since. */
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
    /**
     * Starts a dictation, or stops the recording: either is the developer's latest step. While
     * the microphone starts or the text is transcribed, Rec only looks disabled and this does
     * nothing.
     */
    toggle() {
      const now = voice.state.value.state
      if (now !== 'starting' && now !== 'transcribing') outdone = false
      voice.toggle()
    },
    retry() {
      const now = voice.state.value
      if (now.state === 'failed' && now.retry) outdone = false
      voice.retry()
    },
    cancel: voice.cancel,
    /**
     * Pins are being copied: call it before they are written, and settle it with whether they
     * reached the clipboard. While the dictation runs, its text then leaves the clipboard to
     * them, also when the two-minute limit stops it.
     */
    copyingPins(): (written: boolean) => void {
      const before = outdone
      const running = voice.busy.value
      if (running) outdone = true
      return (written) => {
        if (running && !written) outdone = before
      }
    },
  }
}
