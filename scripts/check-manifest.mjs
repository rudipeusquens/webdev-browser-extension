#!/usr/bin/env node
// Guards the built manifest against widened permissions (spec sections 4 and 5).
//   node scripts/check-manifest.mjs [path]   default: .output/chrome-mv3/manifest.json

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PERMISSIONS = [
  'activeTab',
  'clipboardWrite',
  'contextMenus',
  'offscreen',
  'scripting',
  'sidePanel',
  'storage',
  // No quota for storage.local: one site's feedback cannot fill the extension's storage (the
  // writer keeps each site within its own budget). Chrome shows no warning for it.
  'unlimitedStorage',
]
const OPTIONAL_HOSTS = ['http://*/*', 'https://*/*']
// Chrome assigns no suggested key that is one of its own shortcuts (Alt+Shift+A, Ctrl+K), and
// says nothing: tests/e2e/activate.e2e.test.ts checks the key Chrome actually assigned.
const SHORTCUT = 'Ctrl+Shift+K'
// Every other top-level key could widen access (optional_permissions, externally_connectable,
// content_security_policy, oauth2, …) and needs a deliberate change here.
const ALLOWED_KEYS = new Set([
  'action',
  'background',
  'commands',
  'description',
  'icons',
  'manifest_version',
  'minimum_chrome_version',
  'name',
  'optional_host_permissions',
  'permissions',
  'side_panel',
  'version',
])
// Keys with a specific message below; listed here so they are not reported twice.
const CHECKED_KEYS = new Set([
  'host_permissions',
  'content_scripts',
  'web_accessible_resources',
  'externally_connectable',
  'content_security_policy',
])
// Toolbar, extensions page and install dialog: without them Chrome shows a grey letter.
const ICON_SIZES = ['16', '32', '48', '128']
// The extension's pages and its service worker connect to OpenRouter only (dictation).
const CSP = "script-src 'self'; object-src 'self'; connect-src https://openrouter.ai"

const same = (a = [], b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

export function checkManifest(m) {
  const errors = []
  if (m.manifest_version !== 3) errors.push('manifest_version must be 3')
  if (m.minimum_chrome_version !== '116') errors.push('minimum_chrome_version must be "116"')
  if (!same(m.permissions, PERMISSIONS)) {
    errors.push(`permissions must be exactly ${PERMISSIONS.join(', ')}`)
  }
  if (!same(m.optional_host_permissions, OPTIONAL_HOSTS)) {
    errors.push(`optional_host_permissions must be exactly ${OPTIONAL_HOSTS.join(', ')}`)
  }
  if (m.host_permissions?.length) errors.push('host_permissions must be absent')
  if (m.content_scripts?.length) {
    errors.push('content_scripts must be absent (runtime injection only)')
  }
  if (m.web_accessible_resources?.length) errors.push('web_accessible_resources must be absent')
  // Declared empty: no other extension and no page may message the extension (without the key,
  // every extension could).
  if (JSON.stringify(m.externally_connectable) !== JSON.stringify({ ids: [] })) {
    errors.push('externally_connectable must be exactly { ids: [] }')
  }
  if (JSON.stringify(m.content_security_policy) !== JSON.stringify({ extension_pages: CSP })) {
    errors.push(`content_security_policy must be exactly { extension_pages: "${CSP}" }`)
  }
  const missing = ICON_SIZES.filter((size) => !m.icons?.[size])
  if (missing.length) errors.push(`icons must include sizes ${missing.join(', ')}`)
  if (m.commands?._execute_action?.suggested_key?.default !== SHORTCUT) {
    errors.push(`_execute_action must suggest ${SHORTCUT}`)
  }
  for (const key of Object.keys(m)) {
    if (!ALLOWED_KEYS.has(key) && !CHECKED_KEYS.has(key)) {
      errors.push(`unexpected top-level key "${key}"`)
    }
  }
  return errors
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const path = process.argv[2] ?? '.output/chrome-mv3/manifest.json'
  const errors = checkManifest(JSON.parse(readFileSync(path, 'utf8')))
  for (const error of errors) console.error(`manifest: ${error}`)
  process.exitCode = errors.length ? 1 : 0
}
