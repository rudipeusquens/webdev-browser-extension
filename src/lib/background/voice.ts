// Dictation, coordinated (spec sections 5 and 9). Each comment popover that dictates holds a
// port named `voice`; the background opens an offscreen recorder for it, gives the recorder
// the key, model and language over the recorder's own port, and relays the recorder's states
// to the popover. One recorder at a time: a start from another popover ends the running one.
// A popover port that closes (popover closed, page gone, overlay replaced) ends its dictation.

import { browser, type Browser } from 'wxt/browser'
import { loadKey } from '../voice/key'
import type { TranscribeRequest } from '../voice/openrouter'
import {
  isRecorderMessage,
  isVoiceCommand,
  RECORDER_PORT,
  type RecorderCommand,
  VOICE_PORT,
  type VoiceState,
} from '../voice/protocol'
import { loadVoiceSettings } from '../voice/settings'

type Port = Browser.runtime.Port

const DOCUMENT = 'offscreen.html'
/** How long a new recorder document may take to connect. */
const CONNECT_TIMEOUT = 5_000

interface Session {
  overlay: Port
  recorder?: Port
  /** Changes when a start is overtaken (cancel, popover gone, another start). */
  run: number
}

const post = (port: Port | undefined, message: VoiceState | RecorderCommand) => {
  try {
    port?.postMessage(message)
  } catch {
    // That side is gone; its disconnect cleans up.
  }
}

async function readRequest(): Promise<TranscribeRequest | undefined> {
  const key = await loadKey()
  if (!key) return undefined
  const { model, language } = await loadVoiceSettings()
  return { key, model, language }
}

export function createVoice() {
  /** The session that owns the recorder document. */
  let current: Session | undefined
  /** Takes the port of the recorder document that was opened last; nothing ends the wait. */
  let waiting: ((port?: Port) => void) | undefined
  /** Document changes one at a time: Chrome allows a single offscreen document. */
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = (task: () => Promise<void>) => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  const hasDocument = async () =>
    (await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as never] })).length >
    0
  const closeDocument = () =>
    inOrder(async () => {
      if (await hasDocument()) await browser.offscreen.closeDocument()
    }).catch(() => undefined)

  /** A fresh recorder document and its port, or nothing when it does not connect in time. */
  async function openRecorder(): Promise<Port | undefined> {
    let accept: (port?: Port) => void = () => undefined
    const connected = new Promise<Port | undefined>((resolve) => {
      accept = (port) => {
        clearTimeout(timer)
        if (waiting === accept) waiting = undefined
        resolve(port)
      }
      const timer = setTimeout(accept, CONNECT_TIMEOUT)
    })
    // The wait starts before the document exists: its script connects before
    // createDocument() resolves. An earlier wait is over: its document is replaced.
    const earlier = waiting
    waiting = accept
    earlier?.()
    try {
      await inOrder(async () => {
        if (await hasDocument()) await browser.offscreen.closeDocument()
        await browser.offscreen.createDocument({
          url: DOCUMENT,
          reasons: ['USER_MEDIA' as never],
          justification: 'Records the microphone while the developer dictates a comment.',
        })
      })
    } catch {
      accept()
    }
    return connected
  }

  /** The recorder of `s` goes, with its document; `s` keeps its popover. */
  function dropRecorder(s: Session) {
    const recorder = s.recorder
    s.recorder = undefined
    if (current === s) current = undefined
    try {
      recorder?.disconnect()
    } catch {
      // Gone already.
    }
    void closeDocument()
  }

  function listen(s: Session, recorder: Port) {
    recorder.onMessage.addListener((message: unknown) => {
      if (s.recorder !== recorder || !isRecorderMessage(message) || message.state === 'alive') {
        return
      }
      post(s.overlay, message)
      // Nothing left to keep: the document goes. A failure that can be retried keeps the audio.
      const holds = message.state !== 'done' && message.state !== 'idle'
      if (!holds || (message.state === 'failed' && !message.retry)) dropRecorder(s)
    })
    recorder.onDisconnect.addListener(() => {
      if (s.recorder !== recorder) return
      dropRecorder(s)
      post(s.overlay, { state: 'failed', error: 'interrupted', retry: false })
    })
  }

  async function start(s: Session) {
    if (current && current !== s) {
      const other = current
      other.run++
      dropRecorder(other)
      post(other.overlay, { state: 'failed', error: 'taken', retry: false })
    }
    if (s.recorder) dropRecorder(s)
    const run = ++s.run
    current = s
    const request = await readRequest()
    if (s.run !== run) return
    if (!request) {
      current = undefined
      post(s.overlay, { state: 'failed', error: 'no-key', retry: false })
      return
    }
    const recorder = await openRecorder().catch(() => undefined)
    if (s.run !== run) {
      recorder?.disconnect()
      if (current === undefined) void closeDocument()
      return
    }
    if (!recorder) {
      current = undefined
      void closeDocument()
      post(s.overlay, { state: 'failed', error: 'mic-failed', retry: false })
      return
    }
    s.recorder = recorder
    listen(s, recorder)
    post(recorder, { type: 'start', request })
  }

  async function retry(s: Session) {
    if (!s.recorder) return
    const request = await readRequest()
    if (!s.recorder) return
    if (!request) post(s.overlay, { state: 'failed', error: 'no-key', retry: true })
    else post(s.recorder, { type: 'retry', request })
  }

  function cancel(s: Session) {
    if (s.recorder) return post(s.recorder, { type: 'cancel' })
    // A start still on its way.
    s.run++
    if (current === s) {
      current = undefined
      void closeDocument()
    }
    post(s.overlay, { state: 'idle' })
  }

  function connectOverlay(overlay: Port) {
    const { sender } = overlay
    if (sender?.id !== browser.runtime.id || sender.tab?.id === undefined || sender.frameId !== 0) {
      overlay.disconnect()
      return
    }
    const s: Session = { overlay, run: 0 }
    overlay.onMessage.addListener((message: unknown) => {
      if (!isVoiceCommand(message)) return
      if (message.type === 'start') void start(s)
      else if (message.type === 'stop') post(s.recorder, { type: 'stop' })
      else if (message.type === 'retry') void retry(s)
      else cancel(s)
    })
    overlay.onDisconnect.addListener(() => {
      s.run++
      if (s.recorder || current === s) dropRecorder(s)
    })
  }

  function connectRecorder(recorder: Port) {
    const { sender } = recorder
    const ours =
      sender?.id === browser.runtime.id && sender.url === browser.runtime.getURL(`/${DOCUMENT}`)
    if (!ours || !waiting) {
      recorder.disconnect()
      return
    }
    waiting(recorder)
  }

  return {
    onConnect(port: Port) {
      if (port.name === VOICE_PORT) connectOverlay(port)
      else if (port.name === RECORDER_PORT) connectRecorder(port)
    },
  }
}
