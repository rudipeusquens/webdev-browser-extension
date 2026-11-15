import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_DB,
  archiveDictation,
  type ArchivedDictation,
  clearArchive,
  countArchive,
  exportName,
  exportOf,
  isArchivedDictation,
  loadArchive,
} from '@/lib/voice/archive'
import { KEY_DB, loadKey, storeKey } from '@/lib/voice/key'

const note: ArchivedDictation = {
  at: '2026-11-15T10:00:00.000Z',
  kind: 'note',
  text: 'Use Tailwind.',
  raw: 'Use tail wind.',
  ms: 2400,
  model: 'openai/gpt-4o-mini-transcribe',
  language: 'auto',
  correctModel: 'anthropic/claude-haiku-5.5',
}
const pin: ArchivedDictation = {
  at: '2026-11-15T10:05:00.000Z',
  kind: 'pin',
  site: 'http://localhost:3000',
  text: 'Make it wider.',
  model: 'a/b',
  language: 'de',
}

describe('the archive of the dictations', () => {
  it('keeps every dictation in order, counts them and forgets them all at once', async () => {
    expect(await countArchive()).toBe(0)
    expect(await loadArchive()).toEqual([])
    await archiveDictation(note)
    await archiveDictation(pin)
    await archiveDictation(note)
    expect(await countArchive()).toBe(3)
    expect(await loadArchive()).toEqual([note, pin, note])
    await clearArchive()
    expect(await countArchive()).toBe(0)
  })

  it('lives in a database of its own, apart from the key', async () => {
    expect(ARCHIVE_DB.name).not.toBe(KEY_DB.name)
    await storeKey('test-key-1234')
    await archiveDictation(note)
    await clearArchive()
    expect(await loadKey()).toBe('test-key-1234')
  })

  it.each([
    ['no text', { ...note, text: '' }],
    ['another kind', { ...note, kind: 'memo' }],
    ['a site that is none', { ...pin, site: 'localhost' }],
    ['a model that is none', { ...note, model: 'gpt' }],
    ['an unknown field', { ...note, audio: 'x' }],
    ['a length that is no count', { ...note, ms: -5 }],
    ['nothing', null],
  ])('reads no entry with %s', async (_, entry) => {
    expect(isArchivedDictation(entry)).toBe(false)
  })

  it('exports them with a version and the time, under a dated name', () => {
    const at = new Date(2026, 10, 5, 9, 30)
    expect(exportOf([note, pin], at)).toEqual({
      version: 1,
      exportedAt: at.toISOString(),
      dictations: [note, pin],
    })
    expect(exportName(at)).toBe('dictations-2026-11-05.json')
  })
})
