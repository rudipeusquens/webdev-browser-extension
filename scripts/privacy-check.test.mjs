import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  checkIdentity,
  checkPath,
  isAllowedEmail,
  maskEmail,
  parseDenylist,
  scanDiff,
  scanText,
} from './privacy-check.mjs'

// Fake personal data is assembled at runtime so this file itself passes the check.
const at = (local, domain) => `${local}@${domain}`
const personalEmail = at('jane.doe', 'mail.de')
const macHome = '/' + 'Users/jane'

describe('isAllowedEmail', () => {
  it('allows GitHub noreply addresses, including bot accounts', () => {
    assert.ok(isAllowedEmail(at('12345+octocat', 'users.noreply.github.com')))
    assert.ok(isAllowedEmail(at('314638461+some-app[bot]', 'users.noreply.github.com')))
    assert.ok(isAllowedEmail(at('noreply', 'github.com')))
  })

  it('allows reserved example domains', () => {
    assert.ok(isAllowedEmail(at('dev', 'example.com')))
    assert.ok(isAllowedEmail(at('dev', 'mail.example.org')))
    assert.ok(isAllowedEmail(at('dev', 'shop.test')))
  })

  it('rejects everything else', () => {
    assert.equal(isAllowedEmail(personalEmail), false)
    assert.equal(isAllowedEmail(at('dev', 'example.com.evil.de')), false)
    assert.equal(isAllowedEmail(at('someone', 'github.com')), false)
  })
})

describe('maskEmail', () => {
  it('hides local part and domain name', () => {
    assert.equal(maskEmail(personalEmail), 'j***@m***.de')
  })
})

describe('parseDenylist', () => {
  it('skips comments and blank lines, lowercases terms', () => {
    const { terms, rejected } = parseDenylist('# my data\n\nJane Doe\n  Main Street 5  \n', 'src')
    assert.deepEqual(
      terms.map((t) => t.term),
      ['jane doe', 'main street 5'],
    )
    assert.deepEqual(rejected, [])
    assert.deepEqual(terms[1], { term: 'main street 5', source: 'src', index: 2 })
  })

  it('rejects terms shorter than three characters', () => {
    const { terms, rejected } = parseDenylist('ab\nabc', 'src')
    assert.deepEqual(
      terms.map((t) => t.term),
      ['abc'],
    )
    assert.deepEqual(rejected, ['ab'])
  })
})

describe('scanText', () => {
  it('flags personal email addresses, masked', () => {
    const findings = scanText(`contact: ${personalEmail}`)
    assert.equal(findings.length, 1)
    assert.equal(findings[0].rule, 'email')
    assert.equal(findings[0].line, 1)
    assert.ok(!findings[0].detail.includes('jane'))
  })

  it('ignores npm specifiers and action refs that look like addresses', () => {
    const text = 'pnpm@11.6.0\nactions/checkout@v7.0.1\n@eslint/js\ntypescript@~6.0.3'
    assert.deepEqual(scanText(text), [])
  })

  it('flags home directories that carry a user name', () => {
    const findings = scanText(`at ${macHome}/projects/app/index.js`)
    assert.equal(findings.length, 1)
    assert.equal(findings[0].rule, 'home-path')
  })

  it('allows placeholder home directories', () => {
    assert.deepEqual(scanText('/' + 'Users/you/project\n/' + 'home/runner/work'), [])
  })

  it('flags Windows home directories', () => {
    const findings = scanText('C:\\' + 'Users\\jane\\project')
    assert.equal(findings[0]?.rule, 'home-path')
  })

  it('skips pattern rules on lines marked privacy-check: allow', () => {
    assert.deepEqual(scanText(`${personalEmail} // privacy-check: allow`), [])
  })

  it('flags denylist terms case-insensitively, without echoing them', () => {
    const { terms } = parseDenylist('Jane Doe', '.private/denylist.txt')
    const findings = scanText('line one\nAuthor: JANE DOE', { denylist: terms })
    assert.equal(findings.length, 1)
    assert.equal(findings[0].rule, 'denylist')
    assert.equal(findings[0].line, 2)
    assert.ok(!findings[0].detail.toLowerCase().includes('jane'))
    assert.match(findings[0].detail, /entry #1 .*denylist\.txt/)
  })

  it('does not let the allow marker hide denylist terms', () => {
    const { terms } = parseDenylist('Jane Doe', 'src')
    const findings = scanText('Jane Doe // privacy-check: allow', { denylist: terms })
    assert.equal(findings.length, 1)
  })

  it('can run the denylist alone (binary files)', () => {
    assert.deepEqual(scanText(personalEmail, { patterns: false }), [])
  })
})

describe('scanDiff', () => {
  it('reports denylist hits in added lines with commit, file and line', () => {
    const { terms } = parseDenylist('Jane Doe', 'src')
    const diff = [
      '\0commit 1234567890abcdef',
      'diff --git a/notes.md b/notes.md',
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -1,0 +10,2 @@',
      '+harmless',
      '+written by Jane Doe',
      '-removed Jane Doe line',
    ].join('\n')
    const findings = scanDiff(diff, terms)
    assert.equal(findings.length, 1)
    assert.equal(findings[0].location, 'commit 1234567 notes.md:11')
  })

  it('scans added lines that start with "++ " instead of taking them for a file header', () => {
    const { terms } = parseDenylist('Jane Doe', 'src')
    const diff = [
      '\0commit 1234567890abcdef',
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -0,0 +1,2 @@',
      '+first',
      '+++ Jane Doe',
    ].join('\n')
    const findings = scanDiff(diff, terms)
    assert.equal(findings.length, 1)
    assert.equal(findings[0].location, 'commit 1234567 notes.md:2')
  })
})

describe('checkPath', () => {
  it('rejects local-only, credential and capture files', () => {
    for (const path of [
      '.private/notes.md',
      '.env',
      '.env.local',
      'keys/extension.pem',
      'dist/extension.crx',
      'captures/session.har',
    ]) {
      assert.equal(checkPath(path)?.rule, 'forbidden-file', path)
    }
  })

  it('accepts regular files and .env.example', () => {
    for (const path of ['src/content.ts', '.env.example', 'docs/specs/x.md']) {
      assert.equal(checkPath(path), null, path)
    }
  })
})

describe('checkIdentity', () => {
  it('accepts noreply identities', () => {
    const ident = `Octo Cat <${at('1+octocat', 'users.noreply.github.com')}> 1700000000 +0200`
    assert.equal(checkIdentity(ident, 'author'), null)
  })

  it('rejects personal addresses', () => {
    const finding = checkIdentity(`Jane <${personalEmail}> 1700000000 +0200`, 'author')
    assert.equal(finding?.rule, 'identity')
  })
})
