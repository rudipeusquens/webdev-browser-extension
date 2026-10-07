#!/usr/bin/env node
// What ships is what was checked: `pnpm zip` packs .output/chrome-mv3 after the manifest and
// bundle checks ran on it, and this check reads the zip back and compares it with that folder,
// file by file and byte for byte. Plain, readable files only: stored or deflated, not
// encrypted, no link, no directory, no name that leads outside the folder it is unpacked into
// or that names another file there. And only the layout WXT's zipper writes, so every unzip
// tool unpacks what was compared: the files back to back from the first byte, each local header
// repeating its directory record, then the directory and its end; no extra field and no
// comment (an extra field can rename a file in some tools). Node's own modules only; the zip
// format is read here.
//
//   node scripts/check-zip.mjs [zip] [dir]
//   default: the zip WXT names after package.json, .output/<name>-<version>-chrome.zip, and
//   .output/chrome-mv3

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { crc32, inflateRawSync } from 'node:zlib'

const END = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const STORED = 0
const DEFLATED = 8
// Bit 0: encrypted; bit 6: strong encryption; bit 13: encrypted central directory.
const ENCRYPTED = 0x0001 | 0x0040 | 0x2000
const UTF8_NAME = 0x0800
// The Unix file type and mode in the high half of the external attributes, the MS-DOS
// attributes in the low byte. Read whatever system the zip names: a tool may honour either.
const FILE_TYPE = 0o170000
const REGULAR = 0o100000
const LINK = 0o120000
const OWNER_READS = 0o400
const DOS_DIRECTORY = 0x10

/**
 * A relative path of plain segments: no `.` or `..`, no empty segment, no backslash, colon or
 * control character, no leading slash and no trailing one (a directory entry).
 */
const PLAIN = /^(?:(?!\.\.?\/)[^/\\:\p{Cc}]+\/)*(?!\.\.?$)[^/\\:\p{Cc}]+$/u
const utf8 = new TextDecoder('utf-8', { fatal: true })

/** A zip's files, name → bytes, in the order of its central directory. Throws on the rest. */
export function readZip(zip) {
  const end = findEnd(zip)
  const count = zip.readUInt16LE(end + 10)
  const size = zip.readUInt32LE(end + 12)
  const directory = zip.readUInt32LE(end + 16)
  if (
    zip.readUInt16LE(end + 4) !== 0 ||
    zip.readUInt16LE(end + 6) !== 0 ||
    zip.readUInt16LE(end + 8) !== count
  ) {
    throw new Error('split over several disks')
  }
  if (count === 0xffff || size === 0xffffffff || directory === 0xffffffff) throw new Error('zip64')
  if (zip.readUInt16LE(end + 20) !== 0) throw new Error('zip comment')
  if (directory + size !== end) throw new Error('broken central directory')
  const files = new Map()
  const folded = new Map()
  let at = directory
  // Where the next file must start: right after the one before, the first at byte 0.
  let next = 0
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== CENTRAL) {
      throw new Error('broken central directory')
    }
    const flags = zip.readUInt16LE(at + 8)
    const method = zip.readUInt16LE(at + 10)
    const crc = zip.readUInt32LE(at + 16)
    const packed = zip.readUInt32LE(at + 20)
    const length = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const extra = zip.readUInt16LE(at + 30)
    const comment = zip.readUInt16LE(at + 32)
    const external = zip.readUInt32LE(at + 38)
    const local = zip.readUInt32LE(at + 42)
    const rawName = zip.subarray(at + 46, at + 46 + nameLength)
    at += 46 + nameLength + extra + comment
    if (at > end) throw new Error('broken central directory')
    const name = decodeName(rawName, flags)

    if (!PLAIN.test(name)) throw new Error(`${JSON.stringify(name)}: not a plain path`)
    if (files.has(name)) throw new Error(`${name}: listed twice`)
    // A file system that ignores case or Unicode form would unpack both into one file.
    const key = name.normalize('NFC').toLowerCase()
    if (folded.has(key)) throw new Error(`${name}: same file as ${folded.get(key)}`)
    folded.set(key, name)
    if (extra) throw new Error(`${name}: extra field`)
    if (comment) throw new Error(`${name}: comment`)
    if (flags & ENCRYPTED) throw new Error(`${name}: encrypted`)
    if (method !== STORED && method !== DEFLATED) {
      throw new Error(`${name}: compression method ${method}`)
    }
    plainFile(name, external)

    if (local !== next) throw new Error(`${name}: not where the files before it end`)
    if (local + 30 > directory || zip.readUInt32LE(local) !== LOCAL) {
      throw new Error(`${name}: no local header`)
    }
    if (
      zip.readUInt16LE(local + 6) !== flags ||
      zip.readUInt16LE(local + 8) !== method ||
      zip.readUInt32LE(local + 14) !== crc ||
      zip.readUInt32LE(local + 18) !== packed ||
      zip.readUInt32LE(local + 22) !== length
    ) {
      throw new Error(`${name}: local header differs from the directory`)
    }
    const localName = zip.readUInt16LE(local + 26)
    if (zip.readUInt16LE(local + 28)) throw new Error(`${name}: extra field`)
    // Unzip tools differ in which of the two names they use: they must agree.
    if (!zip.subarray(local + 30, local + 30 + localName).equals(rawName)) {
      throw new Error(`${name}: local header names another file`)
    }
    const start = local + 30 + localName
    next = start + packed
    if (next > directory) throw new Error(`${name}: cut short`)
    const data = contents(name, zip.subarray(start, next), method, length)
    if (data.length !== length) throw new Error(`${name}: does not inflate to its size`)
    if (crc32(data) !== crc) throw new Error(`${name}: checksum`)
    files.set(name, data)
  }
  if (at !== end) throw new Error('broken central directory')
  if (next !== directory) throw new Error('unlisted bytes before the directory')
  return files
}

