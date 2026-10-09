// Dictation, coordinated (spec sections 5 and 9). Each overlay and the panel's Rec hold a port
// named `voice`. The background opens one offscreen document for the recorder, starts it with
// the limit and passes the recording's states back. One recording at a time: a start elsewhere
// first asks the running one to hand itself over. A stopped recording becomes a job, sent with
// the key, model and language: transcribed in the background, its text goes into its pin
// (`fill`) or its Rec note, whatever becomes of the port that started it, and what a pin
// cannot hold goes into a note. A port that closes while it records ends that recording. The
// document closes once no recording runs and no job is left.

import { browser, type Browser } from 'wxt/browser'
import type { Reply } from '../messages'
import { newId } from '../ids'
import { loadKey } from '../voice/key'
import type { JobView } from '../voice/jobs'
import type { TranscribeRequest } from '../voice/openrouter'
import {
  type HandedTo,
  isJobEvent,
  isRecorderMessage,
  isVoiceCommand,
  type JobEvent,
  type Keep,
  RECORDER_PORT,
  type RecorderCommand,
  type RecordingState,
  VOICE_PORT,
  type VoiceState,
} from '../voice/protocol'
import { loadVoiceSettings } from '../voice/settings'
import type { DictationsWriter } from './dictations'
import type { NotesWriter } from './notes'
import type { Filled } from './writer'
import { isPanelSender, pageSite } from './senders'

type Port = Browser.runtime.Port

const DOCUMENT = 'offscreen.html'
/** How long a new recorder document may take to connect. */
const CONNECT_TIMEOUT = 5_000
/** How long a running recording has to hand itself over when another one starts. */
export const YIELD_WAIT = 1_000

const GONE = 'This recording is no longer kept: dictate it again.'

export interface VoiceDeps {
  /** Puts a transcript after a pin's comment; `rest`: what it could not hold, `part`: a cut. */
  fill(site: string, id: string, text: string): Promise<Filled>
  notes: NotesWriter
  dictations: DictationsWriter
}

interface Session {
  client: Port
  /** The site of the overlay's page; none for the panel. */
  site?: string
  panel: boolean
  /** Changes when a start is overtaken (cancel, port gone, another start). */
  run: number
  /** The recorder was told to start for it. */
  started: boolean
  /** A stop hands its recording over: the port may close meanwhile. */
  handing: boolean
}

type Target = { kind: 'pin'; site: string; id: string } | { kind: 'note'; id: string }

