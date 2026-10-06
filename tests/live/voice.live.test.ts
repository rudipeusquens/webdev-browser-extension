import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODELS } from '../../src/lib/voice/settings'
import {
  clickAction,
  contentRealm,
  launch,
  serviceWorker,
  type Session,
  startFixtureServer,
  startOverlayAgain,
} from '../e2e/harness'
import { setKey } from '../e2e/voice-helpers'
import {
  clickInOverlay,
  markElement,
  overlayMounted,
  overlayText,
  sleep,
} from '../e2e/overlay-helpers'

// The real extension, Chrome's fake microphone playing a synthetic clip, the real OpenRouter
// API (spec section 12). Runs only with OPENROUTER_API_KEY_TEST in .env: pnpm test:live.
// Never prints the key.
const KEY = process.env.OPENROUTER_API_KEY_TEST ?? ''
const AUDIO = resolve('tests/fixtures/audio')

interface Clip {
  id: string
  language: string
  text: string
}

interface ExtensionApi {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } }
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[-–]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)

/** Share of the script's words the transcript has, each counted as often as it occurs. */
function found(script: string, transcript: string): number {
  const left = words(transcript)
  let hits = 0
  for (const word of words(script)) {
    const at = left.indexOf(word)
    if (at < 0) continue
    left.splice(at, 1)
    hits++
  }
  return hits / words(script).length
}

/** WAV length in milliseconds: 16-bit mono PCM after a 44-byte header. */
async function duration(clip: Clip): Promise<number> {
  const file = await readFile(resolve(AUDIO, `${clip.id}.wav`))
  return ((file.length - 44) / 2 / file.readUInt32LE(24)) * 1000
}

async function field(s: Session): Promise<string> {
  const realm = await contentRealm(s)
  return realm.evaluate(
    () =>
      (globalThis.__webdevOverlay?.shadow?.querySelector('textarea') as HTMLTextAreaElement | null)
        ?.value ?? '',
  )
}

/** Dictates the clip once with `model`; the transcript and the seconds it took after stop. */
async function dictate(s: Session, origin: string, clip: Clip, model: string) {
  const worker = await serviceWorker(s)
  await worker.evaluate(async (m: string) => {
    const { storage } = (globalThis as unknown as { chrome: ExtensionApi }).chrome
    await storage.local.set({ voice: { model: m, language: 'auto' } })
  }, model)
  await s.page.goto(`${origin}/plain/`)
  await startOverlayAgain(s)
  await overlayMounted(s)
  await markElement(s, 'button[type="submit"]')
  await clickInOverlay(s, '[data-testid="overlay-mic"]')
  for (let i = 0; i < 100; i++) {
    if ((await overlayText(s, '[data-testid="overlay-voice-status"]'))?.includes('Alt+V')) break
    await sleep(50)
  }
  await sleep((await duration(clip)) + 500)
  await clickInOverlay(s, '[data-testid="overlay-mic"]')
  const stopped = Date.now()
  let text = ''
  for (let i = 0; i < 600 && !text; i++) {
    text = await field(s)
    if (!text) {
      const message = await overlayText(s, '[data-testid="overlay-voice-message"]')
      if (message) throw new Error(`${model}: ${message}`)
      await sleep(100)
    }
  }
  return { text, seconds: (Date.now() - stopped) / 1000 }
}

describe.skipIf(!KEY)('dictation with the real API', async () => {
  const clips = JSON.parse(await readFile(resolve(AUDIO, 'clips.json'), 'utf8')) as Clip[]

  for (const clip of clips) {
    it(`transcribes ${clip.id} with every listed model`, async () => {
      const server = await startFixtureServer()
      const s = await launch({
        microphone: 'granted',
        // %noloop: the clip plays once instead of starting over.
        args: [`--use-file-for-fake-audio-capture=${resolve(AUDIO, `${clip.id}.wav`)}%noloop`],
      })
      try {
        await setKey(s, KEY)
        // The toolbar click grants the tab activeTab; each dictation starts a fresh overlay.
        await s.page.goto(`${server.origin}/plain/`)
        await clickAction(s)
        await overlayMounted(s)
        const rows: string[] = []
        for (const [index, model] of MODELS.entries()) {
          const { text, seconds } = await dictate(s, server.origin, clip, model.id)
          const share = found(clip.text, text)
          rows.push(
            `| ${model.id} | ${clip.id} | ${Math.round(share * 100)} % | ${seconds.toFixed(1)} s | ${text} |`,
          )
          // The default model must be good; the others are compared.
          expect(share).toBeGreaterThanOrEqual(index === 0 ? 0.8 : 0.5)
        }
        console.log(
          ['| Model | Clip | Words found | After stop | Transcript |', ...rows].join('\n'),
        )
      } finally {
        await s.browser.close()
        await server.close()
      }
    })
  }
})
