import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FAKE_TEXT, startFakeOpenRouter } from './fake-openrouter'
import { launch, type Session, useFixtureServer } from './harness'
import { sleep, startOverlay } from './overlay-helpers'
import { setKey } from './voice-helpers'

// A recording without any sound (spec section 9): Chrome's fake microphone plays a silent
// file, as a muted microphone would. Nothing is sent to the fake OpenRouter until Retry.

/** A WAV file of `seconds` of silence: 16-bit mono PCM at 48 kHz. */
function silentWav(seconds: number): Buffer {
  const rate = 48_000
  const data = Buffer.alloc(rate * 2 * seconds)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

describe('a recording without any sound', () => {
  const server = useFixtureServer()
  let fake: Awaited<ReturnType<typeof startFakeOpenRouter>>
  let dir: string
  let s: Session
  let panel: Page

  beforeAll(async () => {
    fake = await startFakeOpenRouter()
    dir = await mkdtemp(join(tmpdir(), 'webdev-silence-'))
    const file = join(dir, 'silence.wav')
    await writeFile(file, silentWav(2))
    s = await launch({
      openrouter: fake.origin,
      microphone: 'granted',
      args: [`--use-file-for-fake-audio-capture=${file}`],
    })
    panel = await startOverlay(s, `${server.origin}/plain/`, { clear: false })
    await setKey(s, 'test-key-e2e-1234')
  })

  afterAll(async () => {
    await s?.browser.close()
    await fake?.close()
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('is not sent, says so on its note, and Retry sends it anyway', async () => {
    await panel.click('[data-testid="rec"]')
    await panel.waitForSelector('[data-testid="rec"][data-dictation="recording"]')
    await sleep(1500)
    await panel.click('[data-testid="rec"]')
    const failure = await panel.waitForSelector('[data-testid="note-job"]')
    expect(await failure?.evaluate((el) => el.textContent)).toContain('Nothing was heard')
    await sleep(500)
    expect(fake.transcriptions()).toHaveLength(0)
    await panel.click('[data-testid="note-retry"]')
    await panel.waitForSelector('[data-testid="note-text"]')
    expect(fake.transcriptions()).toHaveLength(1)
    expect(await panel.$eval('[data-testid="note-text"]', (el) => el.textContent)).toBe(FAKE_TEXT)
  })
})
