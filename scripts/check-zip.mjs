#!/usr/bin/env node
// What ships is what was checked: `pnpm zip` packs .output/chrome-mv3 after the manifest and
// bundle checks ran on it, and this check reads the zip back and compares it with that folder,
// file by file and byte for byte. Plain files only: stored or deflated, not encrypted, no link,
// no directory entry, no name that leads outside the folder it is unpacked into. Node's own
// modules only; the zip format is read here.
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
const UNIX = 3
const FILE_TYPE = 0o170000
const LINK = 0o120000

/**
 * A relative path of plain segments: no `.` or `..`, no empty segment, no backslash, colon or
 * control character, no leading slash and no trailing one (a directory entry).
 */
const PLAIN = /^(?:(?!\.\.?\/)[^/\\:\p{Cc}]+\/)*(?!\.\.?$)[^/\\:\p{Cc}]+$/u

/** A zip's files, name → bytes, in the order of its central directory. Throws on the rest. */
export function readZip(zip) {
  const end = findEnd(zip)
  const count = zip.readUInt16LE(end + 10)
  const size = zip.readUInt32LE(end + 12)
  let at = zip.readUInt32LE(end + 16)
  if (zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 8) !== count) {
    throw new Error('split over several disks')
  }
  if (count === 0xffff || size === 0xffffffff || at === 0xffffffff) throw new Error('zip64')
  if (at + size > end) throw new Error('central directory out of range')
  const files = new Map()
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== CENTRAL) throw new Error('broken central directory')
    const madeBy = zip.readUInt16LE(at + 4)
    const flags = zip.readUInt16LE(at + 8)
    const method = zip.readUInt16LE(at + 10)
    const crc = zip.readUInt32LE(at + 16)
    const packed = zip.readUInt32LE(at + 20)
    const length = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const next = at + 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
    const external = zip.readUInt32LE(at + 38)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    at = next

    if (!PLAIN.test(name)) throw new Error(`${JSON.stringify(name)}: not a plain path`)
    if (files.has(name)) throw new Error(`${name}: listed twice`)
    if (flags & ENCRYPTED) throw new Error(`${name}: encrypted`)
    if (method !== STORED && method !== DEFLATED) {
      throw new Error(`${name}: compression method ${method}`)
    }
    if (madeBy >> 8 === UNIX && ((external >>> 16) & FILE_TYPE) === LINK) {
      throw new Error(`${name}: link`)
    }
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL) {
      throw new Error(`${name}: no local header`)
    }
    // Unzip tools differ in which of the two names they use: they must agree.
    const localName = zip.readUInt16LE(local + 26)
    const start = local + 30 + localName + zip.readUInt16LE(local + 28)
    if (zip.toString('utf8', local + 30, local + 30 + localName) !== name) {
      throw new Error(`${name}: local header names another file`)
    }
    if (start + packed > zip.length) throw new Error(`${name}: cut short`)
    const body = zip.subarray(start, start + packed)
    const data = method === DEFLATED ? inflateRawSync(body) : body
    if (data.length !== length || crc32(data) !== crc) throw new Error(`${name}: checksum`)
    files.set(name, data)
  }
  return files
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
  const errors = existsSync(path)
    ? checkZip(readFileSync(path), dir)
    : [`${path} not found: run pnpm zip`]
  for (const error of errors) console.error(`zip: ${error}`)
  process.exitCode = errors.length ? 1 : 0
}
