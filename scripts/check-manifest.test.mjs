import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { checkManifest } from './check-manifest.mjs'

const valid = () => ({
  manifest_version: 3,
  minimum_chrome_version: '116',
  permissions: ['storage', 'activeTab', 'scripting', 'offscreen', 'clipboardWrite', 'sidePanel'],
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

  it('rejects a lower minimum Chrome version', () => {
    assert.match(
      checkManifest({ ...valid(), minimum_chrome_version: '110' }).join('\n'),
      /minimum_chrome_version/,
    )
  })
})
