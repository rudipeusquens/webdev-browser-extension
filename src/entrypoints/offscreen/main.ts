// The offscreen document of the dictations (spec section 5): the background creates it, it
// connects back, records and transcribes on the background's commands, and is closed once no
// recording runs and no job is transcribed or holds audio for Retry. Its port closing ends
// everything in it.

import { browser } from 'wxt/browser'
import { archiveAudio } from '@/lib/voice/archive'
import { correctTranscript, transcribe, VoiceFailure } from '@/lib/voice/openrouter'
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

/** The longest stretch an analyser keeps: 0.68 s at 48 kHz. */
const PEAK_WINDOW = 32_768

/**
 * The microphone's level (RMS of the last moment): pauses are where long recordings are cut.
 * And its loudest sample: a second analyser keeps a long stretch, read before that stretch has
 * passed, so nothing between two readings is missed.
 */
function monitorLevel(stream: MediaStream): LevelMonitor {
  const context = new AudioContext()
  void context.resume().catch(() => undefined)
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  const long = context.createAnalyser()
  long.fftSize = PEAK_WINDOW
  source.connect(long)
  const stretch = new Float32Array(long.fftSize)
  let loudest = 0
  const listen = () => {
    long.getFloatTimeDomainData(stretch)
    for (const sample of stretch) {
      const size = Math.abs(sample)
      if (size > loudest) loudest = size
    }
  }
  const every = Math.max(100, Math.floor(((PEAK_WINDOW / context.sampleRate) * 1000 * 3) / 4))
  const listening = setInterval(listen, every)
  return {
    level() {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) sum += sample * sample
      return Math.sqrt(sum / samples.length)
    },
    peak() {
      listen()
      const peak = loudest
      loudest = 0
      return peak
    },
    stop() {
      clearInterval(listening)
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
  correct: (text, request, signal) => {
    if (!request.correct) throw new VoiceFailure('failed')
    return correctTranscript(text, request.key, request.correct, { signal })
  },
  keep: async (id, segments) => {
    // The archive is meant to last: ask the browser not to clear it when space runs low.
    void navigator.storage?.persist?.().catch(() => false)
    await archiveAudio(
      id,
      await Promise.all(segments.map((segment) => segment.audio.arrayBuffer())),
    )
  },
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
