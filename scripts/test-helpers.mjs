import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A temp folder named `prefix-…` with `files` (path → text); removed after `use` ran. */
export function withFolder(prefix, files, use) {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
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
