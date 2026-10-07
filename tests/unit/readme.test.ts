import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shortcutGroups } from '@/lib/shortcuts'

// The README repeats facts the code owns; these tests keep it in step. The permissions are
// held to the manifest check in scripts/check-manifest.test.mjs.
const readme = readFileSync('README.md', 'utf8')

/** The cells of every table row, trimmed (the separator rows left out). */
function tableRows(markdown: string): string[][] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[\s:|-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    )
}

describe('README', () => {
  it('lists every key of the Settings list, where it works and what it does', () => {
    const rows = tableRows(readme).map((cells) => cells.join(' | '))
    for (const group of shortcutGroups(false)) {
      for (const row of group.rows) {
        const keys = row.keys.map((key) => `\`${key}\``).join(' or ')
        expect(rows).toContain(`${group.title} | ${keys} | ${row.action}`)
      }
    }
  })

  it("shows the prompt as the formatter writes it: an excerpt of the spec's example", () => {
    const golden = readFileSync('tests/unit/golden/spec-example.md', 'utf8')
    const excerpt = /^```markdown\n([\s\S]*?)^```$/m.exec(readme)?.[1]
    expect(excerpt?.split('\n').length).toBeGreaterThan(10)
    expect(golden.startsWith(excerpt ?? '-')).toBe(true)
  })
})