interface Job {
  target: Target
  /** Failed, with the audio held for Retry. */
  held: boolean
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

export function createVoice(deps: VoiceDeps) {
  /** The recorder document's port, kept while it has work. */
  let recorder: Port | undefined
  let opening: Promise<Port | undefined> | undefined
  /** Whose recording runs, or holds a recording that ended by itself. */
  let recording: Session | undefined
  /** Called once the recording asked to hand itself over did, or was let go. */
  let released: (() => void) | undefined
  /** Cancels sent to the recorder whose `idle` has not come back: no recording ended by them. */
  let cancels = 0
  const jobs = new Map<string, Job>()
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
    // createDocument() resolves.
    waiting = { url: browser.runtime.getURL(`/${url}` as '/offscreen.html'), accept }
    try {
      await inOrder(async () => {
        // One left from before has no port here: nothing in it can be reached.
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

  /** The recorder, opened once and kept while it has work. */
  function ensureRecorder(): Promise<Port | undefined> {
    if (recorder) return Promise.resolve(recorder)
    opening ??= openRecorder()
      .catch(() => undefined)
      .then((port) => {
        opening = undefined
        if (port) attach(port)
        else void closeDocument()
        return port
      })
    return opening
  }

  function attach(port: Port) {
    recorder = port
    port.onMessage.addListener((message: unknown) => {
      if (recorder !== port || !isRecorderMessage(message) || message.state === 'alive') return
      if (isJobEvent(message)) void onJob(message)
      else onRecording(message)
    })
    port.onDisconnect.addListener(() => {
      if (recorder !== port) return
      recorder = undefined
      // Everything in the document went with it.
      const owner = recording
      recording = undefined
      released?.()
      if (owner) post(owner.client, { state: 'failed', error: 'interrupted', retry: false })
      const lost = [...jobs.values()]
      jobs.clear()
      for (const job of lost) void show(job, { state: 'failed', error: 'lost', retry: false })
      void closeDocument()
    })
  }

  /** Closes the document once nothing is left in it. */
  function closeIfIdle() {
    if (recording || jobs.size > 0 || opening || !recorder) return
    const port = recorder
    recorder = undefined
    try {
      port.disconnect()
    } catch {
      // Gone already.
    }
    void closeDocument()
  }

  function onRecording(state: RecordingState) {
    // The ack of a cancel: the recording it ended is no one's any more.
    if (state.state === 'idle' && cancels > 0) {
      cancels--
      return closeIfIdle()
    }
    const owner = recording
    if (owner) post(owner.client, state)
    // Over, unless it holds a recording that ended by itself until a stop or a cancel.
    if (state.state === 'idle' || (state.state === 'failed' && !state.retry)) {
      if (owner && recording === owner) {
        recording = undefined
        owner.started = false
        released?.()
      }
      closeIfIdle()
    }
  }

  /** Tells the recorder to end the recording; its `idle` then ends nothing else. */
  function cancelRecorder() {
    if (post(recorder, { type: 'cancel' })) cancels++
  }

  /**
   * What the pin's or the note's entry shows of its job. A pin with another job still
   * transcribed keeps saying so: its state is per pin.
   */
  async function show(job: Job, view: JobView | null): Promise<void> {
    const { target } = job
    if (target.kind === 'note') {
      if (view && view.state !== 'cut') await deps.notes.mark(target.id, view)
      return
    }
    const other = [...jobs.values()].some(
      (j) =>
        j !== job &&
        !j.held &&
        j.target.kind === 'pin' &&
        j.target.site === target.site &&
        j.target.id === target.id,
    )
    const shown =
      other && view?.state !== 'transcribing' ? { state: 'transcribing' as const } : view
    await deps.dictations.set(target.site, target.id, shown)
  }

  /** The jobs of notes that went (deleted, or the oldest beyond the limit) end. */
  function dropNotes(ids: readonly string[]) {
    for (const [id, job] of jobs) {
      if (job.target.kind !== 'note' || !ids.includes(job.target.id)) continue
      jobs.delete(id)
      post(recorder, { type: 'drop', job: id })
    }
  }

  async function keepAsNote(text: string) {
    const { evicted } = await deps.notes.create({ text })
    dropNotes(evicted)
  }

  async function onJob(e: JobEvent) {
    const job = jobs.get(e.job)
    if (!job) return
    try {
      if (e.state === 'transcribing') {
        job.held = false
        await show(job, { state: 'transcribing' })
        return
      }
      if (e.state === 'failed') {
        job.held = e.retry
        if (!e.retry) jobs.delete(e.job)
        const { error, detail, retry } = e
        await show(job, { state: 'failed', error, ...(detail ? { detail } : {}), retry })
        return
      }
      jobs.delete(e.job)
      const { target } = job
      if (target.kind === 'note') {
        await deps.notes.fill(target.id, e.text)
      } else {
        const reply = await deps
          .fill(target.site, target.id, e.text)
          .catch((): Filled => ({ ok: false, error: '' }))
        const rest = reply.ok ? reply.rest : e.text
        if (rest) await keepAsNote(rest)
        const part = reply.ok && reply.part
        await show(job, part ? { state: 'cut' } : null)
      }
    } catch {
      // Storage refused: the job is over anyway; the next start of the background says so.
    } finally {
      closeIfIdle()
    }
  }

  /** Asks the running recording to hand itself over; ends it after YIELD_WAIT otherwise. */
  function handOver(other: Session): Promise<void> {
    return new Promise((done) => {
      const letGo = () => {
        clearTimeout(timer)
        released = undefined
        if (recording === other && !other.handing) {
          other.run++
          recording = undefined
          if (other.started) cancelRecorder()
          other.started = false
          post(other.client, { state: 'failed', error: 'taken', retry: false })
        }
        done()
      }
      const timer = setTimeout(letGo, YIELD_WAIT)
      released = () => {
        clearTimeout(timer)
        released = undefined
        done()
      }
      if (!post(other.client, { state: 'yield' })) letGo()
    })
  }

  async function start(s: Session) {
    if (recording === s) return
    const run = ++s.run
    s.started = false
    while (recording && recording !== s) {
      await handOver(recording)
      if (s.run !== run) return
    }
    recording = s
    const [key, settings] = await Promise.all([loadKey(), loadVoiceSettings()])
    if (s.run !== run || recording !== s) return
    if (!key) {
      recording = undefined
      post(s.client, { state: 'failed', error: 'no-key', retry: false })
      return closeIfIdle()
    }
    const port = await ensureRecorder()
    if (s.run !== run || recording !== s) return closeIfIdle()
    if (!port || !post(port, { type: 'start', limit: settings.limit })) {
      recording = undefined
      post(s.client, { state: 'failed', error: 'mic-failed', retry: false })
      return closeIfIdle()
    }
    s.started = true
  }

  /** Ends the session's recording: nothing is sent. */
  function cancel(s: Session, tell = true) {
    s.run++
    if (recording !== s) {
      if (tell) post(s.client, { state: 'idle' })
      return
    }
    recording = undefined
    if (s.started) cancelRecorder()
    s.started = false
    released?.()
    if (tell) post(s.client, { state: 'idle' })
    closeIfIdle()
  }

  /** Hands the session's recording over to a job for its pin or a new note. */
  async function stop(s: Session, keep: Keep) {
    if (recording !== s) return void post(s.client, { state: 'idle' })
    const pin = 'pin' in keep ? keep.pin : undefined
    // A pin's page keeps a pin's dictation, the panel a note's.
    if (!s.started || !recorder || (pin ? !s.site : !s.panel)) return cancel(s)
    const run = s.run
    s.handing = true
    try {
      const request = await readRequest()
      if (recording !== s || s.run !== run) return
      if (!request) {
        cancel(s, false)
        post(s.client, { state: 'failed', error: 'no-key', retry: false })
        // The popover may be closed already: the pin says it too.
        if (pin && s.site) {
          await deps.dictations.set(s.site, pin, { state: 'failed', error: 'no-key', retry: false })
        }
        return
      }
      let target: Target
      let to: HandedTo
      if (pin && s.site) {
        target = { kind: 'pin', site: s.site, id: pin }
        to = { pin }
        await deps.dictations.set(s.site, pin, { state: 'transcribing' })
      } else {
        const { id, evicted } = await deps.notes.create({ job: { state: 'transcribing' } })
        dropNotes(evicted)
        target = { kind: 'note', id }
        to = { note: id }
      }
      const job = newId()
      // The recorder went meanwhile: so did the recording.
      if (recording !== s || !recorder) {
        return void show({ target, held: false }, { state: 'failed', error: 'lost', retry: false })
      }
      jobs.set(job, { target, held: false })
      recording = undefined
      s.started = false
      released?.()
      post(recorder, { type: 'stop', job, request })
      post(s.client, { state: 'handed', to })
    } catch {
      // A note or a state that could not be stored: the recording ends, and says so.
      if (recording === s) {
        cancel(s, false)
        post(s.client, { state: 'failed', error: 'interrupted', retry: false })
      }
    } finally {
      s.handing = false
    }
  }

  /**
   * An overlay in the top frame of a tab (never a page of the extension opened in a tab), or
   * the panel's Rec.
   */
  function connectClient(client: Port) {
    const { sender } = client
    const overlay =
      sender?.id === browser.runtime.id &&
      sender.tab?.id !== undefined &&
      sender.frameId === 0 &&
      !sender.url?.startsWith(browser.runtime.getURL('/'))
    const panel = !!sender && !overlay && isPanelSender(sender)
    if (!sender || (!overlay && !panel)) {
      client.disconnect()
      return
    }
    const s: Session = {
      client,
      site: overlay ? (pageSite(sender) ?? undefined) : undefined,
      panel,
      run: 0,
      started: false,
      handing: false,
    }
    client.onMessage.addListener((message: unknown) => {
      if (!isVoiceCommand(message)) return
      switch (message.type) {
        case 'start':
          return void start(s)
        case 'stop':
          return void stop(s, message.keep)
        case 'resume':
          if (recording === s) post(recorder, { type: 'resume' })
          return
        case 'cancel':
          return cancel(s)
      }
    })
    client.onDisconnect.addListener(() => {
      if (!s.handing) cancel(s, false)
    })
  }

  /** Only the document opened last, while it is waited for. */
  function connectRecorder(port: Port) {
    const { sender } = port
    const pending = waiting
    if (sender?.id !== browser.runtime.id || sender.tab || !pending || sender.url !== pending.url) {
      port.disconnect()
      return
    }
    pending.accept(port)
  }

  /** The job of a pin's or a note's dictation that holds its audio. */
  function heldJob(match: (target: Target) => boolean): [string, Job] | undefined {
    return [...jobs].find(([, job]) => job.held && match(job.target))
  }

  /** Sends a held job's audio again, with the key and settings as they are now. */
  async function retry(found: [string, Job] | undefined): Promise<Reply> {
    if (!found || !recorder) return { ok: false, error: GONE }
    const request = await readRequest()
    if (!request) return { ok: false, error: 'Add an OpenRouter API key in settings.' }
    const [id, job] = found
    if (jobs.get(id) !== job || !recorder) return { ok: false, error: GONE }
    job.held = false
    post(recorder, { type: 'retry', job: id, request })
    return { ok: true }
  }

  function drop(found: [string, Job] | undefined) {
    if (!found) return
    jobs.delete(found[0])
    post(recorder, { type: 'drop', job: found[0] })
  }

  const isPin = (site: string, id: string) => (t: Target) =>
    t.kind === 'pin' && t.site === site && t.id === id
  const isNote = (id: string) => (t: Target) => t.kind === 'note' && t.id === id

  return {
    onConnect(port: Port) {
      if (port.name === VOICE_PORT) connectClient(port)
      else if (port.name === RECORDER_PORT) connectRecorder(port)
    },

    /** Retry on a pin whose dictation failed. */
    retryPin: (site: string, id: string) => retry(heldJob(isPin(site, id))),

    /** Dismiss on a pin's failed or cut dictation: its state goes, and the audio it held. */
    async dismissPin(site: string, id: string): Promise<Reply> {
      drop([...jobs].find(([, job]) => isPin(site, id)(job.target)))
      await deps.dictations.set(site, id, null)
      closeIfIdle()
      return { ok: true }
    },

    /** Retry on a Rec note whose dictation failed. */
    retryNote: (id: string) => retry(heldJob(isNote(id))),

    /** Delete on a Rec note: it goes for good, and its job with it. */
    async deleteNote(id: string): Promise<Reply> {
      drop([...jobs].find(([, job]) => isNote(id)(job.target)))
      await deps.notes.remove(id)
      closeIfIdle()
      return { ok: true }
    },

    /**
     * The background started: no recorder runs for it. A document left from before is closed,
     * and what was transcribed or held for Retry in it is lost.
     */
    recover(): Promise<void> {
      void closeDocument()
      return Promise.all([deps.dictations.interrupt(), deps.notes.interrupt()]).then(
        () => undefined,
      )
    },
  }
}
