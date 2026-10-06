#!/usr/bin/env node
// Generates the fixture audio of the voice tests (spec section 12): synthetic speech for each
// clip in tests/fixtures/audio/clips.json, written next to it as `<id>.wav` (16-bit mono PCM,
// which Chrome plays as a fake microphone). Never a recording of a real person.
//   node --env-file=.env scripts/voice-fixtures.mjs
// Uses OPENROUTER_API_KEY_TEST from the local .env; never run in CI. The key is never printed.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIR = 'tests/fixtures/audio'
const TTS_MODEL = 'google/gemini-3.8-flash-lite-tts'
const VOICE = 'Kore'

/** A RIFF/WAVE file around 16-bit mono PCM. */
export function wav(pcm, sampleRate) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function speak(key, text) {
  const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: TTS_MODEL, input: text, voice: VOICE, response_format: 'pcm' }),
  })
  if (!res.ok) throw new Error(`speech request failed with HTTP ${res.status}`)
  const rate = Number(/rate=(\d+)/.exec(res.headers.get('content-type') ?? '')?.[1] ?? 24000)
  return { pcm: Buffer.from(await res.arrayBuffer()), rate }
}

async function main() {
  const key = process.env.OPENROUTER_API_KEY_TEST
  if (!key) throw new Error('OPENROUTER_API_KEY_TEST is not set (node --env-file=.env …)')
  const clips = JSON.parse(readFileSync(join(DIR, 'clips.json'), 'utf8'))
  for (const clip of clips) {
    const { pcm, rate } = await speak(key, clip.text)
    writeFileSync(join(DIR, `${clip.id}.wav`), wav(pcm, rate))
    console.log(`${clip.id}.wav: ${(pcm.length / 2 / rate).toFixed(1)} s`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'failed')
    process.exitCode = 1
  })
}
