/**
 * The entries of a ZIP file of stored (uncompressed) entries, read from its central
 * directory: what src/lib/zip.ts writes. Used by the unit and the end-to-end tests.
 */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  if (view.getUint32(end, true) !== 0x06054b50) throw new Error('no end of central directory')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('no central entry')
    if (view.getUint16(at + 10, true) !== 0) throw new Error('compressed entry')
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const local = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    entries.set(name, bytes.subarray(data, data + size))
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return entries
}
