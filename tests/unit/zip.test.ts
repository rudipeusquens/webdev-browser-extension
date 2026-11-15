// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crc32, zip } from '@/lib/zip'
import { unzip } from './helpers/unzip'

const text = (s: string) => new TextEncoder().encode(s)

describe('zip', () => {
  it('computes the CRC-32 of the standard', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('stores its entries in order, read back whole', async () => {
    const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 255, 7])
    const blob = zip([
      { name: 'audio/a1-1.webm', data: audio },
      { name: 'dictations.json', data: text('{"ü":"✓"}') },
      { name: 'empty', data: new Uint8Array() },
    ])
    expect(blob.type).toBe('application/zip')
    const entries = unzip(new Uint8Array(await blob.arrayBuffer()))
    expect([...entries.keys()]).toEqual(['audio/a1-1.webm', 'dictations.json', 'empty'])
    expect([...(entries.get('audio/a1-1.webm') ?? [])]).toEqual([...audio])
    expect(new TextDecoder().decode(entries.get('dictations.json'))).toBe('{"ü":"✓"}')
  })

  it('writes a file the system unzip accepts', async () => {
    let has = true
    try {
      execFileSync('unzip', ['-v'], { stdio: 'ignore' })
    } catch {
      has = false
    }
    if (!has) return
    const dir = mkdtempSync(join(tmpdir(), 'webdev-zip-'))
    try {
      const file = join(dir, 'a.zip')
      const blob = zip([
        { name: 'audio/a1-1.webm', data: new Uint8Array(70_000).fill(9) },
        { name: 'dictations.json', data: text('{"a":1}') },
      ])
      writeFileSync(file, new Uint8Array(await blob.arrayBuffer()))
      // -t tests every entry's CRC.
      expect(execFileSync('unzip', ['-t', file]).toString()).toContain('No errors detected')
      expect(execFileSync('unzip', ['-p', file, 'dictations.json']).toString()).toBe('{"a":1}')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
