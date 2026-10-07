import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { checkManifest, OPTIONAL_HOSTS, PERMISSIONS, SHORTCUT } from './check-manifest.mjs'

const valid = () => ({
  manifest_version: 3,
  minimum_chrome_version: '116',
  permissions: [
    'storage',
    'activeTab',
    'scripting',
    'offscreen',
    'clipboardWrite',
    'sidePanel',
    'contextMenus',
    'unlimitedStorage',
  ],
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  commands: { _execute_action: { suggested_key: { default: 'Ctrl+Shift+K' } } },
  side_panel: { default_path: 'sidepanel.html' },
  externally_connectable: { ids: [] },
  icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; connect-src https://openrouter.ai",
  },
})

describe('checkManifest', () => {
  it('accepts the expected manifest in any order', () => {
    assert.deepEqual(checkManifest(valid()), [])
  })

  it('rejects an extra permission', () => {
    const m = valid()
    m.permissions.push('tabs')
    assert.match(checkManifest(m).join('\n'), /permissions/)
  })

  it('rejects host_permissions of any kind', () => {
    assert.match(
      checkManifest({ ...valid(), host_permissions: ['http://localhost/*'] }).join('\n'),
      /host_permissions/,
    )
  })

  it('rejects static content scripts', () => {
    const m = { ...valid(), content_scripts: [{ matches: ['<all_urls>'], js: ['x.js'] }] }
    assert.match(checkManifest(m).join('\n'), /content_scripts/)
  })

  it('rejects web accessible resources', () => {
    const m = { ...valid(), web_accessible_resources: [{ resources: ['a.css'], matches: [] }] }
    assert.match(checkManifest(m).join('\n'), /web_accessible_resources/)
  })

  it('rejects optional API permissions', () => {
    const m = { ...valid(), optional_permissions: ['tabs', 'history'] }
    assert.match(checkManifest(m).join('\n'), /optional_permissions/)
  })

  it('lets no other extension or page message the extension (externally_connectable)', () => {
    for (const externally of [
      { ids: [], matches: ['https://*/*'] },
      { ids: ['*'] },
      { matches: ['https://*/*'] },
      undefined,
    ]) {
      const m = { ...valid(), externally_connectable: externally }
      if (externally === undefined) delete m.externally_connectable
      assert.match(checkManifest(m).join('\n'), /externally_connectable/)
    }
  })

  it('requires the content security policy that connects to OpenRouter only', () => {
    for (const policy of [
      { extension_pages: "script-src 'self' 'unsafe-eval'" },
      { extension_pages: "script-src 'self'; object-src 'self'" },
      {
        extension_pages:
          "script-src 'self'; object-src 'self'; connect-src https://openrouter.ai https://x.test",
      },
      {
        extension_pages: "script-src 'self'; object-src 'self'; connect-src https://openrouter.ai",
        sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-eval'",
      },
      undefined,
    ]) {
      const m = { ...valid(), content_security_policy: policy }
      if (policy === undefined) delete m.content_security_policy
      assert.match(checkManifest(m).join('\n'), /content_security_policy/)
    }
  })

  it('rejects any other unexpected top-level key', () => {
    assert.match(checkManifest({ ...valid(), oauth2: {} }).join('\n'), /oauth2/)
  })

  it('accepts icons and the keys WXT always writes', () => {
    const m = {
      ...valid(),
      name: 'x',
      description: 'x',
      version: '0.0.0',
      action: {},
      background: { service_worker: 'background.js' },
    }
    assert.deepEqual(checkManifest(m), [])
  })

  // Without them Chrome shows a grey letter in the toolbar and on the extensions page.
  it('requires the icon in every size Chrome shows', () => {
    const { icons, ...m } = valid()
    assert.match(checkManifest(m).join('\n'), /icons/)
    assert.match(checkManifest({ ...m, icons: { ...icons, 48: undefined } }).join('\n'), /48/)
  })

  it('rejects a shortcut Chrome keeps for itself', () => {
    // Chrome assigns no suggested key that is one of its own shortcuts, and says nothing.
    for (const key of ['Alt+Shift+A', 'Ctrl+K']) {
      const m = { ...valid(), commands: { _execute_action: { suggested_key: { default: key } } } }
      assert.match(checkManifest(m).join('\n'), /Ctrl\+Shift\+K/, key)
    }
  })

  it('rejects a lower minimum Chrome version', () => {
    assert.match(
      checkManifest({ ...valid(), minimum_chrome_version: '110' }).join('\n'),
      /minimum_chrome_version/,
    )
  })
})

describe('README', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

  it('explains the permissions and optional hosts the manifest may have, and no others', () => {
    const lines = readme.split('\n')
    const start = lines.findIndex((line) => /^\|\s*Permission\s*\|/.test(line))
    assert.ok(start >= 0, 'a table headed "Permission"')
    const rows = lines.slice(start + 2)
    const named = rows
      .slice(
        0,
        rows.findIndex((line) => !line.startsWith('|')),
      )
      .flatMap((row) => [...row.split('|')[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]))
    assert.deepEqual(named.sort(), [...PERMISSIONS, ...OPTIONAL_HOSTS].sort())
  })

  it('names the toolbar shortcut the manifest suggests', () => {
    assert.ok(readme.includes(`\`${SHORTCUT}\``))
  })
})
