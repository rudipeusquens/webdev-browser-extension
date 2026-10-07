#!/usr/bin/env node
// The built extension ships what was reviewed: no source maps, no eval or new Function, no
// code of a dev server, and no host outside the list below (CI after the build, and
// `pnpm zip`). A dependency that brings any of these fails the build instead of shipping.
//
//   node scripts/check-bundle.mjs [dir]   default: .output/chrome-mv3

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

// Where the extension connects (OpenRouter) and what libraries only name in their code:
// XML namespaces, links in Vue's and Tailwind's messages, MDN in a comment.
const HOSTS = new Set([
  'openrouter.ai',
  'www.w3.org',
  'vuejs.org',
  'tailwindcss.com',
  'developer.mozilla.org',
])
const TEXT = /\.(js|mjs|css|html|json|svg|txt)$/

const RULES = [
  { re: /sourceMappingURL/, why: 'source map reference' },
  { re: /\beval\s*\(|\bnew\s+Function\s*\(/, why: 'eval or new Function' },
  { re: /\bwss?:\/\/|\b(localhost|127\.0\.0\.1)(:\d+)?\b|@vite\/client/, why: 'dev server code' },
]

function filesIn(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

export function checkBundle(dir) {
  const errors = []
  for (const path of filesIn(dir)) {
    const file = relative(dir, path)
    if (file.endsWith('.map')) {
      errors.push(`${file}: source map file`)
      continue
    }
    if (!TEXT.test(file)) continue
    const text = readFileSync(path, 'utf8')
    for (const { re, why } of RULES) if (re.test(text)) errors.push(`${file}: ${why}`)
    for (const [, host] of text.matchAll(/\bhttps?:\/\/([A-Za-z0-9.-]+)/g)) {
      if (!HOSTS.has(host.toLowerCase())) errors.push(`${file}: unknown host ${host}`)
    }
  }
  return [...new Set(errors)]
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? '.output/chrome-mv3'
  const errors = checkBundle(dir)
  for (const error of errors) console.error(error)
  process.exitCode = errors.length > 0 ? 1 : 0
}
