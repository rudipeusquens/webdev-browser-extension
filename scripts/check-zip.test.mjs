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
const FIFO = (0o010644 << 16) >>> 0
const NO_ACCESS = (0o100000 << 16) >>> 0
const DOS_DIRECTORY = 0x10
const UTF8 = 0x800
// An Info-ZIP Unicode Path field: unzip tools that read it would name the file `b.js`.
const UNICODE_PATH = (() => {
  const name = Buffer.from('b.js')
  const field = Buffer.alloc(9)
  field.writeUInt16LE(0x7075, 0)
  field.writeUInt16LE(5 + name.length, 2)
  field.writeUInt8(1, 4)
  field.writeUInt32LE(crc32(Buffer.from('a.js')), 5)
  return Buffer.concat([field, name])
})()

/**
 * A zip of `entries`, written field by field so a test can break any one of them. An entry is
 * { name (text or bytes), data, method = 8 (deflate), body (the stored bytes), flags,
 * localFlags, crc, localCrc, madeBy, external, localName, extra, centralExtra, comment,
 * unlisted (a local entry without its directory record) }; `prefix` and `gap` put bytes before
 * the first entry and before the directory, `comment` is the zip's own.
 */
function zip(entries, { prefix = Buffer.alloc(0), gap = Buffer.alloc(0), comment = '' } = {}) {
  const parts = [prefix]
  const centrals = []
  let offset = prefix.length
  let listed = 0
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '')
    const method = entry.method ?? 8
    const body = entry.body ?? (method === 8 ? deflateRawSync(data) : data)
    const name = Buffer.from(entry.name)
    const localName = Buffer.from(entry.localName ?? entry.name)
    const extra = entry.extra ?? Buffer.alloc(0)
    const centralExtra = entry.centralExtra ?? extra
    const fileComment = Buffer.from(entry.comment ?? '')
    const flags = entry.flags ?? 0
    const crc = entry.crc ?? crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.localFlags ?? flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(entry.localCrc ?? crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(localName.length, 26)
    local.writeUInt16LE(extra.length, 28)
    parts.push(local, localName, extra, body)
    if (!entry.unlisted) {
      const central = Buffer.alloc(46)
      central.writeUInt32LE(0x02014b50, 0)
      central.writeUInt16LE(entry.madeBy ?? 20, 4)
      central.writeUInt16LE(20, 6)
      central.writeUInt16LE(flags, 8)
      central.writeUInt16LE(method, 10)
      central.writeUInt32LE(crc, 16)
      central.writeUInt32LE(body.length, 20)
      central.writeUInt32LE(data.length, 24)
      central.writeUInt16LE(name.length, 28)
      central.writeUInt16LE(centralExtra.length, 30)
      central.writeUInt16LE(fileComment.length, 32)
      central.writeUInt32LE(entry.external ?? 0, 38)
      central.writeUInt32LE(offset, 42)
      centrals.push(central, name, centralExtra, fileComment)
      listed++
    }
    offset += local.length + localName.length + extra.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const zipComment = Buffer.from(comment)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(listed, 8)
  end.writeUInt16LE(listed, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset + gap.length, 16)
  end.writeUInt16LE(zipComment.length, 20)
  return Buffer.concat([...parts, gap, directory, end, zipComment])
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
    ['a link from another system', { name: 'a.js', external: SYMLINK }, /a\.js: link/],
    ['a named pipe', { name: 'a.js', madeBy: UNIX | 20, external: FIFO }, /a\.js: not a plain/],
    [
      'a file nobody may read',
      { name: 'a.js', madeBy: UNIX | 20, external: NO_ACCESS },
      /a\.js: not readable/,
    ],
    ['a directory by its attribute', { name: 'a', external: DOS_DIRECTORY }, /a: directory/],
    ['a local name unlike the listed one', { name: 'a.js', localName: 'b.js' }, /a\.js: local/],
    ['flags only the local header has', { name: 'a.js', localFlags: 1 }, /a\.js: local header/],
    ['a checksum only the local header has', { name: 'a.js', localCrc: 7 }, /a\.js: local header/],
    ['an extra field', { name: 'a.js', extra: UNICODE_PATH }, /a\.js: extra field/],
    [
      'an extra field in the directory only',
      { name: 'a.js', centralExtra: UNICODE_PATH },
      /a\.js: extra field/,
    ],
    [
      'an extra field in the local header only',
      { name: 'a.js', extra: UNICODE_PATH, centralExtra: Buffer.alloc(0) },
      /a\.js: extra field/,
    ],
    ['a file comment', { name: 'a.js', comment: 'note' }, /a\.js: comment/],
    ['a non-ASCII name without the UTF-8 flag', { name: 'é.js' }, /not marked UTF-8/],
    [
      'a name that is no UTF-8',
      { name: Buffer.from([0xff, 0x2e, 0x6a, 0x73]), flags: UTF8 },
      /not UTF-8/,
    ],
    [
      'data that inflates beyond its size',
      { name: 'a.js', data: 'x', body: deflateRawSync('x'.repeat(1000)) },
      /a\.js: does not inflate to its size/,
    ],
    [
      'data that does not inflate',
      { name: 'a.js', data: 'x', body: Buffer.from([0xff, 0xff, 0xff]) },
      /a\.js: does not inflate/,
    ],
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

  it('stops inflating at the size the directory lists', () => {
    const bomb = zip([{ name: 'a.js', data: 'x', body: deflateRawSync(Buffer.alloc(1 << 20)) }])
    assert.throws(
      () => readZip(bomb),
      (error) => error.cause?.code === 'ERR_BUFFER_TOO_LARGE' && /a\.js: does not/.test(error),
    )
  })

  it('reads a UTF-8 name that says so', () => {
    assert.deepEqual([...readZip(zip([{ name: 'é.js', data: '1', flags: UTF8 }])).keys()], ['é.js'])
  })

  it('refuses names that differ only in case or Unicode form', () => {
    const twins = (a, b) =>
      zip([
        { name: a, data: '1', flags: UTF8 },
        { name: b, data: '2', flags: UTF8 },
      ])
    assert.throws(() => readZip(twins('A.js', 'a.js')), /a\.js: same file as A\.js/)
    assert.throws(() => readZip(twins('\u00e9.js', 'e\u0301.js')), /same file as/)
  })

  it('refuses bytes the directory does not list: before, between and after the files', () => {
    const a = { name: 'a.js', data: '1' }
    const hidden = { name: 'evil.js', data: '2', unlisted: true }
    assert.throws(() => readZip(zip([hidden, a])), /a\.js: not where the files before it end/)
    assert.throws(() => readZip(zip([a, hidden])), /unlisted bytes before the directory/)
    assert.throws(() => readZip(zip([a], { prefix: Buffer.from('junk') })), /a\.js: not where/)
    assert.throws(() => readZip(zip([a], { gap: Buffer.from('junk') })), /unlisted bytes/)
  })

  it('refuses a comment on the zip', () => {
    assert.throws(() => readZip(zip([{ name: 'a.js' }], { comment: 'note' })), /zip comment/)
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

  it('fails with a message when the build folder is missing', () => {
    const result = run({
      'package.json': pkg,
      '.output/demo-0.2.0-chrome.zip': zip(entriesOf(build)),
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /^zip: \.output\/chrome-mv3 not found: run pnpm zip\n$/)
  })

  it('fails when the zip differs from the build', () => {
    const stale = { ...build, 'background.js': 'old' }
    const result = run(project({ '.output/demo-0.2.0-chrome.zip': zip(entriesOf(stale)) }))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /zip: background\.js: differs from the build/)
  })
})
