import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { archiveDictation, type ArchivedDictation, countArchive } from '@/lib/voice/archive'
import { byTestId, mountPanel, teardownPanel } from './helpers/panel'

const entry: ArchivedDictation = {
  at: '2026-11-15T10:00:00.000Z',
  kind: 'note',
  text: 'Use Tailwind.',
  raw: 'Use tail wind.',
  model: 'openai/gpt-4o-mini-transcribe',
  language: 'auto',
}

/** Lets IndexedDB answer: it takes a few tasks, more than one flushPromises. */
async function settle() {
  for (let i = 0; i < 20; i++) await flushPromises()
}

async function openSettings() {
  await mountPanel()
  byTestId('open-settings').click()
  await settle()
}

describe('Settings: archive', () => {
  beforeEach(() => {
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 1 }] as never)
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockRejectedValue(new Error('No overlay.'))
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({ ok: true } as never)
  })

  afterEach(() => {
    teardownPanel()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('has nothing to export or delete while it is empty', async () => {
    await openSettings()
    expect(byTestId('archive-count').textContent).toContain('0 dictations')
    expect(byTestId('archive-export').hasAttribute('disabled')).toBe(true)
    expect(byTestId('archive-clear').hasAttribute('disabled')).toBe(true)
    expect(byTestId('archive-settings').textContent).toContain('recordings themselves are not kept')
  })

  it('exports every dictation as a JSON file the browser downloads', async () => {
    await archiveDictation(entry)
    await archiveDictation({ ...entry, text: 'Second.' })
    const blobs: Blob[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => (blobs.push(blob), 'blob:archive'),
      revokeObjectURL: vi.fn(),
    })
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this)
    })
    await openSettings()
    expect(byTestId('archive-count').textContent).toContain('2 dictations')
    byTestId('archive-export').click()
    await settle()
    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.download).toMatch(/^dictations-\d{4}-\d{2}-\d{2}\.json$/)
    expect(clicked[0]?.getAttribute('href')).toBe('blob:archive')
    expect(blobs[0]?.type).toBe('application/json')
    const exported = JSON.parse((await blobs[0]?.text()) ?? '') as { dictations: unknown[] }
    expect(exported).toMatchObject({ version: 1, exportedAt: expect.any(String) })
    expect(exported.dictations).toEqual([entry, { ...entry, text: 'Second.' }])
    // The link is gone again, and the archive is as it was.
    expect(document.querySelector('a[download]')).toBeNull()
    expect(await countArchive()).toBe(2)
  })

  it('deletes the archive only after a confirmation', async () => {
    await archiveDictation(entry)
    await openSettings()
    byTestId('archive-clear').click()
    await settle()
    expect(await countArchive()).toBe(1)
    expect(document.body.textContent).toContain('Delete the archive?')
    byTestId('archive-clear-confirm', document.body).click()
    await settle()
    expect(await countArchive()).toBe(0)
    expect(byTestId('archive-count').textContent).toContain('0 dictations')
  })
})
