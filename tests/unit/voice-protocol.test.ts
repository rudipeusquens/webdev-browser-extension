import { describe, expect, it } from 'vitest'
import {
  dictationFailure,
  isJobEvent,
  isRecorderCommand,
  isRecorderMessage,
  isVoiceCommand,
  isVoiceState,
  MAX_TEXT,
  RECORDER_PORT,
  VOICE_PORT,
} from '@/lib/voice/protocol'

const request = { key: 'test-key-1', model: 'openai/gpt-4o-mini-transcribe', language: 'auto' }
const JOB = 'job-1'

describe('the dictation protocol', () => {
  it('names its ports and the longest transcript', () => {
    expect(VOICE_PORT).toBe('voice')
    expect(RECORDER_PORT).toBe('recorder')
    expect(MAX_TEXT).toBe(20_000)
  })

  it.each([
    { state: 'idle' },
    { state: 'starting' },
    { state: 'recording', limit: 300_000, elapsed: 0 },
    { state: 'recording', limit: 10_000, elapsed: 312_500 },
    { state: 'paused', elapsed: 300_000 },
    { state: 'handed', to: { pin: 'a1' } },
    { state: 'handed', to: { note: 'n1' } },
    { state: 'yield' },
    { state: 'failed', error: 'offline', retry: true },
    { state: 'failed', error: 'mic-lost', retry: true },
    { state: 'failed', error: 'rejected', detail: 'Model a/b does not exist', retry: true },
  ])('accepts the state $state', (state) => {
    expect(isVoiceState(state)).toBe(true)
  })

  it.each([
    ['an unknown state', { state: 'transcribing' }],
    ['a recording without its limit', { state: 'recording', elapsed: 0 }],
    ['a recording without its time', { state: 'recording', limit: 300_000 }],
    ['a negative limit', { state: 'recording', limit: -1, elapsed: 0 }],
    ['a pause without its time', { state: 'paused' }],
    ['a handover to nothing', { state: 'handed', to: {} }],
    ['a handover to both', { state: 'handed', to: { pin: 'a1', note: 'n1' } }],
    ['a handover to a bad id', { state: 'handed', to: { pin: 'a b' } }],
    ['an unknown error', { state: 'failed', error: 'oops', retry: false }],
    ['a long reason', { state: 'failed', error: 'rejected', detail: 'x'.repeat(201), retry: true }],
    ['an extra key', { state: 'idle', key: 'test-key-1' }],
    ['the heartbeat', { state: 'alive' }],
    ['null', null],
  ])('refuses %s as a state', (_, state) => {
    expect(isVoiceState(state)).toBe(false)
  })

  it.each([
    { job: JOB, state: 'transcribing' },
    { job: JOB, state: 'done', text: 'Make it wider.', cut: false },
    { job: JOB, state: 'done', text: 'x'.repeat(20_000), cut: true },
    { job: JOB, state: 'failed', error: 'rate-limited', retry: true },
    { job: JOB, state: 'failed', error: 'rejected', detail: 'Unknown model', retry: true },
  ])("accepts a job's $state", (event) => {
    expect(isJobEvent(event)).toBe(true)
    expect(isRecorderMessage(event)).toBe(true)
  })

  it.each([
    ['a job without its id', { state: 'transcribing' }],
    ['a bad job id', { job: 'a b', state: 'transcribing' }],
    ['an endless text', { job: JOB, state: 'done', text: 'x'.repeat(20_001), cut: true }],
    ['a text that is no string', { job: JOB, state: 'done', text: 42, cut: false }],
    ['a recording state with a job', { job: JOB, state: 'recording', limit: 1, elapsed: 0 }],
  ])("refuses %s as a job's event", (_, event) => {
    expect(isJobEvent(event)).toBe(false)
  })

  it('lets the recorder send its recording states, job events and a heartbeat', () => {
    expect(isRecorderMessage({ state: 'alive' })).toBe(true)
    expect(isRecorderMessage({ state: 'recording', limit: 300_000, elapsed: 0 })).toBe(true)
    expect(isRecorderMessage({ state: 'paused', elapsed: 1 })).toBe(true)
    expect(isRecorderMessage({ state: 'failed', error: 'mic-lost', retry: true })).toBe(true)
    // What only the background says to a popover or the panel.
    expect(isRecorderMessage({ state: 'handed', to: { pin: 'a1' } })).toBe(false)
    expect(isRecorderMessage({ state: 'yield' })).toBe(false)
    expect(isRecorderMessage({ state: 'alive', at: 1 })).toBe(false)
  })

  it('accepts the commands of a popover or the panel, and nothing else', () => {
    for (const type of ['start', 'resume', 'cancel']) expect(isVoiceCommand({ type })).toBe(true)
    expect(isVoiceCommand({ type: 'stop', keep: { pin: 'a1' } })).toBe(true)
    expect(isVoiceCommand({ type: 'stop', keep: { note: true } })).toBe(true)
    expect(isVoiceCommand({ type: 'stop' })).toBe(false)
    expect(isVoiceCommand({ type: 'stop', keep: { note: 'n1' } })).toBe(false)
    expect(isVoiceCommand({ type: 'stop', keep: { pin: 'a b' } })).toBe(false)
    // The popover never names a key, a model or a limit: the background reads them.
    expect(isVoiceCommand({ type: 'start', request })).toBe(false)
    expect(isVoiceCommand({ type: 'start', limit: 10_000 })).toBe(false)
    expect(isVoiceCommand({ type: 'retry' })).toBe(false)
    expect(isVoiceCommand('start')).toBe(false)
  })

  it('accepts the recorder commands with a well-formed request, job and limit only', () => {
    expect(isRecorderCommand({ type: 'start', limit: 300_000 })).toBe(true)
    expect(isRecorderCommand({ type: 'resume' })).toBe(true)
    expect(isRecorderCommand({ type: 'cancel' })).toBe(true)
    expect(isRecorderCommand({ type: 'stop', job: JOB, request })).toBe(true)
    expect(isRecorderCommand({ type: 'retry', job: JOB, request })).toBe(true)
    expect(isRecorderCommand({ type: 'drop', job: JOB })).toBe(true)
    expect(isRecorderCommand({ type: 'start' })).toBe(false)
    expect(isRecorderCommand({ type: 'start', limit: 9_999 })).toBe(false)
    expect(isRecorderCommand({ type: 'start', limit: 3_600_000 })).toBe(true)
    expect(isRecorderCommand({ type: 'start', limit: 3_600_001 })).toBe(false)
    expect(isRecorderCommand({ type: 'stop', request })).toBe(false)
    expect(isRecorderCommand({ type: 'stop', job: JOB, request: { ...request, key: 'a b' } })).toBe(
      false,
    )
    expect(
      isRecorderCommand({ type: 'retry', job: JOB, request: { ...request, model: 'x' } }),
    ).toBe(false)
    expect(isRecorderCommand({ type: 'drop' })).toBe(false)
    expect(isRecorderCommand({ type: 'resume', job: JOB })).toBe(false)
  })

  it('says what a failure means and which buttons help', () => {
    expect(dictationFailure({ state: 'failed', error: 'mic-lost', retry: true })).toEqual({
      text: 'The microphone stopped. Retry sends what was recorded.',
      retry: true,
      grant: false,
      settings: false,
    })
    expect(dictationFailure({ state: 'failed', error: 'no-key', retry: false })?.settings).toBe(
      true,
    )
    expect(dictationFailure({ state: 'idle' })).toBeNull()
  })
})
