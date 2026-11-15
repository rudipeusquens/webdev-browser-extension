import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_DB,
  archiveAudio,
  audioBytes,
  audioFileName,
  exportArchive,
  loadAudio,
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
    ['an unknown field', { ...note, sound: 'x' }],
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
    expect(exportName(at)).toBe('dictations-2026-11-05.zip')
    expect(exportName(at, 3)).toBe('dictations-2026-11-05-3.zip')
  })

  describe('with the recordings', () => {
    const bytes = (...values: number[]) => new Uint8Array(values).buffer
    const json = (entries: { name: string; data: Uint8Array }[]) =>
      JSON.parse(
        new TextDecoder().decode(entries.find((e) => e.name === 'dictations.json')?.data),
      ) as { dictations: unknown[] }

    it('keeps a recording by its id, counts its bytes and forgets it with the texts', async () => {
      expect(await audioBytes()).toBe(0)
      await archiveAudio('j1', [bytes(1, 2, 3), bytes(4, 5)], 'T')
      await archiveAudio('j2', [bytes(6)], 'T')
      expect(await audioBytes()).toBe(6)
      const kept = await loadAudio('j1')
      expect(kept).toMatchObject({ at: 'T', bytes: 5 })
      expect(kept?.parts.map((p) => [...new Uint8Array(p)])).toEqual([
        [1, 2, 3],
        [4, 5],
      ])
      expect(await loadAudio('none')).toBeUndefined()
      await clearArchive()
      expect(await audioBytes()).toBe(0)
      expect(await loadAudio('j1')).toBeUndefined()
    })

    it('takes a text that names its recording, and no id that is none', () => {
      expect(isArchivedDictation({ ...note, audio: 'j1' })).toBe(true)
      expect(isArchivedDictation({ ...note, audio: 'a b' })).toBe(false)
    })

    it('exports one file: each recording part, and the list that names them', async () => {
      await archiveAudio('j1', [bytes(1, 2, 3), bytes(4, 5)])
      await archiveDictation({ ...note, audio: 'j1' })
      await archiveDictation(pin)
      // Its recording is gone: the text is exported without files.
      await archiveDictation({ ...note, audio: 'lost' })
      const files: { name: string; data: Uint8Array }[][] = []
      await exportArchive((entries) => void files.push(entries))
      expect(files).toHaveLength(1)
      expect(files[0]?.map((e) => e.name)).toEqual([
        'audio/j1-1.webm',
        'audio/j1-2.webm',
        'dictations.json',
      ])
      expect([...(files[0]?.[1]?.data ?? [])]).toEqual([4, 5])
      expect(json(files[0] ?? []).dictations).toEqual([
        { ...note, audio: 'j1', audioFiles: [audioFileName('j1', 0), audioFileName('j1', 1)] },
        pin,
        { ...note, audio: 'lost' },
      ])
    })

    it('starts another file when one is full; the list comes in the last', async () => {
      await archiveAudio('j1', [bytes(1, 2, 3), bytes(4, 5, 6)])
      await archiveAudio('j2', [bytes(7, 8, 9)])
      await archiveDictation({ ...note, audio: 'j1' })
      await archiveDictation({ ...note, audio: 'j2' })
      const files: [number, string[]][] = []
      await exportArchive(
        (entries, volume) => void files.push([volume, entries.map((e) => e.name)]),
        new Date(),
        5,
      )
      expect(files).toEqual([
        [1, ['audio/j1-1.webm']],
        [2, ['audio/j1-2.webm']],
        [3, ['audio/j2-1.webm', 'dictations.json']],
      ])
    })
  })
})