/** The name as the flag says it is written: UTF-8, or else ASCII (where CP437 agrees). */
function decodeName(bytes, flags) {
  if (!(flags & UTF8_NAME)) {
    if (bytes.some((byte) => byte > 0x7f)) {
      throw new Error(`${JSON.stringify(bytes.toString('latin1'))}: name not marked UTF-8`)
    }
    return bytes.toString('ascii')
  }
  try {
    return utf8.decode(bytes)
  } catch {
    throw new Error(`${JSON.stringify(bytes.toString('latin1'))}: name not UTF-8`)
  }
}

/** Throws unless the attributes describe a plain, readable file (or say nothing). */
function plainFile(name, external) {
  const mode = external >>> 16
  const type = mode & FILE_TYPE
  if (type === LINK) throw new Error(`${name}: link`)
  if (external & DOS_DIRECTORY) throw new Error(`${name}: directory`)
  if (type !== 0 && type !== REGULAR) throw new Error(`${name}: not a plain file`)
  if (type === REGULAR && !(mode & OWNER_READS)) throw new Error(`${name}: not readable`)
}

/** The stored bytes, or the inflated ones: never more than the directory says. */
function contents(name, body, method, length) {
  if (method === STORED) return body
  try {
    return inflateRawSync(body, { maxOutputLength: Math.max(length, 1) })
  } catch (error) {
    if (error.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`${name}: does not inflate to its size`, { cause: error })
    }
    throw new Error(`${name}: does not inflate (${error.message})`, { cause: error })
  }
}

/** The end of central directory record: the last one, after which only its comment follows. */
function findEnd(zip) {
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === END && at + 22 + zip.readUInt16LE(at + 20) === zip.length) {
      return at
    }
  }
  throw new Error('not a zip (no end of directory)')
}

/** The folder's files, relative path with `/` → bytes; anything else is reported. */
function folder(dir) {
  const files = new Map()
  const errors = []
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const path = relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/')
    if (entry.isFile()) files.set(path, readFileSync(join(dir, path)))
    else if (!entry.isDirectory()) errors.push(`${path}: not a plain file in the build`)
  }
  return { files, errors }
}

/** What differs between the zip and the build folder; empty when they hold the same files. */
export function checkZip(zip, dir) {
  let shipped
  try {
    shipped = readZip(zip)
  } catch (error) {
    return [error.message]
  }
  const { files: built, errors } = folder(dir)
  for (const [name, data] of shipped) {
    if (!built.has(name)) errors.push(`${name}: not in the build`)
    else if (!data.equals(built.get(name))) errors.push(`${name}: differs from the build`)
  }
  for (const name of built.keys()) {
    if (!shipped.has(name)) errors.push(`${name}: missing from the zip`)
  }
  return errors.sort()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const path = process.argv[2] ?? `.output/${name}-${version}-chrome.zip`
  const dir = process.argv[3] ?? '.output/chrome-mv3'
  const missing = [path, dir].find((file) => !existsSync(file))
  const errors = missing
    ? [`${missing} not found: run pnpm zip`]
    : checkZip(readFileSync(path), dir)
  for (const error of errors) console.error(`zip: ${error}`)
  process.exitCode = errors.length ? 1 : 0
}
