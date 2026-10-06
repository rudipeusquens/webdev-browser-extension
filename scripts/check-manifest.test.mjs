import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { checkManifest } from './check-manifest.mjs'

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
  ],
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  commands: { _execute_action: { suggested_key: { default: 'Alt+Shift+A' } } },
  side_panel: { default_path: 'sidepanel.html' },
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

  it('rejects externally_connectable (only own contexts may message the background)', () => {
    const m = { ...valid(), externally_connectable: { matches: ['https://*/*'] } }
    assert.match(checkManifest(m).join('\n'), /externally_connectable/)
  })

  it('rejects a custom content security policy', () => {
    const m = {
      ...valid(),
      content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'" },
    }
    assert.match(checkManifest(m).join('\n'), /content_security_policy/)
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
      icons: { 16: 'icon/16.png' },
    }
    assert.deepEqual(checkManifest(m), [])
  })

  it('rejects a lower minimum Chrome version', () => {
    assert.match(
      checkManifest({ ...valid(), minimum_chrome_version: '110' }).join('\n'),
      /minimum_chrome_version/,
    )
  })
})
