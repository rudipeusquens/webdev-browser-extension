import { describe, expect, it } from 'vitest'
import {
  isRecorderCommand,
  isRecorderMessage,
  isVoiceCommand,
  isVoiceState,
  LIMIT,
  RECORDER_PORT,
  VOICE_PORT,
} from '@/lib/voice/protocol'

const request = { key: 'test-key-1', model: 'openai/gpt-4o-mini-transcribe', language: 'auto' }

describe('the dictation protocol', () => {
  it('names its ports and the recording limit', () => {
    expect(VOICE_PORT).toBe('voice')
    expect(RECORDER_PORT).toBe('recorder')
    expect(LIMIT).toBe(120_000)
  })

  it.each([
    { state: 'idle' },
    { state: 'starting' },
    { state: 'recording', limit: 120_000 },
    { state: 'transcribing' },
    { state: 'done', text: 'Make it wider.', atLimit: false },
    { state: 'failed', error: 'offline', retry: true },
    { state: 'failed', error: 'rejected', detail: 'Model a/b does not exist', retry: true },
  ])('accepts the state $state', (state) => {
    expect(isVoiceState(state)).toBe(true)
    expect(isRecorderMessage(state)).toBe(true)
  })

  it.each([
    ['an unknown state', { state: 'paused' }],
    ['a recording without its limit', { state: 'recording' }],
    ['a negative limit', { state: 'recording', limit: -1 }],
    ['a text that is no string', { state: 'done', text: 42, atLimit: false }],
    ['an endless text', { state: 'done', text: 'x'.repeat(20_001), atLimit: false }],
    ['an unknown error', { state: 'failed', error: 'oops', retry: false }],
    ['a long reason', { state: 'failed', error: 'rejected', detail: 'x'.repeat(201), retry: true }],
    ['an extra key', { state: 'idle', key: 'test-key-1' }],
    ['the heartbeat', { state: 'alive' }],
    ['null', null],
  ])('refuses %s as a state', (_, state) => {
    expect(isVoiceState(state)).toBe(false)
  })

  it('lets the recorder send a heartbeat', () => {
    expect(isRecorderMessage({ state: 'alive' })).toBe(true)
    expect(isRecorderMessage({ state: 'alive', at: 1 })).toBe(false)
  })

  it('accepts the popover commands and nothing else', () => {
    for (const type of ['start', 'stop', 'cancel', 'retry']) {
      expect(isVoiceCommand({ type })).toBe(true)
    }
    // The popover never names a key or a model: the background reads them.
    expect(isVoiceCommand({ type: 'start', request })).toBe(false)
    expect(isVoiceCommand({ type: 'pause' })).toBe(false)
    expect(isVoiceCommand('start')).toBe(false)
  })

  it('accepts the recorder commands with a well-formed request only', () => {
    expect(isRecorderCommand({ type: 'start', request })).toBe(true)
    expect(isRecorderCommand({ type: 'retry', request })).toBe(true)
    expect(isRecorderCommand({ type: 'stop' })).toBe(true)
    expect(isRecorderCommand({ type: 'cancel' })).toBe(true)
    expect(isRecorderCommand({ type: 'start' })).toBe(false)
    expect(isRecorderCommand({ type: 'start', request: { ...request, key: 'a b' } })).toBe(false)
    expect(isRecorderCommand({ type: 'start', request: { ...request, model: 'x' } })).toBe(false)
    expect(isRecorderCommand({ type: 'start', request: { ...request, language: 'de-DE' } })).toBe(
      false,
    )
    expect(isRecorderCommand({ type: 'start', request: { ...request, extra: 1 } })).toBe(false)
    expect(isRecorderCommand({ type: 'stop', request })).toBe(false)
  })
})
