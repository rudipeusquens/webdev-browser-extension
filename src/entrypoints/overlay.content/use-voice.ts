// The comment popover's line to the background for dictation (spec section 5): connected on
// the first dictation, closed with the popover, which ends whatever runs there.

import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import { browser, type Browser } from 'wxt/browser'
import { isVoiceState, VOICE_PORT, type VoiceCommand, type VoiceState } from '@/lib/voice/protocol'

type Port = Browser.runtime.Port

const INTERRUPTED: VoiceState = { state: 'failed', error: 'interrupted', retry: false }

export function useVoice(
  connect: () => Port = () => browser.runtime.connect({ name: VOICE_PORT }),
) {
  const state = shallowRef<VoiceState>({ state: 'idle' })
  /** Seconds the running recording has taken. */
  const seconds = ref(0)
  const busy = computed(() => {
    const now = state.value.state
    return now === 'starting' || now === 'recording' || now === 'transcribing'
  })
  const listeners: ((text: string, atLimit: boolean) => void)[] = []
  let port: Port | undefined
  let clock: ReturnType<typeof setInterval> | undefined

  function stopClock() {
    clearInterval(clock)
    clock = undefined
  }

  function startClock() {
    stopClock()
    const started = Date.now()
    seconds.value = 0
    clock = setInterval(() => (seconds.value = Math.floor((Date.now() - started) / 1000)), 250)
  }

  function receive(message: unknown) {
    if (!isVoiceState(message)) return
    if (message.state === 'recording') startClock()
    else stopClock()
    state.value = message
    if (message.state === 'done')
      for (const listener of listeners) listener(message.text, message.atLimit)
  }

  function line(): Port {
    if (port) return port
    const opened = connect()
    opened.onMessage.addListener(receive)
    opened.onDisconnect.addListener(() => {
      if (port !== opened) return
      port = undefined
      stopClock()
      const held = state.value.state === 'failed' && state.value.retry
      if (busy.value || held) state.value = INTERRUPTED
    })
    port = opened
    return opened
  }

  function send(type: VoiceCommand['type']) {
    try {
      line().postMessage({ type } satisfies VoiceCommand)
    } catch {
      port = undefined
      stopClock()
      state.value = INTERRUPTED
    }
  }

  // The line closes with the popover: the background then ends the dictation.
  onScopeDispose(() => {
    stopClock()
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
    seconds,
    busy,
    /** Starts a dictation, or stops the recording that runs. */
    toggle() {
      const now = state.value.state
      if (now === 'recording') return send('stop')
      if (now === 'starting' || now === 'transcribing') return
      seconds.value = 0
      state.value = { state: 'starting' }
      send('start')
    },
    cancel() {
      if (busy.value) send('cancel')
    },
    retry() {
      const now = state.value
      if (now.state !== 'failed' || !now.retry) return
      state.value = { state: 'transcribing' }
      send('retry')
    },
    onText(listener: (text: string, atLimit: boolean) => void) {
      listeners.push(listener)
    },
  }
}
