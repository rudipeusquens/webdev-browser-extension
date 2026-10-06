// The offscreen document of one dictation (spec section 5): the background creates it, it
// connects back, records and transcribes on the background's commands, and is closed when the
// dictation ends. Its port closing means the dictation is over.

import { browser } from 'wxt/browser'
import { transcribe } from '@/lib/voice/openrouter'
import { isRecorderCommand, RECORDER_PORT, type RecorderMessage } from '@/lib/voice/protocol'
import { createMediaRecorder, createRecorder } from '@/lib/voice/recorder'

/** Port messages keep the background's service worker alive (Chrome 114+). */
const HEARTBEAT = 10_000

const port = browser.runtime.connect({ name: RECORDER_PORT })
const post = (message: RecorderMessage) => {
  try {
    port.postMessage(message)
  } catch {
    // The port is gone; its disconnect ends everything.
  }
}

const recorder = createRecorder({
  permission: () =>
    navigator.permissions.query({ name: 'microphone' as PermissionName }).then((s) => s.state),
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  record: createMediaRecorder,
  transcribe: (audio, request, signal) => transcribe(audio, request, { signal }),
  emit: post,
})

port.onMessage.addListener((message: unknown) => {
  if (isRecorderCommand(message)) recorder.command(message)
})
const heartbeat = setInterval(() => post({ state: 'alive' }), HEARTBEAT)
port.onDisconnect.addListener(() => {
  clearInterval(heartbeat)
  recorder.stop()
})
