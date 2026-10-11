import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { checkBundle } from './check-bundle.mjs'
import { withFolder } from './test-helpers.mjs'

const clean = {
  'manifest.json': '{"manifest_version":3}',
  'background.js': 'fetch("https://openrouter.ai/api/v1/key")',
  'chunks/vue.js': 'const SVG = "http://www.w3.org/2000/svg" // see https://vuejs.org/guide',
  'sidepanel.html': '<!doctype html><script type="module" src="/chunks/sidepanel.js"></script>',
}

describe('checkBundle', () => {
  it('accepts a build with only the known hosts and no dev or dynamic code', () => {
    assert.deepEqual(
      withFolder('bundle', clean, (dir) => checkBundle(dir)),
      [],
    )
  })

  it('rejects source maps, eval, new Function, dev servers and unknown hosts', () => {
    for (const [file, text, rule] of [
      ['chunks/a.js', 'x()\n//# sourceMappingURL=a.js.map', /source map/],
      ['chunks/a.js.map', '{}', /source map/],
      ['chunks/a.js', 'eval(code)', /eval/],
      ['chunks/a.js', 'new Function("return 1")', /eval/],
      ['background.js', 'new WebSocket("ws://localhost:3000")', /dev server/],
      ['background.js', 'fetch("http://127.0.0.1:5173/@vite/client")', /dev server/],
      ['chunks/a.js', 'fetch("https://collector.example.com/x")', /collector\.example\.com/],
    ]) {
      const errors = withFolder('bundle', { ...clean, [file]: text }, (dir) => checkBundle(dir))
      assert.match(errors.join('\n'), rule, `${file}: ${text}`)
    }
  })
})
