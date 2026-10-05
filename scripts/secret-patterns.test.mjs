import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

// A well-formed but fake key, assembled at runtime so this file never contains one.
const fakeKey = 'sk-or-v1-' + 'ab12'.repeat(16)
const dir = mkdtempSync(join(tmpdir(), 'secret-patterns-'))
after(() => rmSync(dir, { recursive: true, force: true }))

function secretlint(content) {
  const file = join(dir, 'sample.ts')
  writeFileSync(file, content)
  return spawnSync(
    join('node_modules', '.bin', 'secretlint'),
    ['--secretlintrc', '.secretlintrc.json', '--maskSecrets', file],
    { encoding: 'utf8' },
  )
}

describe('secretlint', () => {
  it('flags an OpenRouter API key and masks it', () => {
    const result = secretlint(`const key = "${fakeKey}"\n`)
    assert.notEqual(result.status, 0)
    assert.ok(!`${result.stdout}${result.stderr}`.includes(fakeKey))
  })

  it('accepts the bare prefix in documentation', () => {
    assert.equal(secretlint('Keys start with sk-or-v1- followed by 64 hex characters.\n').status, 0)
  })
})
