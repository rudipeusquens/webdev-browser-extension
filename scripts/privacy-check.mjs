#!/usr/bin/env node
// Personal-data guard for this public repository (docs/public-repo-policy.md).
// secretlint and gitleaks find credentials; this script finds what they don't:
// real email addresses, home directories that carry a user name, files that
// must stay local, the owner's personal denylist, and commit identities.
//
//   node scripts/privacy-check.mjs <files…>       staged files (lint-staged)
//   node scripts/privacy-check.mjs --identity     author/committer of the next commit
//   node scripts/privacy-check.mjs --message <f>  commit message (commit-msg hook)
//   node scripts/privacy-check.mjs --all          every tracked file + the whole history (CI)
//   node scripts/privacy-check.mjs --push         the commits and refs a push sends (pre-push
//                                                 hook, refs on stdin): also commits that
//                                                 skipped pre-commit (rebase, cherry-pick, am)
//
// Denylist terms come from `.private/denylist.txt` (local, gitignored) and the
// PRIVACY_DENYLIST env var (a repository secret in CI); one term per line.
// Findings never echo a denylist term or a full address — CI logs are public.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const ALLOW_MARKER = 'privacy-check: allow'

const ALLOWED_EMAILS = new Set(['noreply@github.com', 'git@github.com', 'noreply@anthropic.com'])
// Reserved for documentation and tests (RFC 2606) plus GitHub's noreply domain.
const ALLOWED_DOMAINS = ['users.noreply.github.com', 'example.com', 'example.org', 'example.net']
const ALLOWED_TLDS = ['example', 'test', 'invalid', 'localhost']

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
// macOS/Linux/Windows home directories, e.g. "/Users/<name>/" — the name is
// often the owner's real name. Placeholders like "you" or "runner" are fine.
const HOME_RE = /(?:\/Users\/|\/home\/|\b[A-Za-z]:\\+Users\\+)([^\s/\\'"`<>$]+)/g
const HOME_PLACEHOLDERS = new Set([
  'coder',
  'default',
  'me',
  'name',
  'node',
  'public',
  'runner',
  'shared',
  'ubuntu',
  'user',
  'username',
  'you',
  'yourname',
])

const FORBIDDEN_PATHS = [
  { re: /(^|\/)\.private\//, why: '.private/ is local-only material' },
  { re: /(^|\/)\.env(\.(?!example$)[^/]*)?$/, why: 'env files hold credentials' },
  { re: /\.(pem|p12|pfx)$/i, why: 'signing keys never leave the machine' },
  { re: /\.(crx|zip)$/i, why: 'packed extensions are build output' },
  { re: /(^|\/)\.(output|wxt)\//, why: 'build output and generated files stay local' },
  { re: /(^|\/)\.superpowers\//, why: 'agent workspaces stay local' },
  { re: /\.har$/i, why: 'HAR captures contain real URLs, cookies and headers' },
  { re: /(^|\/)id_(rsa|ecdsa|ed25519)(\.pub)?$/, why: 'SSH keys never belong in a repo' },
]

export function isAllowedEmail(email) {
  const lower = email.toLowerCase()
  if (ALLOWED_EMAILS.has(lower)) return true
  const domain = lower.slice(lower.lastIndexOf('@') + 1)
  if (ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true
  return ALLOWED_TLDS.includes(domain.slice(domain.lastIndexOf('.') + 1))
}

export function maskEmail(email) {
  const [local, domain] = [
    email.slice(0, email.lastIndexOf('@')),
    email.slice(email.lastIndexOf('@') + 1),
  ]
  const dot = domain.lastIndexOf('.')
  return `${local[0]}***@${domain[0]}***${domain.slice(dot)}`
}

export function parseDenylist(text, source) {
  const terms = []
  const rejected = []
  for (const raw of text.split(/\r?\n/)) {
    const term = raw.trim().toLowerCase()
    if (!term || term.startsWith('#')) continue
    if (term.length < 3) {
      rejected.push(term)
      continue
    }
    terms.push({ term, source, index: terms.length + 1 })
  }
  return { terms, rejected }
}

function denylistHits(line, denylist) {
  const lower = line.toLowerCase()
  return denylist
    .filter(({ term }) => lower.includes(term))
    .map(({ source, index }) => ({
      rule: 'denylist',
      detail: `matches entry #${index} of ${source}`,
    }))
}

export function scanText(text, { denylist = [], patterns = true } = {}) {
  const findings = []
  text.split(/\r?\n/).forEach((line, i) => {
    const at = { line: i + 1 }
    for (const hit of denylistHits(line, denylist)) findings.push({ ...at, ...hit })
    if (!patterns || line.includes(ALLOW_MARKER)) return
    for (const [email] of line.matchAll(EMAIL_RE)) {
      if (!isAllowedEmail(email)) {
        findings.push({
          ...at,
          rule: 'email',
          detail: `personal email address ${maskEmail(email)}`,
        })
      }
    }
    for (const [, name] of line.matchAll(HOME_RE)) {
      if (!HOME_PLACEHOLDERS.has(name.toLowerCase())) {
        findings.push({ ...at, rule: 'home-path', detail: 'home directory with a user name' })
      }
    }
  })
  return findings
}

// Every rule over the added lines and the paths of `git log -p` output, so what was committed
// and later deleted is still found — the history is public too.
export function scanDiff(diff, denylist) {
  const findings = []
  let commit = ''
  let file = ''
  let lineNo = 0
  let prev = ''
  for (const line of diff.split('\n')) {
    const header = prev.startsWith('--- ')
    prev = line
    if (line.startsWith('\0commit ')) {
      commit = line.slice(8, 15)
    } else if (header && line.startsWith('+++ ')) {
      file = line.replace(/^\+\+\+ (b\/)?/, '')
      if (file === '/dev/null') continue
      const forbidden = checkPath(file)
      if (forbidden) findings.push({ location: `commit ${commit} ${file}`, ...forbidden })
      for (const hit of denylistHits(file, denylist)) {
        findings.push({ location: `commit ${commit} (a path)`, ...hit })
      }
    } else if (line.startsWith('@@')) {
      lineNo = Number(/\+(\d+)/.exec(line)?.[1] ?? 0)
    } else if (line.startsWith('+')) {
      for (const f of scanText(line.slice(1), { denylist })) {
        findings.push({
          location: `commit ${commit} ${file}:${lineNo}`,
          rule: f.rule,
          detail: f.detail,
        })
      }
      lineNo++
    } else if (!line.startsWith('-')) {
      lineNo++
    }
  }
  return findings
}

/**
 * What a push sends, from the lines git gives the pre-push hook ("<local ref> <local sha>
 * <remote ref> <remote sha>"): the revisions of the commits each ref adds — since the remote's
 * commit, or everything no remote has for a new ref; none for a deletion.
 */
export function pushedRanges(text) {
  const zero = /^0+$/
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/)
      const refs = [localRef, remoteRef]
      if (zero.test(localSha)) return { refs, revs: [] }
      if (zero.test(remoteSha)) return { refs, revs: [localSha, '--not', '--remotes'] }
      return { refs, revs: [`${remoteSha}..${localSha}`] }
    })
}

export function checkPath(path) {
  const hit = FORBIDDEN_PATHS.find(({ re }) => re.test(path))
  return hit ? { rule: 'forbidden-file', detail: hit.why } : null
}

// `ident` is `git var GIT_AUTHOR_IDENT` output: "Name <email> 1700000000 +0200".
export function checkIdentity(ident, role) {
  const email = /<([^>]*)>/.exec(ident)?.[1] ?? ''
  if (isAllowedEmail(email)) return null
  return {
    rule: 'identity',
    detail: `${role} email ${email.includes('@') ? maskEmail(email) : '(empty)'} is not a GitHub noreply address`,
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 ** 3 }).replace(/\n$/, '')

function loadDenylist(root) {
  const sources = []
  try {
    sources.push(
      parseDenylist(readFileSync(`${root}/.private/denylist.txt`, 'utf8'), '.private/denylist.txt'),
    )
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (process.env.PRIVACY_DENYLIST) {
    sources.push(parseDenylist(process.env.PRIVACY_DENYLIST, 'PRIVACY_DENYLIST'))
  }
  for (const { rejected } of sources) {
    if (rejected.length)
      console.warn(
        `privacy-check: ignored ${rejected.length} denylist term(s) shorter than 3 characters`,
      )
  }
  return sources.flatMap(({ terms }) => terms)
}

function scanFile(root, file, denylist) {
  const path = isAbsolute(file) ? relative(root, file) : file
  const findings = []
  const forbidden = checkPath(path)
  if (forbidden) findings.push({ location: path, ...forbidden })
  let buffer
  try {
    buffer = readFileSync(`${root}/${path}`)
  } catch (error) {
    if (error.code === 'ENOENT') return findings
    throw error
  }
  // Binary files (images may carry EXIF names) get the denylist only.
  const binary = buffer.subarray(0, 8000).includes(0)
  const text = buffer.toString(binary ? 'latin1' : 'utf8')
  for (const f of scanText(text, { denylist, patterns: !binary })) {
    findings.push({ location: `${path}:${f.line}`, rule: f.rule, detail: f.detail })
  }
  return findings
}

/**
 * Identities, names, messages, added lines and paths of the commits `revs` selects (`git log`
 * revisions); a merge counts with what it changed against its first parent.
 */
function scanCommits(revs, denylist) {
  if (revs.length === 0) return []
  const findings = []
  const log = git('log', '--format=%x00%H%x1f%ae%x1f%ce%x1f%an%x1f%cn%x1f%B', ...revs)
  for (const entry of log.split('\0').slice(1)) {
    const [sha, authorEmail, committerEmail, authorName, committerName, body] = entry.split('\x1f')
    const at = `commit ${sha.slice(0, 7)}`
    for (const [role, email] of [
      ['author', authorEmail],
      ['committer', committerEmail],
    ]) {
      const f = checkIdentity(`<${email}>`, role)
      if (f) findings.push({ location: at, ...f })
    }
    for (const name of [authorName, committerName]) {
      for (const hit of denylistHits(name, denylist))
        findings.push({ location: `${at} (name)`, ...hit })
    }
    for (const f of scanText(body, { denylist })) {
      findings.push({ location: `${at} (message):${f.line}`, rule: f.rule, detail: f.detail })
    }
  }
  const diff = git(
    'log',
    '-p',
    '--diff-merges=first-parent',
    '--no-color',
    '--no-ext-diff',
    '-U0',
    '--format=%x00commit %H',
    ...revs,
  )
  findings.push(...scanDiff(diff, denylist))
  return findings
}

function scanHistory(denylist) {
  try {
    git('rev-parse', '--verify', '--quiet', 'HEAD')
  } catch {
    return [] // no commits yet
  }
  return scanCommits(['HEAD'], denylist)
}

const IDENTITY_HELP = `
Commits to this public repo must use your GitHub noreply address:
  1. GitHub → Settings → Emails: copy the "…@users.noreply.github.com" address,
     tick "Keep my email addresses private" and
     "Block command line pushes that expose my email".
  2. git config user.email "<id>+<login>@users.noreply.github.com"`

const FINDINGS_HELP = `
Personal data must never reach this public repository (docs/public-repo-policy.md).
  • Remove it. Synthetic examples use example.com addresses and placeholder names.
  • A false positive in an example line can carry the marker "${ALLOW_MARKER}"
    (email/home-path rules only; denylist hits cannot be suppressed).
  • Already committed? Fix the commit before it is pushed (git commit --amend,
    git rebase). Once pushed, history must be rewritten.`

function main(argv) {
  const root = git('rev-parse', '--show-toplevel')
  const denylist = loadDenylist(root)
  let findings = []
  let help = FINDINGS_HELP

  if (argv[0] === '--identity') {
    help = IDENTITY_HELP
    for (const [role, variable] of [
      ['author', 'GIT_AUTHOR_IDENT'],
      ['committer', 'GIT_COMMITTER_IDENT'],
    ]) {
      const f = checkIdentity(git('var', variable), role)
      if (f) findings.push({ location: 'git identity', ...f })
    }
  } else if (argv[0] === '--message') {
    if (!argv[1]) {
      console.error('usage: privacy-check.mjs --message <file>')
      return 2
    }
    // Comment lines are stripped by git before the message is stored.
    const message = readFileSync(argv[1], 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
    findings = scanText(message, { denylist }).map((f) => ({
      location: `commit message:${f.line}`,
      rule: f.rule,
      detail: f.detail,
    }))
  } else if (argv[0] === '--push') {
    help = `${FINDINGS_HELP}\n${IDENTITY_HELP}`
    for (const { refs, revs } of pushedRanges(readFileSync(0, 'utf8'))) {
      for (const ref of refs) {
        for (const f of scanText(ref, { denylist })) findings.push({ location: `ref ${ref}`, ...f })
      }
      findings.push(...scanCommits(revs, denylist))
    }
  } else if (argv[0] === '--all') {
    const files = git('ls-files', '-z').split('\0').filter(Boolean)
    findings = files.flatMap((file) => scanFile(root, file, denylist))
    for (const file of files) {
      for (const hit of denylistHits(file, denylist))
        findings.push({ location: '(a path)', ...hit })
    }
    findings.push(...scanHistory(denylist))
    if (!denylist.length) {
      console.log('privacy-check: no denylist configured — pattern rules only')
    }
  } else {
    findings = argv.flatMap((file) => scanFile(root, file, denylist))
  }

  if (!findings.length) return 0
  for (const { location, rule, detail } of findings) {
    console.error(`${location}: [${rule}] ${detail}`)
  }
  console.error(help)
  return 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2))
}
