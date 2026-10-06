// @vitest-environment node
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// The overlay runs next to hostile pages and must never touch the OpenRouter key (spec
// section 9): the lint rule is the guard, this test proves it fires.
const eslint = new ESLint()

async function guardFindings(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-syntax' || m.ruleId === 'no-restricted-imports')
    .map((m) => m.message)
}

const OVERLAY = 'src/entrypoints/overlay.content/probe.ts'
const ELSEWHERE = 'src/lib/probe.ts'

describe('the overlay key guard', () => {
  it.each([
    ['reads the key property', 'export const k = (globalThis as any).settings.openrouterKey'],
    ['names the storage key', "export const name = 'openrouterKey'"],
    ['destructures the key', 'export const { openrouterKey } = (globalThis as any).stored'],
    ['imports the key module', "export { loadKey } from '@/lib/voice/key'"],
    ['imports it relatively', "import { loadKey } from '../../lib/voice/key'\nvoid loadKey"],
    ['imports it with its extension', "export { loadKey } from '@/lib/voice/key.ts'"],
  ])(
    'fails when the overlay %s',
    async (_, code) => {
      expect(await guardFindings(code, OVERLAY)).not.toHaveLength(0)
    },
    30_000,
  )

  it('lets the overlay read its own storage keys', async () => {
    const code = "void (globalThis as any).browser.storage.local.get('collection')"
    expect(await guardFindings(code, OVERLAY)).toEqual([])
  }, 30_000)

  it('leaves the rest of the extension alone', async () => {
    const code = [
      "import { loadKey } from '@/lib/voice/key'",
      'export const k = (globalThis as any).settings.openrouterKey',
      'void loadKey',
      'void (globalThis as any).browser.storage.local.get(null)',
    ].join('\n')
    expect(await guardFindings(code, ELSEWHERE)).toEqual([])
  }, 30_000)
})
