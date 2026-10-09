// A line to the background for dictation (spec section 5), for an overlay and for the panel's
// Rec: connected on the first dictation, closed with its owner, which ends a recording that
// was not handed over. A stopped recording is handed over to the background, which
// transcribes it into its pin or Rec note; this line only follows the recording.

import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import { browser, type Browser } from 'wxt/browser'
import {
  type HandedTo,
  isVoiceState,
  type Keep,
  type RecordingState,
  VOICE_PORT,
  type VoiceCommand,
} from '@/lib/voice/protocol'

type Port = Browser.runtime.Port

const INTERRUPTED: RecordingState = { state: 'failed', error: 'interrupted', retry: false }
/** How long a recording paused at the limit waits for an answer before it stops. */
export const ASK_WAIT = 60_000

export interface VoiceHandlers {
  /** The background took the recording: its text goes `to` a pin or a note. */
  handed?(to: HandedTo): void
  /** Another recording wants to start: hand this one over now. */
  yielded?(): void
  /** Nobody answered the limit's question in time. */
  timedOut?(): void
}

export function useVoice(
  handlers: VoiceHandlers = {},
  connect: () => Port = () => browser.runtime.connect({ name: VOICE_PORT }),
) {
  const state = shallowRef<RecordingState>({ state: 'idle' })
  /** Milliseconds recorded, as the clock shows them. */
  const recorded = ref(0)
  /** The recorded time as a clock: `0:12`. */
  const clock = computed(() => {
    const seconds = Math.floor(recorded.value / 1000)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  })
  const busy = computed(() => ['starting', 'recording', 'paused'].includes(state.value.state))
  const paused = computed(() => state.value.state === 'paused')
  /** A recording that ended by itself, kept for a stop (Retry) or a cancel. */
  const holds = computed(() => {
    const now = state.value
    return now.state === 'failed' && now.error === 'mic-lost' && now.retry
  })
  let port: Port | undefined
  let ticker: ReturnType<typeof setInterval> | undefined
  let asking: ReturnType<typeof setTimeout> | undefined

  function stopClock() {
    clearInterval(ticker)
    ticker = undefined
  }

  function runClock(from: number) {
    stopClock()
    const since = Date.now() - from
    recorded.value = from
    ticker = setInterval(() => (recorded.value = Date.now() - since), 250)
  }

  function receive(message: unknown) {
    if (!isVoiceState(message)) return
    clearTimeout(asking)
    if (message.state === 'yield') return handlers.yielded?.()
    if (message.state === 'handed') {
      stopClock()
      state.value = { state: 'idle' }
      return handlers.handed?.(message.to)
    }
    if (message.state === 'recording') runClock(message.elapsed)
    else stopClock()
    if (message.state === 'paused') {
      recorded.value = message.elapsed
      asking = setTimeout(() => handlers.timedOut?.(), ASK_WAIT)
    }
    state.value = message
  }

  function line(): Port {
    if (port) return port
    const opened = connect()
    opened.onMessage.addListener(receive)
    opened.onDisconnect.addListener(() => {
      if (port !== opened) return
      port = undefined
      stopClock()
      clearTimeout(asking)
      if (busy.value || holds.value) state.value = INTERRUPTED
    })
    port = opened
    return opened
  }

  function send(command: VoiceCommand) {
    try {
      line().postMessage(command)
    } catch {
      port = undefined
      stopClock()
      state.value = INTERRUPTED
    }
  }

  // The line closes with its owner: the background then ends a recording not handed over.
  onScopeDispose(() => {
    stopClock()
    clearTimeout(asking)
    const closing = port
    port = undefined
    try {
      closing?.disconnect()
    } catch {
      // Gone already.
    }
  })

  return {
    state,
    clock,
    busy,
    paused,
    holds,
    /** Whether something was recorded that a stop hands over. */
    recording: computed(() => ['recording', 'paused'].includes(state.value.state) || holds.value),
    start() {
      if (busy.value) return
      recorded.value = 0
      state.value = { state: 'starting' }
      send({ type: 'start' })
    },
    /**
     * Hands the recording over: its text goes into `keep`. False when nothing was recorded
     * (the microphone still starts: that is cancelled) or nothing runs.
     */
    stop(keep: Keep): boolean {
      if (state.value.state === 'starting') {
        send({ type: 'cancel' })
        return false
      }
      if (!['recording', 'paused'].includes(state.value.state) && !holds.value) return false
      clearTimeout(asking)
      send({ type: 'stop', keep })
      return true
    },
    resume() {
      if (paused.value) send({ type: 'resume' })
    },
    cancel() {
      if (busy.value || holds.value) send({ type: 'cancel' })
    },
    /** Forgets a failure that is over: nothing runs or is held. */
    clear() {
      if (!busy.value && !holds.value) state.value = { state: 'idle' }
    },
  }
}
