// The offscreen document of the dictations (spec section 5): the background creates it, it
// connects back, records and transcribes on the background's commands, and is closed once no
// recording runs and no job is transcribed or holds audio for Retry. Its port closing ends
// everything in it.

import { browser } from 'wxt/browser'
import { transcribe } from '@/lib/voice/openrouter'
import { isRecorderCommand, RECORDER_PORT, type RecorderMessage } from '@/lib/voice/protocol'
import { createMediaRecorder, createRecorder, type LevelMonitor } from '@/lib/voice/recorder'

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

/** The microphone's level (RMS of the last moment): pauses are where long recordings are cut. */
function monitorLevel(stream: MediaStream): LevelMonitor {
  const context = new AudioContext()
  void context.resume().catch(() => undefined)
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  return {
    level() {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) sum += sample * sample
      return Math.sqrt(sum / samples.length)
    },
    stop() {
      source.disconnect()
      void context.close().catch(() => undefined)
    },
  }
}

const recorder = createRecorder({
  monitor: monitorLevel,
  permission: () =>
    navigator.permissions.query({ name: 'microphone' as PermissionName }).then((s) => s.state),
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  record: createMediaRecorder,
  transcribe: (audio, request, signal, timeout) => transcribe(audio, request, { signal, timeout }),
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
