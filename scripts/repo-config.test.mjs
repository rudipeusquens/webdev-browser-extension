// The repository's own configuration, held to the rules the security review set (plan,
// milestone 7b): the denylist secret reaches no job that runs third-party code, and MCP
// servers start only through pnpm, with its age gate and build allowlist.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** The jobs of a workflow: name → its lines (two-space-indented keys under `jobs:`). */
function jobsOf(workflow) {
  const lines = workflow.split('\n')
  const start = lines.indexOf('jobs:')
  const jobs = new Map()
  let current
  for (const line of lines.slice(start + 1)) {
    const name = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line)?.[1]
    if (name) jobs.set((current = name), [])
    else if (current) jobs.get(current).push(line)
  }
  return jobs
}

describe('CI', () => {
  const jobs = jobsOf(read('.github/workflows/ci.yml'))

  it('gives the denylist secret only to a job that installs and runs nothing third-party', () => {
    const withSecret = [...jobs].filter(([, lines]) =>
      lines.some((line) => line.includes('secrets.PRIVACY_DENYLIST')),
    )
    assert.equal(withSecret.length, 1)
    const steps = withSecret[0][1].join('\n')
    assert.doesNotMatch(steps, /\b(pnpm|npm|npx|yarn|bunx)\b/)
    assert.doesNotMatch(steps, /cache:/)
    const uses = [...steps.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1].split('@')[0])
    assert.deepEqual(uses, ['actions/checkout', 'actions/setup-node'])
  })

  it('packs the extension and checks the package', () => {
    assert.match(jobs.get('ci').join('\n'), /^\s+- run: pnpm zip$/m)
    const zip = JSON.parse(read('package.json')).scripts.zip
    assert.match(zip, /^wxt zip && /)
    for (const check of ['check-manifest', 'check-bundle', 'check-zip']) {
      assert.ok(zip.includes(`node scripts/${check}.mjs`), `${check} in ${zip}`)
    }
  })

  it('keeps the privacy check free of dependencies', () => {
    const imports = [...read('scripts/privacy-check.mjs').matchAll(/from '([^']+)'/g)].map(
      (m) => m[1],
    )
    assert.ok(imports.length > 0)
    for (const name of imports) assert.match(name, /^node:/)
  })
})

describe('MCP servers', () => {
  const servers = Object.values(JSON.parse(read('.mcp.json')).mcpServers)

  it('start through pnpm, at an exact version', () => {
    assert.ok(servers.length > 0)
    for (const { command, args } of servers) {
      assert.equal(command, 'pnpm')
      assert.ok(args.includes('dlx'))
      assert.ok(
        args.some((arg) => /^(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+$/.test(arg)),
        args.join(' '),
      )
    }
  })

  it('send no registry a request with values from the environment (components.json)', () => {
    assert.equal(Object.hasOwn(JSON.parse(read('components.json')), 'registries'), false)
  })
})
