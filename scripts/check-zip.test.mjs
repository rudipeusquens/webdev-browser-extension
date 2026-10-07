import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { crc32, deflateRawSync } from 'node:zlib'

import { checkZip, readZip } from './check-zip.mjs'

const SCRIPT = new URL('./check-zip.mjs', import.meta.url).pathname
const UNIX = 3 << 8
const SYMLINK = (0o120777 << 16) >>> 0

/**
 * A zip of `entries` ({ name, data, method = 8 (deflate), flags, madeBy, external, localName,
 * crc }), written field by field so a test can break any one of them.
 */
function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '')
    const method = entry.method ?? 8
    const body = method === 8 ? deflateRawSync(data) : data
    const name = Buffer.from(entry.name)
    const localName = Buffer.from(entry.localName ?? entry.name)
    const crc = entry.crc ?? crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.flags ?? 0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(localName.length, 26)
    locals.push(local, localName, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(entry.madeBy ?? 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(entry.flags ?? 0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(entry.external ?? 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + localName.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/** A folder with `files` (path → text); removed after `use` ran. */
function withFolder(files, use) {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'))
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    return use(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const build = {
  'manifest.json': '{"manifest_version":3}',
  'background.js': 'console.log(1)',
  'chunks/panel.js': 'export {}',
}
const entriesOf = (files) => Object.entries(files).map(([name, data]) => ({ name, data }))

describe('readZip', () => {
  it('reads stored and deflated files', () => {
    const files = readZip(
      zip([
        { name: 'a.txt', data: 'stored', method: 0 },
        { name: 'dir/b.txt', data: 'deflated '.repeat(50) },
      ]),
    )
    assert.deepEqual(
      [...files].map(([name, data]) => [name, data.toString()]),
      [
        ['a.txt', 'stored'],
        ['dir/b.txt', 'deflated '.repeat(50)],
      ],
    )
  })

  for (const [why, entry, message] of [
    ['an encrypted entry', { name: 'a.js', flags: 1 }, /a\.js: encrypted/],
    ['an unsupported method', { name: 'a.js', method: 12 }, /a\.js: compression method 12/],
    ['a wrong checksum', { name: 'a.js', data: 'x', crc: 1 }, /a\.js: checksum/],
    ['a parent folder', { name: '../a.js' }, /"\.\.\/a\.js": not a plain path/],
    ['a nested parent folder', { name: 'chunks/../../a.js' }, /not a plain path/],
    ['an absolute path', { name: '/etc/a.js' }, /not a plain path/],
    ['a backslash', { name: 'chunks\\a.js' }, /not a plain path/],
    ['a drive letter', { name: 'C:/a.js' }, /not a plain path/],
    ['an empty segment', { name: 'chunks//a.js' }, /not a plain path/],
    ['a dot segment', { name: './a.js' }, /not a plain path/],
    ['a control character', { name: 'a\n.js' }, /not a plain path/],
    ['a directory entry', { name: 'chunks/' }, /not a plain path/],
    ['a symbolic link', { name: 'a.js', madeBy: UNIX | 20, external: SYMLINK }, /a\.js: link/],
    ['a local name unlike the listed one', { name: 'a.js', localName: 'b.js' }, /a\.js: local/],
  ]) {
    it(`refuses ${why}`, () => {
      assert.throws(() => readZip(zip([entry])), message)
    })
  }

  it('refuses a name listed twice', () => {
    assert.throws(
      () =>
        readZip(
          zip([
            { name: 'a.js', data: '1' },
            { name: 'a.js', data: '2' },
          ]),
        ),
      /a\.js: listed twice/,
    )
  })

  it('refuses a file that is no zip, or is cut short', () => {
    assert.throws(() => readZip(Buffer.from('not a zip at all, just text')), /not a zip/)
    const whole = zip([{ name: 'a.js', data: 'x'.repeat(100) }])
    assert.throws(() => readZip(Buffer.concat([whole.subarray(0, 20), whole.subarray(-22)])))
  })
})

describe('checkZip', () => {
  it('passes a zip that holds exactly the build', () => {
    withFolder(build, (dir) => assert.deepEqual(checkZip(zip(entriesOf(build)), dir), []))
  })

  it('names what is missing, extra or changed', () => {
    withFolder(build, (dir) => {
      const shipped = { ...build, 'background.js': 'console.log(2)', 'extra.js': '' }
      delete shipped['chunks/panel.js']
      assert.deepEqual(checkZip(zip(entriesOf(shipped)), dir), [
        'background.js: differs from the build',
        'chunks/panel.js: missing from the zip',
        'extra.js: not in the build',
      ])
    })
  })

  it('reports a zip it cannot read instead of throwing', () => {
    withFolder(build, (dir) => {
      assert.deepEqual(checkZip(Buffer.from('nope'), dir), ['not a zip (no end of directory)'])
    })
  })
})

describe('check-zip.mjs', () => {
  /** Runs the script in a project folder with this package.json and these files. */
  function run(files) {
    return withFolder(files, (dir) => {
      const { status, stderr } = spawnSync(process.execPath, [SCRIPT], { cwd: dir })
      return { status, stderr: stderr.toString() }
    })
  }
  const pkg = JSON.stringify({ name: 'demo', version: '0.2.0' })
  const project = (zips) => ({
    'package.json': pkg,
    ...Object.fromEntries(Object.entries(build).map(([p, t]) => [`.output/chrome-mv3/${p}`, t])),
    ...zips,
  })

  it("checks the zip of the package's name and version", () => {
    const result = run(project({ '.output/demo-0.2.0-chrome.zip': zip(entriesOf(build)) }))
    assert.deepEqual(result, { status: 0, stderr: '' })
  })

  it('fails when that zip is missing, even with an older one next to it', () => {
    const result = run(project({ '.output/demo-0.1.0-chrome.zip': zip(entriesOf(build)) }))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /\.output\/demo-0\.2\.0-chrome\.zip not found: run pnpm zip/)
  })

  it('fails when the zip differs from the build', () => {
    const stale = { ...build, 'background.js': 'old' }
    const result = run(project({ '.output/demo-0.2.0-chrome.zip': zip(entriesOf(stale)) }))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /zip: background\.js: differs from the build/)
  })
})
