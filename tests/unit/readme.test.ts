import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shortcutGroups } from '@/lib/shortcuts'

// The README repeats facts the code owns; these tests keep it in step. The permissions are
// held to the manifest check in scripts/check-manifest.test.mjs.
const readme = readFileSync('README.md', 'utf8')

/** The rows of the table whose header starts with `first`, as trimmed cells. */
function table(markdown: string, first: string): string[][] {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => new RegExp(`^\\|\\s*${first}\\s*\\|`).test(line))
  expect(start, `a table headed "${first}"`).toBeGreaterThanOrEqual(0)
  const rows: string[][] = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    rows.push(
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    )
  }
  return rows
}

describe('README', () => {
  it('lists the keys of the Settings list, where they work and what they do, and no others', () => {
    const rows = table(readme, 'Where').map((cells) => cells.join(' | '))
    const keys = shortcutGroups(false).flatMap((group) =>
      group.rows.map(
        (row) =>
          `${group.title} | ${row.keys.map((key) => `\`${key}\``).join(' or ')} | ${row.action}`,
      ),
    )
    expect(rows).toEqual(keys)
  })

  it('shows images that exist, and every screenshot pnpm screenshots takes', () => {
    const shown = [...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img [^>]*src="([^"]+)"/g)].flatMap(
      (m) => m[1] ?? m[2] ?? [],
    )
    for (const path of shown) expect(existsSync(path), path).toBe(true)
    const screenshots = readdirSync('docs/images').map((name) => `docs/images/${name}`)
    expect(screenshots.length).toBeGreaterThan(0)
    for (const path of screenshots) expect(shown).toContain(path)
  })

  it("shows the prompt as the formatter writes it: an excerpt of the spec's example", () => {
    const golden = readFileSync('tests/unit/golden/spec-example.md', 'utf8')
    const excerpt = /^```markdown\n([\s\S]*?)^```$/m.exec(readme)?.[1]
    expect(excerpt?.split('\n').length).toBeGreaterThan(10)
    expect(golden.startsWith(excerpt ?? '-')).toBe(true)
  })
})
