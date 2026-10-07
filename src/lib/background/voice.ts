// Dictation, coordinated (spec sections 5 and 9). Each comment popover that dictates, and the
// panel's Rec, holds a port named `voice`; the background opens an offscreen recorder for it,
// gives the recorder the key, model and language over the recorder's own port, and relays the
// recorder's states back. One recorder at a time: a start from another popover or the panel
// ends the running one. A port that closes (popover closed, page gone, overlay replaced, panel
// closed) ends its dictation.

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
import { isPanelSender } from './senders'

type Port = Browser.runtime.Port

const DOCUMENT = 'offscreen.html'
/** How long a new recorder document may take to connect. */
const CONNECT_TIMEOUT = 5_000

interface Session {
  /** The popover's or the panel's port. */
  client: Port
  recorder?: Port
  /** Changes when a start is overtaken (cancel, popover gone, another start). */
  run: number
}

/** Whether `message` went out; false when that side is gone. */
const post = (port: Port | undefined, message: VoiceState | RecorderCommand): boolean => {
  try {
    port?.postMessage(message)
    return port !== undefined
  } catch {
    return false
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
  /**
   * The recorder document that was opened last and has not connected yet: its URL, and what
   * takes its port (nothing ends the wait).
   */
  let waiting: { url: string; accept: (port?: Port) => void } | undefined
  /** Numbers the documents, so each port is matched to the document that was opened for it. */
  let documents = 0
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
    const url = `${DOCUMENT}?n=${++documents}`
    let accept: (port?: Port) => void = () => undefined
    const connected = new Promise<Port | undefined>((resolve) => {
      accept = (port) => {
        clearTimeout(timer)
        if (waiting?.accept === accept) waiting = undefined
        resolve(port)
      }
      const timer = setTimeout(accept, CONNECT_TIMEOUT)
    })
    // The wait starts before the document exists: its script connects before
    // createDocument() resolves. An earlier wait is over: its document is replaced.
    const earlier = waiting
    waiting = { url: browser.runtime.getURL(`/${url}` as '/offscreen.html'), accept }
    earlier?.accept()
    try {
      await inOrder(async () => {
        if (await hasDocument()) await browser.offscreen.closeDocument()
        await browser.offscreen.createDocument({
          url,
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
      post(s.client, message)
      // Nothing left to keep: the document goes. A failure that can be retried keeps the audio.
      const holds = message.state !== 'done' && message.state !== 'idle'
      if (!holds || (message.state === 'failed' && !message.retry)) dropRecorder(s)
    })
    recorder.onDisconnect.addListener(() => {
      if (s.recorder !== recorder) return
      dropRecorder(s)
      post(s.client, { state: 'failed', error: 'interrupted', retry: false })
    })
  }

  async function start(s: Session) {
    if (current && current !== s) {
      const other = current
      other.run++
      dropRecorder(other)
      post(other.client, { state: 'failed', error: 'taken', retry: false })
    }
    if (s.recorder) dropRecorder(s)
    const run = ++s.run
    current = s
    const request = await readRequest()
    if (s.run !== run) return
    if (!request) {
      current = undefined
      post(s.client, { state: 'failed', error: 'no-key', retry: false })
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
      post(s.client, { state: 'failed', error: 'mic-failed', retry: false })
      return
    }
    s.recorder = recorder
    listen(s, recorder)
    // A recorder that is gone before its start, its disconnect unseen, ends the dictation.
    if (!post(recorder, { type: 'start', request })) {
      dropRecorder(s)
      post(s.client, { state: 'failed', error: 'mic-failed', retry: false })
    }
  }

  async function retry(s: Session) {
    if (!s.recorder) return
    const request = await readRequest()
    if (!s.recorder) return
    if (!request) post(s.client, { state: 'failed', error: 'no-key', retry: true })
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
    post(s.client, { state: 'idle' })
  }

  /** A comment popover (the overlay in a tab's top frame) or the panel's Rec. */
  function connectClient(client: Port) {
    const { sender } = client
    const overlay =
      sender?.id === browser.runtime.id && sender.tab?.id !== undefined && sender.frameId === 0
    if (!sender || (!overlay && !isPanelSender(sender))) {
      client.disconnect()
      return
    }
    const s: Session = { client, run: 0 }
    client.onMessage.addListener((message: unknown) => {
      if (!isVoiceCommand(message)) return
      if (message.type === 'start') void start(s)
      else if (message.type === 'stop') post(s.recorder, { type: 'stop' })
      else if (message.type === 'retry') void retry(s)
      else cancel(s)
    })
    client.onDisconnect.addListener(() => {
      s.run++
      if (s.recorder || current === s) dropRecorder(s)
    })
  }

  /** Only the document opened last, while its dictation waits for it. */
  function connectRecorder(recorder: Port) {
    const { sender } = recorder
    const pending = waiting
    if (sender?.id !== browser.runtime.id || sender.tab || !pending || sender.url !== pending.url) {
      recorder.disconnect()
      return
    }
    pending.accept(recorder)
  }

  return {
    onConnect(port: Port) {
      if (port.name === VOICE_PORT) connectClient(port)
      else if (port.name === RECORDER_PORT) connectRecorder(port)
    },
  }
}
