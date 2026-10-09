# Annotation Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chrome extension from the spec: mark elements, text and areas on a page,
comment by typing or voice, collect across pages, copy everything as a Markdown prompt.

**Architecture:** WXT (Vite-based) Manifest V3 extension. A background service worker is the
single writer of state in `chrome.storage.local`; a content-script overlay in a closed shadow
root handles marking; a Vue side panel lists and copies; pure TypeScript modules do capture
and formatting; an offscreen document records audio for OpenRouter speech-to-text.

**Tech Stack:** WXT, Vue 3, TypeScript ~6.0, Tailwind v4, shadcn-vue (reka-ui), Vitest
(happy-dom, WXT fake browser), Puppeteer + Chrome for Testing, pnpm.

**Spec:** `docs/specs/2026-10-05-annotation-extension.md` (read it before any task).

**Depth:** Milestone 1 is planned task by task. Milestones 2–7 are outlined with goals, files,
required tests and acceptance criteria; each is expanded into tasks (in this file, in the PR
that starts it) once the spike results of milestone 1 are recorded in the spec.

## Global Constraints

- Manifest V3, `minimum_chrome_version: "116"`.
- English everywhere: UI, clipboard output, code, comments, docs, commit messages.
- Public repository: fixtures and examples are synthetic only (`example.com`, `localhost`,
  placeholder names, hand-written HTML, text-to-speech audio). Never real pages, URLs or voices.
- Network: the only remote calls are `POST https://openrouter.ai/api/v1/audio/transcriptions`
  and `GET https://openrouter.ai/api/v1/key`, voice audio only, with
  `provider: { data_collection: "deny" }`. No host permission for `openrouter.ai`.
- Permissions exactly: `activeTab`, `scripting`, `storage`, `sidePanel`, `offscreen`,
  `clipboardWrite`, `contextMenus` (added after milestone 4 for **Annotate this page**);
  optional host permissions `http://*/*`, `https://*/*`; no
  `host_permissions`.
- State in `chrome.storage.local` only, never `sync`; the background is the only writer.
  Runtime state (tabs that refused the overlay, missing items, the undo history) in
  `chrome.storage.session`.
- Page-derived strings are untrusted: no `v-html`, no `eval`, no remote code; caps: visible
  text 120 chars, selected text 500, context 40 each side, origin chain 5, area elements 10,
  selector depth 8.
- Shortcuts: `Ctrl+Shift+K` activate (the `_execute_action` command, which fires the same
  `action.onClicked` handler as the icon; the page's context menu entry **Annotate this page**
  does the same). Milestone 1 used `Alt+Shift+A`, which Chrome never assigns (spec section 13,
  spike 2); the task code below still shows it. `E` element, `A` area, `Esc` browse, `P` pins;
  `Enter` save (not during IME composition), `Shift+Enter` new line, `Alt+V` voice; in the
  panel `Ctrl+Z` undo, `Ctrl+Shift+Z` / `Ctrl+Y` redo (`⌘Z`, `⇧⌘Z` on macOS).
- Default speech-to-text model `openai/gpt-4o-mini-transcribe`; language `auto`; recordings
  stop at 120 s; request timeout 65 s. (Milestone 8b: a recording pauses at a limit set in
  Settings, 5 minutes by default, and the timeout grows with the audio.)
- OpenRouter test key: `OPENROUTER_API_KEY_TEST` in `.env` (gitignored). Used only by the local
  live test; never in CI, logs, fixtures, snapshots or commit messages.
- Dependencies via `pnpm add`; `minimumReleaseAge` 3 days; install scripts only via `allowBuilds`
  in `pnpm-workspace.yaml`. TypeScript stays `~6.0` (typescript-eslint peer range).
- One pull request per milestone; `ci` must be green; never bypass hooks.

## Review Focus

1. **Text selected inside a form field** (`input`, `textarea`): the value must never be
   captured; no Comment chip appears. → milestone 3 test.
2. **Page text containing backticks, Markdown, HTML or line breaks**: the output stays valid
   Markdown, fences and quotes never break, no page text starts a line or injects HTML (inline
   emphasis inside quotes may render; spec section 7). → milestone 2 formatter tests.
3. **Identical sibling structures** (list items, cards without ids): the selector must still
   match exactly one element. → milestone 2 selector tests.
4. **Same page, different URL spelling** (hash, query, trailing slash): hash dropped, query
   kept, `/a` and `/a/` stay distinct pages. → milestone 1 Task 2 tests.
5. **Targets inside scroll containers or with `position: fixed/sticky`**: pins follow the
   element, not the document. → milestone 4 E2E test.

---

## Milestone 1: Scaffold, test harness and spikes

**Outcome:** an installable extension whose icon (or `Alt+Shift+A`) opens an empty side panel
and injects a styled overlay placeholder in a closed shadow root; unit tests, a manifest
permission guard and real-browser E2E tests run in CI. Spikes 1–3 are answered in the spec.

**Facts this milestone relies on** (verified in a throwaway build on 2026-10-05, WXT 0.21.4,
Puppeteer 25.12.0, Chrome for Testing 154):

- `browser.sidePanel.open()` works inside `action.onClicked` **only before the first `await`**;
  the click grants `activeTab`. With `openPanelOnActionClick: true`, `onClicked` does not fire
  and no `activeTab` is granted, so that option is not used.
- The `_execute_action` command fires `action.onClicked`, so `Alt+Shift+A` reuses the same
  handler.
- Puppeteer's `page.triggerExtensionAction(extension)` fires `onClicked` with the `activeTab`
  grant; `browser.installExtension(dir)` loads the unpacked build.
- A content script with `registration: 'runtime'` builds to `/content-scripts/<name>.js`. With
  `cssInjectionMode: 'ui'` and no `matches`, Chrome blocks its CSS, so the overlay passes its CSS
  inline (`?inline` import, `cssInjectionMode: 'manual'`). Adding `matches` is forbidden: WXT
  copies them into `host_permissions`.
- WXT's shadow-root CSS splitting moves `@property` rules to the document head; reka-ui portals
  must target an element inside the shadow root; `rem` must be converted to `px` so the page's
  root font size cannot scale the overlay.
- `wxt/testing` is gone in 0.21: use `wxt/testing/vitest-plugin` and `wxt/testing/fake-browser`,
  and add `@vitejs/plugin-vue` explicitly.
- shadcn-vue: write `components.json` by hand with style `new-york` (the `init` default
  `reka-nova` pulls a remote font and the whole CLI as a runtime dependency); `srcDir: 'src'`
  avoids the CLI tripping over a root `components/` folder.
- Puppeteer's `postinstall` downloads Chrome for Testing; extraction needs `unzip` or the
  optional peer `yauzl`. On machines missing Chrome's system libraries, set `LD_LIBRARY_PATH` to
  a folder that provides them.

### Task 1: Detect OpenRouter keys in the secret scanners

Neither secretlint's recommended preset nor gitleaks 8.30.1 knows OpenRouter keys (verified with
a fake key on 2026-10-05).

**Files:**

- Modify: `.secretlintrc.json`, `package.json` (devDependency), `.github/workflows/ci.yml`
- Create: `.gitleaks.toml`, `.env.example`, `scripts/secret-patterns.test.mjs`

**Interfaces:**

- Produces: secretlint rule name `OpenRouter API key`; gitleaks rule id `openrouter-api-key`;
  `.env.example` documents `OPENROUTER_API_KEY_TEST`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/secret-patterns.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

// A well-formed but fake key, assembled at runtime so this file never contains one.
const fakeKey = 'sk-or-v1-' + 'ab12'.repeat(16)
const dir = mkdtempSync(join(tmpdir(), 'secret-patterns-'))
after(() => rmSync(dir, { recursive: true, force: true }))

function secretlint(content) {
  const file = join(dir, 'sample.ts')
  writeFileSync(file, content)
  return spawnSync(
    join('node_modules', '.bin', 'secretlint'),
    ['--secretlintrc', '.secretlintrc.json', '--maskSecrets', file],
    { encoding: 'utf8' },
  )
}

describe('secretlint', () => {
  it('flags an OpenRouter API key and masks it', () => {
    const result = secretlint(`const key = "${fakeKey}"\n`)
    assert.notEqual(result.status, 0)
    assert.ok(!`${result.stdout}${result.stderr}`.includes(fakeKey))
  })

  it('accepts the bare prefix in documentation', () => {
    assert.equal(secretlint('Keys start with sk-or-v1- followed by 64 hex characters.\n').status, 0)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test scripts/secret-patterns.test.mjs`
Expected: FAIL in "flags an OpenRouter API key" (`status` is 0).

- [ ] **Step 3: Add the secretlint pattern rule**

Run: `pnpm add -D @secretlint/secretlint-rule-pattern`

```json
{
  "rules": [
    {
      "id": "@secretlint/secretlint-rule-preset-recommend"
    },
    {
      "id": "@secretlint/secretlint-rule-pattern",
      "options": {
        "patterns": [
          {
            "name": "OpenRouter API key",
            "patterns": ["/sk-or-v1-[0-9a-f]{64}/"]
          }
        ]
      }
    }
  ]
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `node --test scripts/secret-patterns.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the gitleaks rule and a CI self-test**

```toml
# .gitleaks.toml — the default rules plus what they miss.
[extend]
useDefault = true

[[rules]]
id = "openrouter-api-key"
description = "OpenRouter API key"
regex = '''sk-or-v1-[0-9a-f]{64}'''
keywords = ["sk-or-v1-"]
```

In `.github/workflows/ci.yml`, change the gitleaks call to use the config explicitly and add a
self-test step after it (the sample has no keyword like `key =`, so only our rule can match):

```yaml
          "$RUNNER_TEMP/gitleaks" git --config .gitleaks.toml --redact --no-banner --verbose .
      - name: gitleaks self-test (OpenRouter rule)
        run: |
          mkdir -p "$RUNNER_TEMP/selftest"
          printf 'sk-or-v1-%s\n' "$(printf 'ab12%.0s' $(seq 16))" > "$RUNNER_TEMP/selftest/sample.txt"
          "$RUNNER_TEMP/gitleaks" dir --config .gitleaks.toml --no-banner --redact \
            --report-format json --report-path "$RUNNER_TEMP/selftest.json" \
            "$RUNNER_TEMP/selftest" && { echo "::error::gitleaks found nothing"; exit 1; }
          jq -e 'any(.[]; .RuleID == "openrouter-api-key")' "$RUNNER_TEMP/selftest.json"
```

- [ ] **Step 6: Document the test key**

```sh
# .env.example — copy to .env (gitignored) for local development only.

# OpenRouter key for the local live voice test (pnpm test:live). Never used in CI.
# Create one at https://openrouter.ai/settings/keys with a low credit limit.
OPENROUTER_API_KEY_TEST=
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm check`
Expected: all green; `privacy-check` accepts `.env.example`.

```bash
git add .secretlintrc.json .gitleaks.toml .env.example scripts/secret-patterns.test.mjs \
  package.json pnpm-lock.yaml .github/workflows/ci.yml
git cm -m "Detect OpenRouter API keys in secretlint and gitleaks"
```

### Task 2: WXT + Vue scaffold with unit tests

**Files:**

- Modify: `package.json`, `eslint.config.mjs`, `.gitignore`, `.prettierignore`,
  `.github/workflows/ci.yml`, `AGENTS.md` (Stack, Commands)
- Create: `wxt.config.ts`, `tsconfig.json`, `vitest.config.ts`,
  `src/entrypoints/background.ts`, `src/entrypoints/sidepanel/index.html`,
  `src/entrypoints/sidepanel/main.ts`, `src/entrypoints/sidepanel/App.vue`,
  `src/lib/collection/page-key.ts`, `tests/unit/page-key.test.ts`

**Interfaces:**

- Produces: `pageKey(url: string): string` in `src/lib/collection/page-key.ts`; scripts
  `dev`, `build`, `zip`, `compile`, `test`, `test:unit`; WXT auto-imports are off — every
  module imports explicitly (`wxt/browser`, `wxt/utils/define-background`, …).

- [ ] **Step 1: Install**

```bash
pnpm add vue
pnpm add -D wxt @wxt-dev/module-vue vite vue-tsc vitest happy-dom @vitejs/plugin-vue \
  @vue/test-utils eslint-plugin-vue vue-eslint-parser
```

- [ ] **Step 2: Configure WXT**

```ts
// wxt.config.ts
import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  // Explicit imports keep every module readable on its own.
  imports: false,
  manifest: {
    name: 'Webdev Browser Extension',
    description:
      'Mark elements, text and areas on a page and copy them as a prompt for an AI coding agent.',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'scripting', 'storage', 'offscreen', 'clipboardWrite'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'Annotate this page' },
    commands: {
      // Fires action.onClicked, so the shortcut and the icon share one handler.
      _execute_action: { suggested_key: { default: 'Alt+Shift+A' } },
    },
  },
})
```

```json
// tsconfig.json
{ "extends": "./.wxt/tsconfig.json" }
```

`package.json` scripts (keep the existing ones, replace `test`, add the rest):

```json
"dev": "wxt",
"build": "wxt build",
"zip": "wxt zip",
"compile": "vue-tsc --noEmit",
"postinstall": "wxt prepare",
"test": "node --test \"scripts/**/*.test.mjs\" && vitest run",
"test:unit": "vitest run",
"check": "pnpm lint && pnpm format:check && pnpm compile && pnpm test && pnpm secrets:check && pnpm privacy:check"
```

Add `.wxt/` to `.gitignore` and `.wxt` to `.prettierignore` (`.output` is already in both).
Extend the lint-staged globs: `"*.{js,mjs,cjs,ts,mts,cts,tsx,vue}"`.

- [ ] **Step 3: ESLint for Vue and the WXT folders**

```js
// eslint.config.mjs
// @ts-check
import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// `eslint-config-prettier` stays last — it turns off rules that fight Prettier.
export default defineConfig(
  globalIgnores(['dist/', 'build/', '.output/', '.wxt/', '.private/', '.worktrees/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.{js,mjs,ts}', 'tests/e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  // shadcn-vue components use single-word names (Button, Popover).
  { rules: { 'vue/multi-word-component-names': 'off' } },
  eslintConfigPrettier,
)
```

- [ ] **Step 4: Background and side panel**

```ts
// src/entrypoints/background.ts
import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    // Chrome accepts sidePanel.open() only synchronously inside the user gesture:
    // nothing may be awaited before this call.
    void browser.sidePanel.open({ windowId: tab.windowId })
  })
})
```

```html
<!-- src/entrypoints/sidepanel/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Feedback</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

```ts
// src/entrypoints/sidepanel/main.ts
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

```vue
<!-- src/entrypoints/sidepanel/App.vue -->
<template>
  <main>
    <h1>Feedback</h1>
    <p>No feedback yet: pick an element, drag an area, or select text.</p>
  </main>
</template>
```

- [ ] **Step 5: Vitest config and the failing page-key test**

```ts
// vitest.config.ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { WxtVitest } from 'wxt/testing/vitest-plugin'

export default defineConfig({
  // WxtVitest does not add the Vue plugin itself.
  plugins: [vue(), WxtVitest()],
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
  },
})
```

```ts
// tests/unit/page-key.test.ts
import { describe, expect, it } from 'vitest'
import { pageKey } from '@/lib/collection/page-key'

describe('pageKey', () => {
  it('drops the hash', () => {
    expect(pageKey('http://localhost:3000/settings#billing')).toBe('http://localhost:3000/settings')
  })

  it('keeps the query', () => {
    expect(pageKey('http://localhost:3000/settings?tab=2#x')).toBe(
      'http://localhost:3000/settings?tab=2',
    )
  })

  it('keeps a trailing slash distinct', () => {
    expect(pageKey('http://localhost:3000/a')).not.toBe(pageKey('http://localhost:3000/a/'))
  })

  it('normalizes an origin-only URL to its root path', () => {
    expect(pageKey('http://localhost:3000')).toBe('http://localhost:3000/')
  })
})
```

Run: `pnpm install && pnpm test:unit`
Expected: FAIL, module `@/lib/collection/page-key` not found.

- [ ] **Step 6: Implement**

```ts
// src/lib/collection/page-key.ts
/** Key of a page in the collection: the URL without its hash; query and trailing slash stay. */
export function pageKey(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  return parsed.href
}
```

Run: `pnpm test:unit`
Expected: PASS (4 tests).

- [ ] **Step 7: Build, type-check, lint**

Run: `pnpm build && pnpm compile && pnpm lint && pnpm format:check`
Expected: build writes `.output/chrome-mv3/` with `manifest.json`, `background.js`,
`sidepanel.html`; no type or lint errors. If `wxt/utils/define-background` cannot be resolved,
list `node_modules/wxt/dist/utils/` and use the path exported there (WXT 0.20+ layout).

- [ ] **Step 8: CI and docs**

Add `- run: pnpm compile` after `pnpm format:check` in `.github/workflows/ci.yml`. In
`AGENTS.md`, replace "Stack: Not decided yet" with the stack from the spec (WXT, Vue 3,
TypeScript ~6.0, Tailwind v4, shadcn-vue, Vitest, Puppeteer) and add `pnpm dev`, `pnpm build`,
`pnpm compile`, `pnpm test:unit` to Commands; set Status to "milestone 1 of
`docs/plans/2026-10-05-annotation-extension.md`".

- [ ] **Step 9: Commit**

```bash
git add -A
git status --short   # must not list .output/, .wxt/ or .env
git cm -m "Scaffold WXT + Vue extension with Vitest"
```

### Task 3: Manifest permission guard

The permission list is a promise to users (spec section 4). A script checks the **built**
manifest so neither a config edit nor WXT's automatic additions can widen it unnoticed.

**Files:**

- Create: `scripts/check-manifest.mjs`, `scripts/check-manifest.test.mjs`
- Modify: `package.json` (script `manifest:check`), `.github/workflows/ci.yml`

**Interfaces:**

- Produces: `checkManifest(manifest: object): string[]` (empty array = valid); CLI
  `node scripts/check-manifest.mjs [path]`, default `.output/chrome-mv3/manifest.json`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/check-manifest.test.mjs
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
```

Run: `node --test scripts/check-manifest.test.mjs`
Expected: FAIL, cannot find module `./check-manifest.mjs`.

- [ ] **Step 2: Implement**

`scripts/check-manifest.mjs` (the shebang must stay on line 1):

```js
#!/usr/bin/env node
// Guards the built manifest against widened permissions (spec sections 4 and 5).
//   node scripts/check-manifest.mjs [path]   default: .output/chrome-mv3/manifest.json

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PERMISSIONS = [
  'activeTab',
  'clipboardWrite',
  'offscreen',
  'scripting',
  'sidePanel',
  'storage',
]
const OPTIONAL_HOSTS = ['http://*/*', 'https://*/*']

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
  if (m.content_scripts?.length)
    errors.push('content_scripts must be absent (runtime injection only)')
  if (m.web_accessible_resources?.length) errors.push('web_accessible_resources must be absent')
  if (m.commands?._execute_action?.suggested_key?.default !== 'Alt+Shift+A') {
    errors.push('_execute_action must suggest Alt+Shift+A')
  }
  return errors
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const path = process.argv[2] ?? '.output/chrome-mv3/manifest.json'
  const errors = checkManifest(JSON.parse(readFileSync(path, 'utf8')))
  for (const error of errors) console.error(`manifest: ${error}`)
  process.exitCode = errors.length ? 1 : 0
}
```

Run: `node --test scripts/check-manifest.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 3: Check the real build**

Add `"manifest:check": "node scripts/check-manifest.mjs"` to `package.json`.
Run: `pnpm build && pnpm manifest:check`
Expected: exit 0. If it fails, the build output is wrong — fix `wxt.config.ts`, not the guard.

- [ ] **Step 4: CI and commit**

Add after `pnpm compile` in `ci.yml`:

```yaml
- run: pnpm build
- run: pnpm manifest:check
```

```bash
git add scripts/check-manifest.mjs scripts/check-manifest.test.mjs package.json .github/workflows/ci.yml
git cm -m "Guard the built manifest against widened permissions"
```

### Task 4: Tailwind v4 and shadcn-vue in the side panel

**Files:**

- Modify: `wxt.config.ts`, `src/entrypoints/sidepanel/main.ts`,
  `src/entrypoints/sidepanel/App.vue`, `package.json`, `AGENTS.md`
- Create: `postcss.config.mjs`, `components.json`, `src/assets/tailwind.css`,
  `src/lib/utils.ts`, `src/components/ui/button/*` (generated), `.mcp.json`,
  `tests/unit/sidepanel-app.test.ts`

**Interfaces:**

- Produces: `cn(...inputs: ClassValue[]): string` in `src/lib/utils.ts`;
  `src/assets/tailwind.css` (imported by side panel, and by the overlay as `?inline` in Task 6);
  `Button` from `@/components/ui/button`.

- [ ] **Step 1: Install**

```bash
pnpm add class-variance-authority clsx tailwind-merge @lucide/vue tw-animate-css
pnpm add -D tailwindcss @tailwindcss/vite postcss-rem-to-responsive-pixel
```

- [ ] **Step 2: Wire Tailwind and px conversion**

In `wxt.config.ts` add the import and the `vite` key:

```ts
import tailwindcss from '@tailwindcss/vite'
// …inside defineConfig({ … }):
  vite: () => ({ plugins: [tailwindcss()] }),
```

```js
// postcss.config.mjs
// rem → px: the overlay lives inside arbitrary pages, whose root font size must not scale it.
import remToPx from 'postcss-rem-to-responsive-pixel'

export default {
  plugins: [remToPx({ rootValue: 16, propList: ['*'], transformUnit: 'px' })],
}
```

- [ ] **Step 3: Theme and helpers**

```css
/* src/assets/tailwind.css — shadcn-vue new-york, neutral; dark follows the system. */
@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (@media (prefers-color-scheme: dark));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.205 0 0);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.205 0 0);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.922 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --secondary: oklch(0.269 0 0);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.269 0 0);
    --muted-foreground: oklch(0.708 0 0);
    --accent: oklch(0.269 0 0);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.704 0.191 22.216);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 15%);
    --ring: oklch(0.556 0 0);
  }
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

```ts
// src/lib/utils.ts
import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

```json
// components.json
{
  "$schema": "https://shadcn-vue.com/schema.json",
  "style": "new-york",
  "typescript": true,
  "tailwind": {
    "config": "",
    "css": "src/assets/tailwind.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "composables": "@/composables",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib"
  },
  "iconLibrary": "lucide"
}
```

Run: `pnpm dlx shadcn-vue@2.8.2 add button -y`
Expected: `src/components/ui/button/Button.vue` and `index.ts`; `reka-ui` added to
dependencies. `git diff src/assets/tailwind.css` must stay empty; revert any change the CLI
makes there (no remote font imports).

- [ ] **Step 4: Failing component test**

```ts
// tests/unit/sidepanel-app.test.ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from '@/entrypoints/sidepanel/App.vue'

describe('side panel', () => {
  it('shows the empty state and a disabled copy button', () => {
    const wrapper = mount(App)
    expect(wrapper.text()).toContain(
      'No feedback yet: pick an element, drag an area, or select text.',
    )
    const copy = wrapper.get('[data-testid="copy-prompt"]')
    expect(copy.text()).toBe('Copy as prompt')
    expect(copy.attributes('disabled')).toBeDefined()
  })
})
```

Run: `pnpm test:unit`
Expected: FAIL, no element `[data-testid="copy-prompt"]`.

- [ ] **Step 5: Side panel with shadcn-vue**

```ts
// src/entrypoints/sidepanel/main.ts
import '@/assets/tailwind.css'
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

```vue
<!-- src/entrypoints/sidepanel/App.vue -->
<script setup lang="ts">
import { Button } from '@/components/ui/button'
</script>

<template>
  <main class="flex h-screen flex-col text-sm">
    <header class="border-b px-4 py-3">
      <h1 class="font-semibold">Feedback</h1>
    </header>
    <section class="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground">
      <p>No feedback yet: pick an element, drag an area, or select text.</p>
    </section>
    <footer class="border-t p-3">
      <Button data-testid="copy-prompt" class="w-full" disabled>Copy as prompt</Button>
    </footer>
  </main>
</template>
```

Run: `pnpm test:unit && pnpm build && pnpm manifest:check`
Expected: PASS; build green; manifest unchanged.

- [ ] **Step 6: shadcn MCP for agents**

```json
// .mcp.json — no tokens; the version is pinned.
{
  "mcpServers": {
    "shadcn": {
      "command": "npx",
      "args": ["-y", "shadcn@4.21.0", "mcp"]
    }
  }
}
```

In `AGENTS.md` add under Conventions: "shadcn-vue components are copied into
`src/components/ui/` with `pnpm dlx shadcn-vue@2.8.2 add <name>`, style `new-york`; never add
them as a dependency. The `shadcn` MCP (`.mcp.json`) can look up components; a session restart
loads it."

- [ ] **Step 7: Commit**

```bash
pnpm check
git add -A && git status --short
git cm -m "Add Tailwind v4 and shadcn-vue to the side panel"
```

### Task 5: Real-browser E2E harness and action click (spikes 1 and 2)

**Files:**

- Modify: `package.json`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml`, `AGENTS.md`
- Create: `vitest.e2e.config.ts`, `tests/e2e/harness.ts`, `tests/e2e/activate.e2e.test.ts`,
  `tests/fixtures/sites/plain/index.html`

**Interfaces:**

- Produces (in `tests/e2e/harness.ts`):
  - `startFixtureServer(): Promise<{ origin: string; close(): Promise<void> }>` — serves
    `tests/fixtures/sites/<site>/…`; optional `<site>/headers.json` adds response headers.
  - `interface Session { browser: Browser; extensionId: string; page: Page }`
  - `launch(): Promise<Session>`
  - `clickAction(s: Session): Promise<Page>` — triggers the action on `s.page`, returns the
    side panel page.
  - `contentRealm(s: Session): Promise<Realm>` — the extension's content-script world in
    `s.page` (used from Task 6 on).

- [ ] **Step 1: Install and allow Chrome's download**

```bash
pnpm add -D puppeteer yauzl
```

In `pnpm-workspace.yaml` replace `allowBuilds: {}` with:

```yaml
allowBuilds:
  # Downloads Chrome for Testing for the E2E tests.
  puppeteer: true
```

Run: `pnpm install`
Expected: Chrome for Testing in `~/.cache/puppeteer/chrome/`.

- [ ] **Step 2: Fixture page and harness**

```html
<!-- tests/fixtures/sites/plain/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Plain fixture</title>
  </head>
  <body>
    <h1 id="title">Example shop</h1>
    <form id="profile">
      <label>Name <input name="name" type="text" /></label>
      <div class="actions"><button type="submit">Save changes</button></div>
    </form>
    <section class="features">
      <div class="card">Fast setup</div>
      <div class="card">Secure</div>
      <div class="card">Support</div>
    </section>
  </body>
</html>
```

```ts
// tests/e2e/harness.ts
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'
import puppeteer, { type Browser, type Page, type Realm } from 'puppeteer'

export const EXTENSION_DIR = resolve(process.env.E2E_EXTENSION_DIR ?? '.output/chrome-mv3')
const SITES = resolve('tests/fixtures/sites')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
}

export async function startFixtureServer() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname))
    const file = join(SITES, path.endsWith('/') ? `${path}index.html` : path)
    if (!file.startsWith(SITES)) return void res.writeHead(403).end()
    try {
      const body = await readFile(file)
      const site = path.split('/')[1] ?? ''
      const headers = await readFile(join(SITES, site, 'headers.json'), 'utf8')
        .then((text) => JSON.parse(text) as Record<string, string>)
        .catch(() => ({}))
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain', ...headers })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://localhost:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

export interface Session {
  browser: Browser
  extensionId: string
  page: Page
}

export async function launch(): Promise<Session> {
  // --no-sandbox: CI runners restrict user namespaces; the pages are our own fixtures.
  const browser = await puppeteer.launch({
    headless: true,
    enableExtensions: true,
    args: ['--no-sandbox'],
  })
  const extensionId = await browser.installExtension(EXTENSION_DIR)
  await browser.waitForTarget(
    (t) =>
      t.type() === 'service_worker' &&
      t.url() === `chrome-extension://${extensionId}/background.js`,
  )
  const page = await browser.newPage()
  return { browser, extensionId, page }
}

export async function clickAction(s: Session): Promise<Page> {
  const extension = (await s.browser.extensions()).get(s.extensionId)
  if (!extension) throw new Error('extension is not installed')
  await s.page.triggerExtensionAction(extension)
  const target = await s.browser.waitForTarget(
    (t) => t.url() === `chrome-extension://${s.extensionId}/sidepanel.html`,
  )
  const panel = await target.asPage()
  // A headless side panel reports a 0×0 viewport otherwise.
  await panel.setViewport({ width: 400, height: 800 })
  return panel
}

export async function contentRealm(s: Session): Promise<Realm> {
  for (let attempt = 0; attempt < 50; attempt++) {
    for (const realm of await s.page.extensionRealms()) {
      if ((await realm.extension())?.id === s.extensionId) return realm
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error('content-script realm not found')
}
```

```ts
// vitest.e2e.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
```

Add `"test:e2e": "vitest run --config vitest.e2e.config.ts"` to `package.json`.

- [ ] **Step 3: Failing E2E test**

```ts
// tests/e2e/activate.e2e.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, launch, type Session, startFixtureServer } from './harness'

describe('activation', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('opens the side panel on action click', async () => {
    await session.page.goto(`${server.origin}/plain/`)
    const panel = await clickAction(session)
    const empty = await panel.waitForSelector('::-p-text(No feedback yet)')
    expect(empty).not.toBeNull()
    const disabled = await panel.$eval('[data-testid="copy-prompt"]', (b) =>
      b.hasAttribute('disabled'),
    )
    expect(disabled).toBe(true)
  })
})
```

Run: `pnpm build && pnpm test:e2e`
Expected: PASS already if Tasks 2–4 are in place (the background opens the panel); if it
fails, the harness is wrong — fix it before continuing. To prove the test can fail, comment out
the `sidePanel.open` line, rebuild, run: Expected FAIL (timeout waiting for
`sidepanel.html`); restore the line.

- [ ] **Step 4: CI**

In `ci.yml` raise `timeout-minutes` to 15 and add after `pnpm manifest:check`:

```yaml
- run: pnpm test:e2e
```

(`pnpm install` already downloaded Chrome through Puppeteer's allowed build script.)

- [ ] **Step 5: Docs and commit**

`AGENTS.md` Commands: add `pnpm test:e2e` ("builds must be current: run `pnpm build` first")
and the note "If Chrome fails to start because system libraries are missing, set
`LD_LIBRARY_PATH` to a folder that provides them."

```bash
pnpm check
git add -A && git status --short
git cm -m "Add Puppeteer E2E harness and action-click test"
```

### Task 6: Overlay in a closed shadow root on a hostile page (spike 3)

**Files:**

- Modify: `src/entrypoints/background.ts`, `src/components/ui/popover/PopoverContent.vue`
  (generated in Step 2), `docs/specs/2026-10-05-annotation-extension.md` (section 13)
- Create: `src/entrypoints/overlay.content/index.ts`, `src/entrypoints/overlay.content/Overlay.vue`,
  `tests/fixtures/sites/hostile/index.html`, `tests/fixtures/sites/hostile/hostile.css`,
  `tests/fixtures/sites/hostile/headers.json`, `tests/e2e/overlay.e2e.test.ts`

**Interfaces:**

- Consumes: `launch`, `clickAction`, `contentRealm`, `startFixtureServer` (Task 5); `Button`,
  `cn`, `src/assets/tailwind.css` (Task 4).
- Produces: content script file `/content-scripts/overlay.js`; host element tag
  `webdev-overlay`; `globalThis.__webdevOverlay: { shadow?: ShadowRoot }` in the
  content-script world only (pages and other extensions cannot read it; E2E tests use it);
  `PopoverContent` accepts `to?: string | HTMLElement`.

- [ ] **Step 1: Hostile fixture**

```html
<!-- tests/fixtures/sites/hostile/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Hostile fixture</title>
    <link rel="stylesheet" href="hostile.css" />
  </head>
  <body>
    <h1>Hostile page</h1>
    <p>Aggressive global styles, a huge root font size, a strict CSP and a full-page layer.</p>
    <div class="layer"></div>
  </body>
</html>
```

```css
/* tests/fixtures/sites/hostile/hostile.css */
html {
  font-size: 30px;
}
* {
  all: unset !important;
}
.layer {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  display: block !important;
}
```

```json
// tests/fixtures/sites/hostile/headers.json
{ "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'" }
```

- [ ] **Step 2: Popover with a portal target inside the shadow root**

Run: `pnpm dlx shadcn-vue@2.8.2 add popover -y`

Then make the portal target configurable. Replace the `<script setup>` block and the
`<PopoverPortal>` opening tag of `src/components/ui/popover/PopoverContent.vue` as below; keep
the class list the CLI generated inside `cn(…)` unchanged:

```vue
<script setup lang="ts">
import type { PopoverContentEmits, PopoverContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { PopoverContent, PopoverPortal, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<
    PopoverContentProps & {
      class?: HTMLAttributes['class']
      // Portal target. Inside the overlay this must be an element in the shadow root,
      // otherwise the content lands in the page's <body> without our styles.
      to?: string | HTMLElement
    }
  >(),
  { align: 'center', sideOffset: 4 },
)
const emits = defineEmits<PopoverContentEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'to')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>
```

```vue
  <PopoverPortal :to="props.to">
```

If the generated file imports `reactiveOmit` from somewhere else or the CLI did not add
`@vueuse/core`, run `pnpm add @vueuse/core`. Run `pnpm compile` — expected: no errors.

- [ ] **Step 3: Failing E2E test**

```ts
// tests/e2e/overlay.e2e.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickAction, contentRealm, launch, type Session, startFixtureServer } from './harness'

describe('overlay on a hostile page', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>
  let session: Session

  beforeAll(async () => {
    server = await startFixtureServer()
    session = await launch()
    await session.page.goto(`${server.origin}/hostile/`)
    await clickAction(session)
  })

  afterAll(async () => {
    await session?.browser.close()
    await server?.close()
  })

  it('mounts in a closed shadow root with Tailwind styles intact', async () => {
    const realm = await contentRealm(session)
    const styles = await realm.evaluate(async () => {
      for (let i = 0; i < 50 && !globalThis.__webdevOverlay?.shadow; i++) {
        await new Promise((done) => setTimeout(done, 100))
      }
      const shadow = globalThis.__webdevOverlay?.shadow
      const button = shadow?.querySelector<HTMLElement>('[data-testid="overlay-trigger"]')
      if (!button) return null
      const s = getComputedStyle(button)
      return { fontSize: s.fontSize, boxShadow: s.boxShadow, background: s.backgroundColor }
    })
    expect(styles).not.toBeNull()
    expect(styles?.fontSize).toBe('14px') // text-sm in px, despite html { font-size: 30px }
    expect(styles?.boxShadow).not.toBe('none') // shadow-lg needs @property registrations
    expect(styles?.background).not.toBe('rgba(0, 0, 0, 0)')
    const hostIsClosed = await session.page.evaluate(
      () => document.querySelector('webdev-overlay')?.shadowRoot === null,
    )
    expect(hostIsClosed).toBe(true)
  })

  it('sits above the page’s top layer', async () => {
    const tag = await session.page.evaluate(() => {
      const host = document.querySelector('webdev-overlay')
      if (!host) return null
      // The trigger is fixed at the bottom-right corner.
      return document.elementFromPoint(innerWidth - 40, innerHeight - 30)?.tagName.toLowerCase()
    })
    expect(tag).toBe('webdev-overlay')
  })

  it('opens the popover inside the shadow root, not in the page', async () => {
    const realm = await contentRealm(session)
    const inShadow = await realm.evaluate(async () => {
      const shadow = globalThis.__webdevOverlay?.shadow
      shadow?.querySelector<HTMLElement>('[data-testid="overlay-trigger"]')?.click()
      for (let i = 0; i < 50; i++) {
        if (shadow?.querySelector('[data-testid="overlay-popover"]')) return true
        await new Promise((done) => setTimeout(done, 100))
      }
      return false
    })
    expect(inShadow).toBe(true)
    const inPage = await session.page.evaluate(
      () => document.querySelector('[data-testid="overlay-popover"]') !== null,
    )
    expect(inPage).toBe(false)
  })
})
```

Run: `pnpm build && pnpm test:e2e`
Expected: FAIL — `styles` is `null` (no overlay is injected yet).

- [ ] **Step 4: Overlay content script**

```ts
// src/entrypoints/overlay.content/index.ts
import styles from '@/assets/tailwind.css?inline'
import { type App as VueApp, createApp } from 'vue'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import { defineContentScript } from 'wxt/utils/define-content-script'
import Overlay from './Overlay.vue'

declare global {
  // Lives in the content-script world only: pages and other extensions cannot read it.
  // Guards against double injection; E2E tests reach the closed shadow root through it.
  var __webdevOverlay: { shadow?: ShadowRoot } | undefined
}

export default defineContentScript({
  // Injected by the background after an action click; never declared in the manifest.
  registration: 'runtime',
  // CSS is passed inline: with 'ui' mode Chrome would block the stylesheet fetch.
  cssInjectionMode: 'manual',
  async main(ctx) {
    if (globalThis.__webdevOverlay) return
    globalThis.__webdevOverlay = {}
    const ui = await createShadowRootUi<VueApp>(ctx, {
      name: 'webdev-overlay',
      position: 'overlay',
      zIndex: 2147483647,
      anchor: 'body',
      append: 'last',
      mode: 'closed',
      css: styles.replaceAll(':root', ':host'),
      onMount(container) {
        const app = createApp(Overlay, { portalTarget: container })
        app.mount(container)
        return app
      },
      onRemove(app) {
        app?.unmount()
      },
    })
    ui.mount()
    globalThis.__webdevOverlay.shadow = ui.shadow
  },
})
```

```vue
<!-- src/entrypoints/overlay.content/Overlay.vue -->
<!-- Placeholder until milestone 2: proves styling, layering and portals in the shadow root. -->
<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

defineProps<{ portalTarget: HTMLElement }>()
</script>

<template>
  <!-- Max z-index on every positioned layer: pages use it too, and the host is appended last,
       so equal z-index puts the overlay on top. The portaled content needs its own. -->
  <div class="fixed right-4 bottom-4 z-[2147483647] font-sans">
    <Popover>
      <PopoverTrigger as-child>
        <Button data-testid="overlay-trigger" size="sm" class="shadow-lg">Webdev overlay</Button>
      </PopoverTrigger>
      <PopoverContent
        :to="portalTarget"
        data-testid="overlay-popover"
        class="z-[2147483647] w-64 text-sm"
      >
        Marking tools arrive in the next version.
      </PopoverContent>
    </Popover>
  </div>
</template>
```

If `pnpm compile` rejects the `?inline` import, create `src/env.d.ts` with
`/// <reference types="vite/client" />`.

- [ ] **Step 5: Inject from the background**

```ts
// src/entrypoints/background.ts
import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    // Chrome accepts sidePanel.open() only synchronously inside the user gesture:
    // nothing may be awaited before this call.
    void browser.sidePanel.open({ windowId: tab.windowId })
    if (tab.id === undefined) return
    browser.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/overlay.js'] })
      // Restricted pages (chrome://, Web Store) refuse injection; milestone 2 reports it in the panel.
      .catch(() => undefined)
  })
})
```

Run: `pnpm build && pnpm manifest:check && pnpm test:e2e`
Expected: manifest check passes (no `web_accessible_resources`, no `content_scripts`); all E2E
tests PASS.

- [ ] **Step 6: If a styling assertion fails under the strict CSP**

Only if `fontSize`/`background` is wrong on the hostile page but right on the plain page (check
by temporarily pointing the test at `/plain/`): the CSP blocked the `<style>` element in the
shadow root. Switch to constructed stylesheets, which CSP `style-src` does not govern: pass
`css: ''` to `createShadowRootUi` and in `onMount(container, shadow)` add

```ts
const sheet = new CSSStyleSheet()
sheet.replaceSync(styles.replaceAll(':root', ':host'))
shadow.adoptedStyleSheets = [sheet]
// @property only works at document level.
const props = styles.match(/@property[^{]+\{[^}]*\}/g)?.join('\n') ?? ''
if (props) {
  const doc = new CSSStyleSheet()
  doc.replaceSync(props)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, doc]
}
```

Rerun: `pnpm build && pnpm test:e2e` — Expected: PASS. If only `boxShadow` fails, apply just
the `@property` part.

- [ ] **Step 7: Record the spike results**

In spec section 13, under each of spikes 1–3, add a line "**Result (date):** …" stating what
the E2E tests showed (action click + `activeTab` + panel; Puppeteer trigger; overlay styling
under CSP with or without the Step 6 fallback). If Step 6 was needed, add that to spec
section 10 ("strict CSP" row).

- [ ] **Step 8: Full verification and commit**

Run: `pnpm check && pnpm build && pnpm manifest:check && pnpm test:e2e`
Expected: everything green.

Manual check in a real Chrome (the owner, on their desktop): load `.output/chrome-mv3` via
`chrome://extensions` → Developer mode → Load unpacked; click the icon on any page → side panel
opens and the overlay button appears bottom-right; `Alt+Shift+A` does the same.

```bash
git add -A && git status --short
git cm -m "Inject a shadow-root overlay and verify it on a hostile page"
```

Open the milestone PR: `gh pr create`, then request the review
(`gh api -X POST repos/rudipeusquens/webdev-browser-extension/pulls/<nr>/requested_reviewers -f 'reviewers[]=rudipeusquens'`).
Before requesting it, run an independent review agent over the whole branch and fix its
findings.

---

## Milestone 2: Element marking end to end (first usable version)

**Goal:** Activate on a tab, pick an element, comment, see it in the side panel, copy the
Markdown. Single page; pins come back when the overlay is activated again, re-anchoring after
DOM changes is milestone 4. The collection itself persists.

**Expanded on 2026-10-05** from the milestone 1 results. Tasks 7–15 name files, interfaces and
the tests to write first; the implementation follows in the same pull request. Steps are
test-first: write the listed tests, watch them fail, implement, watch them pass, commit.

**Facts this milestone relies on** (verified on 2026-10-05, Chrome for Testing 154):

- A modal `<dialog>` makes every node outside it inert, including an overlay host shown as
  `popover="manual"` above it in the top layer: hit testing skips it, clicks and focus fail.
- An overlay host that is a **descendant of the open modal dialog** and shown as a popover is
  on top, receives trusted clicks, takes focus and keyboard input, and is positioned against
  the viewport even when the dialog has `transform`, `overflow: hidden` and `contain: paint`.
  `document.elementsFromPoint()` under it returns `[host, …elements inside the dialog…]`.
- Closing the dialog leaves the host inside it; removing the dialog element removes the host
  too. Both must be detected (attribute `open`, child list) and the host moved back to `body`.
- `hidePopover()` + `showPopover()` on a manual popover re-raises it above later top-layer
  elements and does not close the page's `popover="auto"` elements.
- WXT's `createShadowRootUi` moves `@property` rules into a `<style>` in the page's `<head>`;
  `isolateEvents` stops the listed events at the shadow root, so page listeners in the bubble
  phase never see them (capture-phase page listeners still do).
- `crypto.randomUUID()` exists only in secure contexts; content scripts on plain-HTTP hosts
  other than `localhost` must build ids from `crypto.getRandomValues()`.
- Chrome 116 does not accept a promise returned from `runtime.onMessage` listeners; use
  `sendResponse` and `return true`.
- Found in the final review: `document.execCommand()` from the page edits a focused textarea
  inside a closed shadow root, with trusted `input` events but no `beforeinput`; modal dialogs
  inside web components need `chrome.dom.openOrClosedShadowRoot()` to be found; script focus
  traps accept the overlay only when its host is inside their container; named form controls
  shadow DOM properties of their form.

**Known limits** (documented in the spec, not fixed in this milestone): clicking to mark closes
page popovers that light-dismiss (`popover="auto"`, `dialog closedby="any"`, script menus that
close on an outside `pointerdown`) — hovering and pressing `Enter` selects without a click;
hover-only menus cannot be reached by pointing; a page can observe what is typed into the
comment field.

**Pre-flight (shared interfaces):** Task 7 types are consumed by Tasks 8–14; Task 9
`snapshotElement` feeds the `annotation:add` message of Tasks 10 and 12; Task 10's message
union is used by the overlay (12, 14) and the panel (13); Task 11's `keepOnTop` is called by
the overlay entry of Task 12.

### Task 7: Collection model, operations and validation

**Files:**

- Create: `src/lib/collection/model.ts`, `src/lib/collection/ops.ts`,
  `src/lib/collection/validate.ts`, `src/lib/collection/store.ts`
- Test: `tests/unit/collection-ops.test.ts`, `tests/unit/collection-validate.test.ts`

**Interfaces:**

- Produces (model.ts): the spec section 5 types `Collection`, `PageInfo`, `Annotation`,
  `ElementSnapshot`, `CodeOrigin`, `ElementTarget`, `TextTarget`, `AreaTarget`, plus
  `Rect = { x; y; width; height }`, `Target = ElementTarget | TextTarget | AreaTarget` and
  `LIMITS = { text: 120, selected: 500, context: 40, originChain: 5, areaElements: 10,
selectorDepth: 8, comment: 5000, title: 120, tag: 200, attribute: 60, styleValue: 80,
url: 8192, selector: 1000, path: 500, name: 100 }`.
- Produces (ops.ts, pure): `emptyCollection(): Collection`;
  `addAnnotation(c, input: NewAnnotation, now: string): Collection` with
  `NewAnnotation = { id: string; page: PageInfo; target: Target; comment: string }`;
  `updateComment(c, id, comment, now): Collection`; `removeAnnotation(c, id): Collection`;
  `clearAll(): Collection`; `groupByPage(c): PageGroup[]` with
  `PageGroup = { key: string; page: PageInfo; items: Annotation[] }`.
- Produces (validate.ts): `isAnnotationId(x)` (`/^[A-Za-z0-9_-]{1,64}$/`), `isPageInfo(x)`,
  `isElementSnapshot(x)`, `isTarget(x)`, `isCollection(x)` — type guards that also enforce the
  `LIMITS` (lengths in code points), finite numbers, `http:`/`https:`/`file:` URLs and style
  keys from the curated list.
- Produces (store.ts): `COLLECTION_KEY = 'collection'`; `loadCollection(): Promise<Collection>`
  (invalid or missing → `emptyCollection()`); `watchCollection(cb): () => void`.

- [ ] **Step 1: Write the failing tests**

`collection-ops.test.ts` (fixtures built with a local `element(selector)` helper):

- `addAnnotation` numbers items 1, 2, 3 and stores `pages[pageKey(url)]` with the latest page
  info; `createdAt === updatedAt === now`.
- An id that already exists leaves the collection unchanged.
- `removeAnnotation` of item 2 keeps numbers 1 and 3 and `nextNumber` 4 (gap); removing the
  last item of a page removes its page entry.
- `updateComment` changes comment and `updatedAt`, keeps number and `createdAt`; unknown id →
  unchanged.
- `clearAll()` resets `nextNumber` to 1; the next add gets number 1.
- `groupByPage`: pages ordered by their first annotation's number (page B marked first, then
  A, then B again → B, A), items inside a page by number; the input is not mutated.

`collection-validate.test.ts`:

- A valid collection with element, text and area targets passes `isCollection`.
- Rejected: wrong `version`, a `text` of 121 code points, a non-finite box value, a style key
  outside the curated list, a `javascript:` page URL, an origin chain of 6, an area with 11
  elements, an id with a space, an item whose `pageKey` has no `pages` entry.
- 120 emoji (240 UTF-16 units) still pass the 120 limit: limits count code points.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/unit/collection-ops.test.ts tests/unit/collection-validate.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement** `model.ts`, `ops.ts` (no mutation of the input), `validate.ts`,
      `store.ts` (reads `browser.storage.local`, validates with `isCollection`).

- [ ] **Step 4: Run them to see them pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit** — `Add the collection model, operations and validation`

### Task 8: Markdown formatter

**Files:**

- Create: `src/lib/text.ts`, `src/lib/format/escape.ts`, `src/lib/format/markdown.ts`,
  `tests/unit/golden/spec-example.md`, `tests/unit/golden/hostile-text.md`
- Modify: `.prettierignore` (golden files are compared byte for byte)
- Test: `tests/unit/text.test.ts`, `tests/unit/format-escape.test.ts`,
  `tests/unit/format-markdown.test.ts`

**Interfaces:**

- Consumes: Task 7 types and `groupByPage`.
- Produces: `clean(s: string, max?: number): string` (removes C0/C1 control characters and
  bidirectional formatting characters, collapses whitespace including line breaks to one
  space, trims, truncates to `max` code points ending in `…`); `truncate(s, max)`;
  `inlineCode(s)` (fence one backtick longer than the longest run inside, padded with spaces
  when `s` starts or ends with a backtick); `quoted(s)` (`"…"`, escaping `\` and `"`);
  `blockquote(comment)` (each line prefixed with `> `, empty lines `>`);
  `formatCollection(c: Collection): string` (ends with one newline).

Formatter rules beyond spec section 7: the heading counts items and pages with singular forms
("1 item on 1 page"); a page line omits `Title:` when the title is empty; text targets render
`Context: "<before>**<selected>**<after>"` with `before`/`after` exactly as captured (the
capture adds `…` when it cut text); area targets list each element as
`` `<selector>` "<text>" · <innermost component> `` and end with `  - …and N more` when
`moreCount > 0`; `In:`/`Container:` lines show the innermost component, the element `Component:`
line the whole chain joined with `›`, each entry `Name (file)` or `Name (file:line)`.

- [ ] **Step 1: Write the failing tests**

- `text.test.ts`: control characters, `\u202E` and `\u2066` removed; `"a\n\n b\tc"` →
  `"a b c"`; 121 code points capped to 120 ending in `…`; a surrogate pair is never split.
- `format-escape.test.ts`: ``inlineCode('a`b')`` → ``` ``a`b`` ```; ``inlineCode('`x')`` →
  ``` `` `x `` ```; `quoted('say "hi" \\o/')` → `"say \"hi\" \\\\o/"`; `blockquote('a\n\nb')`
  → `"> a\n>\n> b"`.
- `format-markdown.test.ts`:
  - the spec section 7 collection (element with a two-entry Vue chain, text, area with three
    elements, two pages) → equals `golden/spec-example.md` exactly;
  - page text with backticks, `# heading`, `<img src=x onerror=alert(1)>`, `**bold**` and line
    breaks in text, tag, selector and title → equals `golden/hostile-text.md` (every fence
    holds, nothing starts a new line, `"` escaped);
  - a two-line comment becomes a two-line blockquote;
  - after deleting item 2 of 3 the output numbers `### 1.` and `### 3.`;
  - empty text, empty styles and no origin → those lines are absent (never "unknown");
  - one item → heading `# UI feedback: 1 item on 1 page`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/unit/text.test.ts tests/unit/format-escape.test.ts tests/unit/format-markdown.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**, add `tests/unit/golden` to `.prettierignore`.

- [ ] **Step 4: Run them to see them pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit** — `Format the collection as a Markdown prompt`

### Task 9: Capture library

**Files:**

- Create: `src/lib/capture/selector.ts`, `src/lib/capture/styles.ts`,
  `src/lib/capture/snapshot.ts`
- Test: `tests/unit/capture-selector.test.ts`, `tests/unit/capture-styles.test.ts`,
  `tests/unit/capture-snapshot.test.ts`

**Interfaces:**

- Consumes: Task 7 `ElementSnapshot`, `PageInfo`, `LIMITS`; Task 8 `clean`, `truncate`.
- Produces: `buildSelector(el: Element, root?: ParentNode): string`; `cssEscape(s)`;
  `isStableId(id)`; `isStableClass(name)`; `CURATED_STYLES` (spec section 6 order);
  `pickStyles(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): Record<string, string>`;
  `openingTag(el)`; `visibleText(el)`; `snapshotElement(el: Element): ElementSnapshot`;
  `pageInfo(win: Window): PageInfo`.

Selector algorithm: from the element upwards, usually at most 8 levels: an element with a stable
unique `#id`, `[data-testid]` or `[data-test]` becomes the root of the selector; otherwise the
segment is the tag plus up to two stable classes (classes without digits first), with
`:nth-of-type(n)` when another sibling matches the same segment; stop at the first unique
selector. If 8 levels are not unique, continue up to `body` (uniqueness wins over length; rare,
deep generic DOMs). Generated ids: React `useId` forms (`:r1:`, `«r1»`, `_r_1_`), `v-12`, runs
of four or more digits, library prefixes (`radix-`, `reka-`, `headlessui-`), longer than 64.
Unstable classes: CSS-module and hash shapes (`Button_root__x7f2a`, `css-1h2k3l`, `sc-…`,
`jsx-123`, `svelte-1abc2d`), Tailwind arbitrary values and variants (`[`, `:`, `/`, `!`),
state classes (`active`, `is-open`, `selected`, …), longer than 40.

Styles: `display`, `width`, `height`, `font-*`, `line-height`, `color` always; `position`
unless `static`; `margin`, `padding`, `border-radius` unless `0px`; `background-color` unless
transparent; `border` unless its width is `0px` or its style `none`; `gap`, `flex-direction`,
`justify-content`, `align-items` only on flex and grid containers and unless `normal`;
`grid-template-columns` only on grid containers and unless `none`; values capped at 80.

Snapshot: `input`, `textarea` and `select` keep only `type` and `name` in the opening tag and
an empty text; other elements keep attributes in source order, each value capped at 60, the
tag at 200; text is `innerText` (fallback `textContent`) cleaned to 120; the box is the
bounding rect plus scroll offset, rounded.

- [ ] **Step 1: Write the failing tests** (happy-dom documents built per test)

- selector: unique stable id → `#save`; `id=":r1:"`, `"v-12"`, `"el-123456"` skipped;
  `data-testid="save"` → `[data-testid="save"]`; `class="Button_root__x7f2a card"` →
  `div.card`; **three identical `li.item` siblings → each gets its own
  `:nth-of-type(n)` selector** (Review Focus 3); a 20-level generic `div` tree → selector depth
  ≤ 8 and unique; ids and classes with special characters (`a.b`, `1st`) escaped and still
  matching; for every case `root.querySelectorAll(result)` has length 1 and contains `el`.
- styles: a fake declaration with every curated property → keys in curated order, defaults
  dropped per the rules above, a 200-character `font-family` capped.
- snapshot: text of 300 characters → 120 ending in `…`; `<input type="email" name="email"
value="person@example.com" placeholder="x">` → opening tag `<input type="email"
name="email">`, text `""`; `<textarea name="note">secret</textarea>` and `<select>` with
  options → no value, no text; an attribute value of 100 characters capped at 60; the box
  adds `scrollX`/`scrollY`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/unit/capture-selector.test.ts tests/unit/capture-styles.test.ts tests/unit/capture-snapshot.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement** the three modules.

- [ ] **Step 4: Run them to see them pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit** — `Capture selectors, styles and element snapshots`

### Task 10: Messages and the background as single writer

**Files:**

- Create: `src/lib/messages.ts`, `src/lib/background/writer.ts`,
  `src/lib/background/tab-status.ts`
- Modify: `src/entrypoints/background.ts`
- Test: `tests/unit/messages.test.ts`, `tests/unit/background-writer.test.ts`,
  `tests/unit/tab-status.test.ts`

**Interfaces:**

- Consumes: Task 7 ops, validators, `COLLECTION_KEY`, `loadCollection`.
- Produces (messages.ts): `Mode = 'browse' | 'element'`;
  `BackgroundMessage = { type: 'annotation:add'; id; page: PageInfo; target: Target; comment }
| { type: 'annotation:update'; id; comment } | { type: 'annotation:remove'; id }
| { type: 'collection:clear' }`;
  `OverlayMessage = { type: 'overlay:status' } | { type: 'overlay:set-mode'; mode: Mode }
| { type: 'overlay:highlight'; id: string | null } | { type: 'overlay:reveal'; id }`;
  `PanelMessage = { type: 'overlay:changed' }`; `Message` (all three);
  `OverlayStatus = { host: string; pageKey: string; mode: Mode }`;
  `Reply = { ok: true } | { ok: false; error: string }`; guards `isMessage`,
  `isBackgroundMessage`, `isOverlayMessage`. Comments: 1 to 5000 code points after trimming.
- Produces (writer.ts): `createWriter(): (msg: BackgroundMessage) => Promise<Reply>` — reads,
  applies one op and writes `storage.local`, with all calls serialized through one promise
  chain.
- Produces (tab-status.ts): `markBlocked(tabId)`, `clearBlocked(tabId)`,
  `isBlocked(tabId): Promise<boolean>` on `storage.session` (key `blocked:<tabId>`; runtime
  state only, never `storage.local`).
- Background: `onClicked` marks the tab blocked when injection fails and clears it on success;
  `runtime.onMessage` accepts only `sender.id === runtime.id` and `isBackgroundMessage`,
  requires `sender.tab` for `annotation:add`, answers with `sendResponse` + `return true`;
  `tabs.onUpdated` (status `loading`) and `tabs.onRemoved` clear the blocked flag.

- [ ] **Step 1: Write the failing tests** (WXT fake browser, `fakeBrowser.reset()` before each)

- messages: every message type accepted with a valid shape; rejected: unknown `type`,
  missing or extra-long `id`, empty or 5001-code-point comment, `mode: 'area'`, an
  `annotation:add` whose target fails `isTarget`, `null`, strings, arrays.
- writer: add → storage holds item 1; **two adds started in parallel → numbers 1 and 2, both
  stored**; update keeps the number; remove leaves a gap; clear empties; an add with an
  existing id → `{ ok: false }` and storage unchanged; invalid stored data is replaced by an
  empty collection on the next write.
- tab-status: mark → `isBlocked` true; clear → false; keys live in `storage.session`, none in
  `storage.local`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/unit/messages.test.ts tests/unit/background-writer.test.ts tests/unit/tab-status.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement** the modules and wire `background.ts`.

- [ ] **Step 4: Run them to see them pass**, then `pnpm build && pnpm test:e2e`.
      Expected: PASS; the milestone 1 E2E tests still pass.

- [ ] **Step 5: Commit** — `Route annotations through the background as the only writer`

### Task 11: Overlay in the top layer above modal dialogs

**Files:**

- Create: `src/entrypoints/overlay.content/top-layer.ts`,
  `tests/fixtures/sites/modal/index.html`, `tests/fixtures/sites/modal/modal.js`,
  `tests/e2e/top-layer.e2e.test.ts`
- Modify: `src/entrypoints/overlay.content/index.ts`

**Interfaces:**

- Produces: `keepOnTop(host: HTMLElement, shadow: ShadowRoot): () => void` — makes the host a
  `popover="manual"` with `!important` inline resets, shows it, and from then on: when a modal
  dialog opens, moves the host into the topmost open modal dialog and re-shows it; when that
  dialog closes or leaves the DOM, moves the host back to `body`; re-raises the host after a
  page popover opens (`toggle` events in the capture phase, ignoring the host's own) and after
  `fullscreenchange`; removes an `inert` attribute a page puts on the host; restores focus to
  the element that had it inside the shadow root after every move. Returns a stop function.
- `index.ts` passes `isolateEvents` (key, pointer, mouse, focus and click events) to
  `createShadowRootUi` and calls `keepOnTop` after mounting; `ctx.onInvalidated` stops it.

- [ ] **Step 1: Modal fixture and failing E2E**

`modal/index.html` has a button `#open` that calls `dialog.showModal()` on `#dialog` (script
in `modal.js`, no inline script) and a button `#inside` within the dialog; the dialog uses
`transform` and `overflow: hidden`. `top-layer.e2e.test.ts`:

- modal opened **after** activation: `document.elementFromPoint()` at the overlay trigger
  returns `webdev-overlay`, and a real mouse click on the trigger opens the overlay popover;
- overlay activated **while** the modal is open: same two checks;
- modal closed again: the host is a child of `body` and still on top;
- the dialog element removed while open: the host is back in `body` and mounted.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm build && pnpm vitest run --config vitest.e2e.config.ts tests/e2e/top-layer.e2e.test.ts`
Expected: FAIL, `elementFromPoint` returns the dialog, the click does not open the popover.

- [ ] **Step 3: Implement** `top-layer.ts` and wire it in `index.ts`.

- [ ] **Step 4: Run it to see it pass**, then the whole E2E suite. Expected: PASS.

- [ ] **Step 5: Commit** — `Keep the overlay usable above modal dialogs`

### Task 12: Element mode, comment popover and saving

**Files:**

- Create: `src/entrypoints/overlay.content/picker.ts`, `src/entrypoints/overlay.content/place.ts`,
  `src/entrypoints/overlay.content/ids.ts`, `src/entrypoints/overlay.content/HoverBox.vue`,
  `src/entrypoints/overlay.content/CommentPopover.vue`, `src/components/ui/textarea/*`
  (shadcn-vue CLI), `tests/fixtures/sites/plain/page.js`, `tests/e2e/element-mode.e2e.test.ts`
- Modify: `src/entrypoints/overlay.content/Overlay.vue` (replaces the placeholder),
  `src/entrypoints/overlay.content/index.ts`, `tests/fixtures/sites/plain/index.html`,
  `tests/e2e/overlay.e2e.test.ts`, `tests/e2e/reactivate.e2e.test.ts`,
  `tests/e2e/top-layer.e2e.test.ts`
- Test: `tests/unit/overlay-picker.test.ts`, `tests/unit/overlay-place.test.ts`,
  `tests/unit/overlay-ids.test.ts`, `tests/unit/comment-popover.test.ts`

**Interfaces:**

- Consumes: Task 9 `snapshotElement`, `pageInfo`; Task 10 messages; Task 11 `keepOnTop`.
- Produces: `pickAt(doc: Document, x, y, host: Element): Element | null` (first element under
  the point that is not the host; `html` → `null`); `class TargetPath { current; up(); down() }`
  (`↑` parent up to `body`, `↓` back along the way up, else first element child);
  `isEditable(el: Element | null): boolean`; `placeNear(target: Rect, size: { width; height },
viewport: { width; height }): { x; y }` (below the target if it fits, else above, else
  clamped, 8 px margins); `newId(): string` (16 random bytes from `getRandomValues`, hex);
  `CommentPopover` props `{ rect: Rect; initial?: string; number?: number }`, emits
  `save(comment)` and `cancel`.

Behavior: in element mode a full-viewport glass inside the shadow root takes the pointer;
`pointermove` sets the hover target via `pickAt`, the hover box shows the outline and a chip
`tag · W×H`; `↑`/`↓` walk the `TargetPath`; a click or `Enter` selects the hovered element
and opens the popover next to it; `wheel` over the glass scrolls the nearest scrollable
ancestor of the hovered element. Page clicks never reach the page. Mode keys `E` (element)
and `Esc` (browse; first closes an open popover) act only on trusted events, without
modifiers, while focus is not in a page field. In the popover `Enter` saves (not while
`isComposing`), `Shift+Enter` adds a line, `Esc` cancels; Save is disabled while the comment is
empty. Saving sends `annotation:add` with `newId()`, `pageInfo(window)` and
`{ kind: 'element', element: snapshotElement(el) }`; the mode stays. The overlay answers
`overlay:status` and `overlay:set-mode`, and sends `overlay:changed` when the mode changes.

- [ ] **Step 1: Write the failing unit tests**

- picker: `pickAt` skips the host and returns the next element, maps `html` to `null`;
  `TargetPath` up/up/down/down returns the original element, `up` stops at `body`, `down` on
  a fresh path goes to the first element child, stays put without children; `isEditable` true
  for text `input`, `textarea`, `select`, `[contenteditable]`, false for `button`, checkbox
  `input` and `null`.
- place: fits below → below, aligned with the target's left edge; no room below → above;
  target at the right edge → clamped to `viewport.width - width - 8`; huge target → clamped
  inside the viewport.
- ids: 32 hex characters; two calls differ; works with `crypto.randomUUID` deleted.
- comment-popover (mounted): `Enter` emits `save` with the trimmed text; `Shift+Enter` does
  not; `Enter` with `isComposing` does not; an untrusted `Enter` does not; empty text →
  Save disabled and `Enter` does nothing; `Esc` emits `cancel`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/unit/overlay-picker.test.ts tests/unit/overlay-place.test.ts tests/unit/overlay-ids.test.ts tests/unit/comment-popover.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the failing E2E** `element-mode.e2e.test.ts` on the plain fixture
      (`page.js` counts page clicks in `window.pageClicks`; the fixture gains a scroll box):
      activate → press `e` → hover the Save button → the chip reads `button · W×H`; `↑` → chip
      `div`; `↓` → `button`; click → popover open, `pageClicks` still 0, URL unchanged (the
      form did not submit); type `Make it wider` + `Enter` → `storage.local.collection` holds item
      1 with the comment and an element target whose selector matches the button; the mode is
      still element; `wheel` over the scroll box scrolls it. Update the milestone 1 overlay tests
      to the new UI (styles checked on the hover chip, layering checked with the glass).

- [ ] **Step 4: Implement** the modules, components and `Overlay.vue`; add the textarea with
      `pnpm dlx shadcn-vue@2.8.2 add textarea -y` (revert CLI changes to `tailwind.css`).

- [ ] **Step 5: Run unit and E2E tests to see them pass**

Run: `pnpm test:unit && pnpm build && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit** — `Pick elements and save comments from the overlay`

### Task 13: Side panel list, copy, clear and tab status

**Files:**

- Create: `src/entrypoints/sidepanel/use-collection.ts`,
  `src/entrypoints/sidepanel/use-active-tab.ts`, `src/entrypoints/sidepanel/ItemList.vue`,
  `src/entrypoints/sidepanel/CopyFallbackDialog.vue`, `src/entrypoints/sidepanel/ClearAllDialog.vue`,
  `src/components/ui/{alert-dialog,dialog,toggle-group}/*` (shadcn-vue CLI),
  `tests/e2e/element-flow.e2e.test.ts`
- Modify: `src/entrypoints/sidepanel/App.vue`, `tests/unit/sidepanel-app.test.ts`,
  `tests/e2e/activate.e2e.test.ts`

**Interfaces:**

- Consumes: Task 7 `groupByPage`, `loadCollection`, `watchCollection`; Task 8
  `formatCollection`; Task 10 messages and `isBlocked`.
- Produces: `useCollection(): { collection: Ref<Collection> }`;
  `useActiveTab(): { tabId: Ref<number | undefined>; status: Ref<TabStatus> }` with
  `TabStatus = { kind: 'active'; host; pageKey; mode } | { kind: 'blocked' } | { kind: 'idle' }`
  (pings the overlay with `overlay:status` via `tabs.sendMessage`; refreshes on
  `tabs.onActivated`, `tabs.onUpdated`, `overlay:changed` and `storage.session` changes).

UI: header with the item count and the status line ("Active on localhost:3000", "Can't run on
this page", "Not active on this page. Click the toolbar icon or press Alt+Shift+A."); a mode
switch Browse / Element, enabled only while active, sending `overlay:set-mode`; the list
grouped by page with the current page first and marked "This page"; each entry shows number,
type icon, comment (two lines) and the tag or selector, plus a delete button; footer **Copy as
prompt** (status "Copied 3 items" in a live region) and **Clear all** with a confirmation
dialog. A failing clipboard write opens a dialog with the text in a read-only, pre-selected
textarea. Page-derived strings are rendered as text only.

- [ ] **Step 1: Write the failing unit tests** (`sidepanel-app.test.ts`, mounted with the fake
      browser): empty state and disabled buttons; two stored items on two pages → grouped, numbered,
      comments shown; a tag `<img src=x onerror=alert(1)>` renders literally and creates no `img`;
      Copy → `navigator.clipboard.writeText` receives `formatCollection(stored)` and "Copied 2
      items" appears; a rejected write → the fallback dialog shows the same text; Clear all →
      confirm → `collection:clear` sent; Cancel → nothing sent; delete on an entry →
      `annotation:remove` with its id; status texts for `active`, `blocked` and `idle`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/unit/sidepanel-app.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the failing E2E** `element-flow.e2e.test.ts`: activate on the plain
      fixture → the panel says "Active on localhost:…" → switch to Element in the panel → click
      the Save button → comment + `Enter` → the panel lists item 1 → Copy as prompt → the clipboard
      text equals `formatCollection` of the stored collection and contains `### 1. Element` and the
      comment as a blockquote. A `chrome://` tab → "Can't run on this page".

- [ ] **Step 4: Implement**; add the components with
      `pnpm dlx shadcn-vue@2.8.2 add alert-dialog dialog toggle-group -y`.

- [ ] **Step 5: Run unit and E2E tests to see them pass**

Run: `pnpm test:unit && pnpm build && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit** — `List, copy and clear feedback in the side panel`

### Task 14: Pins, editing, and linking panel entries to the page

**Files:**

- Create: `src/entrypoints/overlay.content/Pins.vue`,
  `src/entrypoints/overlay.content/use-tracking.ts`, `tests/e2e/pins.e2e.test.ts`
- Modify: `src/entrypoints/overlay.content/Overlay.vue`, `src/entrypoints/sidepanel/ItemList.vue`
- Test: `tests/unit/overlay-pins.test.ts`

**Interfaces:**

- Consumes: Task 7 `groupByPage`, `watchCollection`; Task 10 `overlay:highlight`,
  `overlay:reveal`, `annotation:update`; Task 12 `CommentPopover`, `placeNear`.
- Produces: `resolveTargets(items: Annotation[], live: Map<string, Element>, doc): Map<string,
Element>` (live references first, else `querySelector(selector)`, invalid selectors ignored);
  `pinPosition(rect: Rect, viewport): { x; y }` (top-right corner, clamped);
  `useTracking(): Ref<number>` (a frame counter bumped on scroll in the capture phase, resize
  and `ResizeObserver` callbacks, throttled to animation frames).

Behavior: numbered pins at the top-right of each target on the current page, following scroll
and resize; clicking a pin (trusted) opens the popover with the comment, Save sends
`annotation:update`. Hovering a panel entry sends `overlay:highlight` (the overlay outlines the
target), leaving sends `null`; clicking an entry of the current page sends `overlay:reveal`
(scroll into view, open the popover).

- [ ] **Step 1: Write the failing unit tests**: `resolveTargets` prefers a live element, falls
      back to the selector, skips a selector that throws and one that matches nothing;
      `pinPosition` puts the pin at the corner and clamps it into the viewport.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/unit/overlay-pins.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the failing E2E** `pins.e2e.test.ts`: after saving, pin `1` sits within
      16 px of the button's top-right corner; after `window.scrollBy(0, 200)` it moved with the
      button; clicking the pin opens the popover with the comment; editing + `Enter` updates the
      stored comment and keeps number 1; activating again on the same page shows the pin again;
      hovering the panel entry shows the highlight box; clicking it opens the popover.

- [ ] **Step 4: Implement.**

- [ ] **Step 5: Run unit and E2E tests to see them pass**

Run: `pnpm test:unit && pnpm build && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit** — `Show pins and link panel entries to the page`

### Task 15: Hostile pages, untrusted events, page isolation and docs

**Files:**

- Create: `tests/e2e/robustness.e2e.test.ts`, `tests/fixtures/sites/plain/inherit.html`
- Modify: `src/entrypoints/overlay.content/index.ts`, `docs/specs/2026-10-05-annotation-extension.md`
  (sections 8, 10, 13), `AGENTS.md` (status), this plan (milestone 3 note)

- [ ] **Step 1: Write the failing E2E** `robustness.e2e.test.ts`:
  - hostile fixture: press `e`, click the page → the popover is visible, styled (14 px text)
    and above the maximum-z-index layer; `Enter` saves an item for `div.layer`;
  - modal fixture: open the dialog, press `e`, click `#inside`, comment + `Enter` → the stored
    selector matches `#inside`;
  - untrusted events: the page dispatches `keydown` `e`, `click` on the host and on the
    button, and `keydown` `Enter` → the mode stays browse, no popover, nothing stored; after a
    trusted `e` and click, a page-dispatched `Enter` on the document saves nothing;
  - page isolation: on `inherit.html` an element whose `box-shadow` uses an inherited
    `--tw-shadow` keeps its computed style after activation (WXT moves the overlay's
    `@property --tw-*` rules into the page head; `inherits: false` breaks the page's value).

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm build && pnpm vitest run --config vitest.e2e.config.ts tests/e2e/robustness.e2e.test.ts`
Expected: the isolation case FAILS; the other cases pass if Tasks 11–12 hold.

- [ ] **Step 3: Fix** by renaming the overlay's custom properties (`--tw-` → `--wbe-tw-`) in
      the inline CSS, so its registrations cannot collide with the page's.

- [ ] **Step 4: Run all checks**

Run: `pnpm check && pnpm build && pnpm manifest:check && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 5: Docs.** Spec section 13 spike 3: the top-layer result; section 8: `Enter`
      selects the hovered element; section 10: rows for modal dialogs, page popovers and focus
      traps with the known limits above. AGENTS.md: status milestone 2. Milestone 3 below: the
      formatter already renders text and area targets.

- [ ] **Step 6: Commit** — `Harden the overlay against hostile pages and untrusted events`

**Acceptance:** E2E flow green in CI; manual smoke in a real Chrome on a local dev server.

---

## Milestone 3: Text and area marking

**Goal:** Browse mode with the Comment chip for text selections; Area mode with rectangle drag.
All three marking types end up in one copied prompt.

**Expanded on 2026-10-05** from the milestone 2 code. Tasks 16–22 name files, interfaces and
the tests to write first; the implementation follows in the same pull request. Steps are
test-first: write the listed tests, watch them fail, implement, watch them pass, commit. The
formatter already renders text and area targets (milestone 2, `tests/unit/golden/`); the
capture adds the `…` to cut context itself.

**Facts this milestone relies on** (verified on 2026-10-05, Chrome for Testing 154):

- `Selection.toString()` leaves out the values of `input`, `textarea` and `select`, text
  hidden by `display: none` or `visibility: hidden`, and `user-select: none` text when a
  selection spans them. `Range.toString()` includes the default text of a `textarea`, the
  labels of `option`s and hidden text.
- While text inside a focused text field is selected, `document.getSelection()` reports a
  **collapsed** range at the field's position in its parent, but `toString()` returns the
  selected part of the field's value. A mouse selection inside a shadow root looks the same
  (collapsed at `body`, text in `toString()`). Capture therefore never calls
  `Selection.toString()`, and a collapsed selection means "nothing to capture".
- `preventDefault()` on the `mousedown` of a button inside a closed shadow root keeps the
  page's selection when that button is clicked.
- Named `form`, `img`, `embed`, `object` and `iframe` elements shadow properties and methods
  of `document` (`Document` has `[LegacyOverrideBuiltIns]`): `<img name="title">` makes
  `document.title` the image, the same for `body`, `documentElement`, `getSelection`,
  `elementsFromPoint`, `addEventListener` and every other name — **in the page's own world
  only**: in the content script's world `document` keeps its real members (Task 16), while
  named form controls do shadow their form's properties there (milestone 2).
- happy-dom (unit tests) reports `display: ''` for inline elements and implements
  `TreeWalker`, `Range.comparePoint()` and `Element.checkVisibility()`.

**Known limits** (documented in the spec, not fixed in this milestone): text inside shadow
roots and iframes gets no chip (spec section 3); an area is limited to the viewport (no
auto-scroll while dragging), and elements clipped by an overflow container but inside the
rectangle count as inside; after a reload, text and area items find their place through the
container's selector (exact text re-anchoring is milestone 4).

**Review focus for this milestone** (each line has a test in the owning task):

1. Selections that start or end inside a form field or include one: no value is ever
   captured (Task 17 unit, Task 20 E2E).
2. Huge selections (select all on a long page) and areas over huge DOMs: capture stays bounded
   and the tab does not freeze (Tasks 17, 18).
3. The page changes the selection or replaces the selected nodes between chip and save: no
   exception, the popover stays usable, nothing is captured that the user did not see (Tasks
   19, 20).
4. Areas over fixed, transformed or zero-size (`display: contents`) elements and over the
   overlay's own pins (Tasks 18, 21).
5. Named elements that shadow `document` members: every read our code makes still returns
   the real value (Task 16).

**Pre-flight (shared interfaces):** Task 16's document accessors are used by Tasks 17–21;
Task 17 `selectionRange`/`snapshotRange` and Task 18 `snapshotArea` feed the drafts of Tasks
20 and 21; Task 19's `Placement` is what Tasks 20 and 21 put into drafts, pins and the live
map; Task 21 extends `Mode`, which the panel (Task 13) and `keys.ts` (Task 12) consume.

### Task 16: Document reads a page cannot redirect

**Files:**

- Modify: `src/lib/capture/dom.ts`, `src/lib/capture/snapshot.ts` (`pageInfo`),
  `src/entrypoints/overlay.content/picker.ts`, `src/entrypoints/overlay.content/pins.ts`,
  `src/entrypoints/overlay.content/top-layer.ts`, `src/entrypoints/overlay.content/index.ts`
  (anchor as a function), `src/entrypoints/overlay.content/Overlay.vue`
- Create: `tests/fixtures/sites/clobbered/index.html`, `tests/fixtures/sites/clobbered/clobber.js`,
  `tests/e2e/clobbering.e2e.test.ts`
- Test: `tests/unit/capture-dom.test.ts`

**Interfaces:**

- Produces (dom.ts): `bodyOf(doc): HTMLElement | null`, `rootOf(doc): Element | null`
  (`documentElement`), `titleOf(doc): string`, `selectionOf(doc): Selection | null`,
  `elementsAt(doc, x, y): Element[]`, `queryFirst(root: Document | Element, selector): Element |
null` (null for selectors that throw), `queryAll(root, selector): Element[]`,
  `activeElementOf(doc): Element | null`, `scrollingElementOf(doc): Element | null`,
  `listen(target: EventTarget, type, listener, options?)` and `unlisten(...)` — all through
  `Document.prototype` / `EventTarget.prototype`, never through the instance.

- [ ] **Step 1: Write the failing unit tests** `capture-dom.test.ts`: an own property on the
      `document` instance named `title`, `body`, `documentElement`, `getSelection`,
      `elementsFromPoint`, `querySelector`, `activeElement`, `scrollingElement` or
      `addEventListener` (what a named element does) does not change what the accessors
      return; `queryFirst` returns null for `div[[`.
- [ ] **Step 2: Run them to see them fail** — `pnpm vitest run tests/unit/capture-dom.test.ts`,
      Expected: FAIL, accessors not exported.
- [ ] **Step 3: Write the failing E2E** `clobbering.e2e.test.ts` on the `clobbered` fixture
      (`clobber.js` appends `<img name>`/`<form name>` elements for `title`, `body`,
      `documentElement`, `getSelection`, `elementsFromPoint`, `activeElement`,
      `scrollingElement`, `addEventListener`, `removeEventListener`, `querySelectorAll`): activate,
      press `e`, hover and click a button, comment, `Enter` → the stored page title is the
      real title, the selector matches the button. Run it: Expected FAIL (if it passes, the
      isolated world is not affected; record that in the ledger and keep the accessors as
      defense in depth).
- [ ] **Step 4: Implement** the accessors and route every `document.*` read of the overlay
      and capture code through them; pass `anchor: () => bodyOf(document)` to WXT.
- [ ] **Step 5: Run** `pnpm test:unit && pnpm build && pnpm test:e2e` — Expected: PASS.
- [ ] **Step 6: Commit** — `Read the document in a way pages cannot redirect`

**Result (2026-10-05):** the E2E test passed before any change: Chrome does not let named
elements shadow `document` members in a content script's world. The document accessors were
therefore not added; the test stays as a guard, and `dom.ts` gained only `queryFirst`,
`queryAll` (null or empty for selectors that throw) and `shadowRootOf` (through the prototype
getter, since a form's named control can shadow `shadowRoot`).

### Task 17: Text capture

**Files:**

- Create: `src/lib/capture/text.ts`
- Test: `tests/unit/capture-text.test.ts`

**Interfaces:**

- Consumes: Task 16 accessors; `snapshotElement` (Task 9); `clean`, `collapse`, `truncate`.
- Produces: `selectionRange(doc: Document): Range | null` — a clone of the page's selection;
  null when there is none, it is collapsed, the deep focus is a form field (`input`,
  `textarea`, `select`), or either end lies inside one. `rangeContainer(range): Element` —
  the common ancestor element, lifted out of shadow trees to their host.
  `snapshotRange(range: Range): TextTarget | null` — null when the range holds no visible
  text.

Rules: text is read from text nodes with a `TreeWalker`, never with `toString()`; subtrees of
`input`, `textarea`, `select`, `option`, `script`, `style`, `noscript` and `template` are
skipped, so are elements that `checkVisibility()` reports as not rendered, text whose parent
is `visibility: hidden` or `user-select: none`; text nodes in different block boxes (display
other than `inline`, `contents` or empty) and `<br>` are separated by a space. `selected` is
cleaned and capped at 500 code points (`…` when cut, also when the walk stopped early);
whitespace at its edges moves into the context. `before`/`after` come from the nearest block
ancestor of the common ancestor: the last/first 40 code points of the collapsed text, with
`…` when more text was there. Walks stop after a fixed budget of text nodes and characters.

- [ ] **Step 1: Write the failing tests** `capture-text.test.ts`:
  - `<h3>Manage your Email notifcations and alerts</h3>`, range over `Email notifcations` →
    `selected: 'Email notifcations'`, `before: 'Manage your '`, `after: ' and alerts'`,
    container selector `h3`.
  - A long paragraph → `before` starts with `…` and has 41 code points, `after` ends with `…`.
  - 700 selected characters → 500 code points ending with `…`.
  - Edge whitespace and line breaks: `'\n  Email\nnotifications  '` → `selected:
'Email notifications'`, the spaces join the context.
  - Two paragraphs → `'First Second'`, container their parent; `Alpha <b>bold</b> text` →
    `'Alpha bold text'`; `a<br>b` → `'a b'`.
  - A range over a form whose `input` has `.value = 'SECRET-VALUE'`, a `textarea` with text, a
    `select` with options, plus `script` and `style` → none of their text appears in
    `selected`, `before` or `after`.
  - Context stays inside the block: a neighbouring paragraph's text is not in `before`.
  - Collapsed range or a whitespace-only selection → `null`.
  - `selectionRange`: no selection → null; focus in a `textarea` → null; a range that starts
    inside a `textarea` → null; the returned range is a clone (changing the selection later
    does not change it).
  - `rangeContainer` for text in an open shadow root → the host.
  - Budget: a range over 20 000 text nodes returns within the budget with `selected` ending
    in `…`.
- [ ] **Step 2: Run them to see them fail** — `pnpm vitest run tests/unit/capture-text.test.ts`,
      Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `text.ts`.
- [ ] **Step 4: Run them to see them pass** (same command). Expected: PASS.
- [ ] **Step 5: Commit** — `Capture selected text with its context`

### Task 18: Area capture

**Files:**

- Create: `src/lib/capture/area.ts`
- Test: `tests/unit/capture-area.test.ts`

**Interfaces:**

- Consumes: Task 16 accessors, `rectOf`, `childrenOf`, `snapshotElement`.
- Produces: `areaContainer(doc, rect: Rect, skip?: Element): Element` — the deepest visible
  element whose box contains `rect` (viewport coordinates), searched from `body` down; `body`
  when nothing smaller contains it. `elementsInside(container, rect, skip?, budget?):
{ elements: Element[]; total: number }` — the topmost visible elements fully inside `rect`
  (an element counts if it is inside and its parent is not) in document order, the first
  `LIMITS.areaElements`, `total` counted up to `budget` (default 10 000 visited elements).
  `snapshotArea(doc, rect: Rect, skip?: Element): { target: AreaTarget; container: Element }`
  — `target.rect` in page coordinates, rounded.

Rules: zero-size elements (`display: contents`, empty wrappers) are descended, not counted;
elements that intersect the rectangle without being inside are descended; elements outside
are skipped with their subtree; `checkVisibility()` false skips the subtree; `skip` (the
overlay host) is never visited; a 1 px tolerance on every edge.

- [ ] **Step 1: Write the failing tests** `capture-area.test.ts` (boxes stubbed on
      `Element.prototype.getBoundingClientRect` from a map):
  - container: the `section` that holds the rectangle, not `main`, not a card; a rectangle
    bigger than everything → `body`.
  - three cards inside → three elements in document order, `moreCount: 0`.
  - a card partly inside is not counted, its child fully inside is.
  - twelve items inside → ten elements, `moreCount: 2`.
  - nothing inside → `elements: []`, `moreCount: 0`, container set.
  - a zero-size wrapper → its children count; the `skip` element and its children never
    appear; an element with `checkVisibility()` false is skipped.
  - page coordinates: viewport rect + `scrollX`/`scrollY`, rounded.
  - budget: 20 000 children with a budget of 1 000 → returns, `total` ≤ 1 000.
- [ ] **Step 2: Run them to see them fail** — `pnpm vitest run tests/unit/capture-area.test.ts`,
      Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `area.ts`.
- [ ] **Step 4: Run them to see them pass** (same command). Expected: PASS.
- [ ] **Step 5: Commit** — `Capture areas with the elements inside them`

### Task 19: Placements for every target kind

**Files:**

- Modify: `src/entrypoints/overlay.content/pins.ts`, `src/entrypoints/overlay.content/Overlay.vue`
- Test: `tests/unit/overlay-pins.test.ts`

**Interfaces:**

- Consumes: Task 16 `queryFirst`; Task 17 `rangeContainer`.
- Produces: `type LiveAnchor = Element | Range`; `interface Placement { el: Element; rect():
Rect; range?: Range }`; `placeItems(items: Annotation[], live: Map<string, LiveAnchor>,
doc: Document): Map<string, Placement>`; `pinPositions(pins: { id: string; rect: Rect }[],
viewport): { id: string; x: number; y: number }[]` (off-screen dropped, pins that would
  overlap shifted left by one pin width); `pruneLive(live, items)`.

Rules: element → the live element while connected, else the selector's first match. Text →
the live range while it is not collapsed and its start is connected (rect: its bounding box,
el: `rangeContainer`), else the container's selector (rect: the container's box). Area → the
live container or the container's selector, offset by `target.rect - target.container.box`,
sized like `target.rect`. No match → no placement (no pin, reveal says "Not found on this
page."). `Overlay.vue` keeps one `Draft` shape for all kinds: `{ key, el, rect(), range?,
label, busy, error?, target?, live?, edit? }`; deleted items leave the live map
(resolves the deferred minor "the live element map is never pruned"); pins on the same spot
no longer cover each other (deferred minor "two items on the same element").

- [ ] **Step 1: Write the failing tests** in `overlay-pins.test.ts`: the element cases of
      `resolveTargets` moved to `placeItems`; text with a live range → range box and container;
      text whose live range collapsed (its nodes removed) → container by selector; area →
      container box shifted by the stored offset; two pins at the same spot → the second one
      shifted; `pruneLive` drops ids that are no longer items.
- [ ] **Step 2: Run them to see them fail** — `pnpm vitest run tests/unit/overlay-pins.test.ts`,
      Expected: FAIL, `placeItems` not exported.
- [ ] **Step 3: Implement** `pins.ts` and switch `Overlay.vue` (pins, highlight, reveal, edit,
      drafts) to placements.
- [ ] **Step 4: Run** `pnpm test:unit && pnpm build && pnpm test:e2e` — Expected: PASS
      (milestone 2 E2E unchanged).
- [ ] **Step 5: Commit** — `Place pins, highlights and popovers for every target kind`

### Task 20: Text marking end to end

**Files:**

- Create: `src/entrypoints/overlay.content/SelectionChip.vue`,
  `src/entrypoints/overlay.content/TextHighlight.vue`, `tests/fixtures/sites/plain/text.html`,
  `tests/e2e/text-mode.e2e.test.ts`
- Modify: `src/entrypoints/overlay.content/Overlay.vue`, `tests/fixtures/sites/plain/page.js`

**Interfaces:**

- Consumes: Task 17 `selectionRange`, `snapshotRange`, `rangeContainer`; Task 19 drafts and
  placements.

Behavior: in browse mode a trusted `pointerup`, `mouseup` or `keyup` outside the overlay
(window, capture phase) checks the selection on the next frame; when `selectionRange` and
`snapshotRange` find visible text, a **Comment** chip (`data-testid="overlay-chip"`) appears
below the end of the selection and follows scrolling. The chip hides when the selection
collapses or changes (`selectionchange`), when the mode changes and while a popover is open;
a page that only selects text programmatically gets no chip. The chip keeps the selection
(`mousedown` prevented); a trusted click takes the snapshot (`snapshotRange` on the range
selected at that moment), opens the popover next to the selection and draws the selected
lines (`TextHighlight`, at most 50 boxes); saving sends `annotation:add` with the text target
and remembers the range in the live map.

- [ ] **Step 1: Write the failing E2E** `text-mode.e2e.test.ts` (`text.html`: prose with inline
      markup, `<h3>Manage your Email notifcations and alerts</h3>`, a form with a text input,
      a textarea and a select between two paragraphs, a paragraph with `display: none`,
      `visibility: hidden` and `user-select: none` spans; `page.js` can select text and
      dispatch synthetic `mouseup` on request):
  - drag over `Email notifcations` → chip → click → popover → type + `Enter` → stored text
    target with that `selected`, `before` ending in `Manage your `, container selector
    matching the `h3`; the panel lists it; copy → the clipboard has `### 1. Text` and
    `- Context: "Manage your **Email notifcations** and alerts"`.
  - Review Focus 1: type `SECRET-VALUE` into the input and drag inside it → no chip (after
    300 ms); double-click inside the textarea → no chip; drag from the paragraph before the
    form to the one after → chip → save → the stored collection contains neither
    `SECRET-VALUE`, the textarea text nor an option label.
  - Hidden text: drag across the paragraph with hidden spans → `selected` lacks them.
  - The page selects text by script and dispatches a synthetic `mouseup` → no chip.
  - Double-click a word → chip; `Esc` in the popover → no item, the highlight is gone.
  - After saving, a pin appears at the selection; clicking it opens the edit popover.
- [ ] **Step 2: Run it to see it fail** —
      `pnpm build && pnpm vitest run --config vitest.e2e.config.ts tests/e2e/text-mode.e2e.test.ts`,
      Expected: FAIL, no chip.
- [ ] **Step 3: Implement** the chip, the highlight and the text draft in `Overlay.vue`.
- [ ] **Step 4: Run** `pnpm test:unit && pnpm build && pnpm test:e2e` — Expected: PASS.
- [ ] **Step 5: Commit** — `Comment on selected text from a chip next to the selection`

### Task 21: Area mode end to end

**Files:**

- Modify: `src/lib/messages.ts` (`Mode` gains `'area'`), `src/entrypoints/overlay.content/keys.ts`,
  `src/entrypoints/overlay.content/picker.ts` (`forwardsWheel`),
  `src/entrypoints/overlay.content/Overlay.vue`, `src/entrypoints/overlay.content/HoverBox.vue`
  (dashed tone), `src/entrypoints/overlay.content/CommentPopover.vue` (re-measure),
  `src/entrypoints/sidepanel/App.vue`, `tests/fixtures/sites/plain/plain.css`
- Create: `tests/e2e/area-mode.e2e.test.ts`
- Test: `tests/unit/overlay-keys.test.ts`, `tests/unit/messages.test.ts`,
  `tests/unit/overlay-picker.test.ts`, `tests/unit/sidepanel-app.test.ts`,
  `tests/unit/comment-popover.test.ts`

**Interfaces:**

- Consumes: Task 18 `snapshotArea`; Task 19 drafts and placements.
- Produces: `Mode = 'browse' | 'element' | 'area'`; `ShortcutState.dragging`;
  `pageShortcut` returns `{ mode: 'area' }` for `a`/`A` and `'cancel'` for `Escape` while
  dragging; `forwardsWheel(e): boolean` (false with `ctrlKey` or `metaKey`, so the browser
  zooms — resolves the deferred minor "wheel blocks Ctrl+zoom").

Behavior: in area mode the glass takes the pointer with a crosshair; a trusted primary
`pointerdown` starts a drag (pointer captured), `pointermove` draws a dashed rectangle with a
`W×H` label, `pointerup` selects it when it is at least 4 × 4 px, otherwise nothing happens.
`Esc` during a drag cancels it and stays in area mode. The selected area keeps its dashed
outline while the popover is open; saving sends `annotation:add` with the area target and
remembers the container in the live map. The wheel scrolls under the pointer as in element
mode. The panel's mode switch gains **Area** with the hint `A`. The popover measures its size
again when it grows (resolves the deferred minor "popover placement uses the size measured at
mount").

- [ ] **Step 1: Write the failing unit tests**: keys (`a` → area; `Escape` while dragging →
      cancel; `a` ignored while drafting and in page fields); messages (`overlay:set-mode` with
      `area` is valid); picker (`forwardsWheel` false with Ctrl or Meta); panel (the Area toggle
      sends `overlay:set-mode` `area`); popover (a grown card re-measures its size).
- [ ] **Step 2: Run them to see them fail** —
      `pnpm vitest run tests/unit/overlay-keys.test.ts tests/unit/messages.test.ts tests/unit/overlay-picker.test.ts tests/unit/sidepanel-app.test.ts tests/unit/comment-popover.test.ts`,
      Expected: FAIL.
- [ ] **Step 3: Write the failing E2E** `area-mode.e2e.test.ts` on the plain fixture (the
      features section gets padding so a rectangle around the cards fits inside it): press
      `a` → glass; drag from above-left of the first card to below-right of the third → the
      dashed box and its label appear during the drag; release → popover; comment + `Enter` →
      stored area target with three `div.card` elements (`Fast setup`, `Secure`, `Support`),
      container selector matching `section.features`, `rect.y` including the scroll offset;
      `pageClicks` stays 0 and no page text is selected; a click without dragging opens
      nothing; `Esc` during a drag cancels it, a second `Esc` returns to browse; the panel's
      Area toggle switches the mode; a pin appears at the area's top-right corner.
- [ ] **Step 4: Implement** the mode, the drag, the dashed box and the panel toggle.
- [ ] **Step 5: Run** `pnpm test:unit && pnpm build && pnpm test:e2e` — Expected: PASS.
- [ ] **Step 6: Commit** — `Mark areas by dragging a rectangle`

### Task 22: One prompt with all three kinds, hostile pages and docs

**Files:**

- Create: `tests/e2e/all-kinds.e2e.test.ts`
- Modify: `tests/e2e/clobbering.e2e.test.ts`, `tests/e2e/robustness.e2e.test.ts`,
  `tests/fixtures/sites/modal/index.html`, `tests/fixtures/sites/trap/index.html`,
  `docs/specs/2026-10-05-annotation-extension.md` (sections 8, 10, 11), `AGENTS.md` (status),
  this plan (milestone 4 note)

- [ ] **Step 1: Write the E2E tests**:
  - `all-kinds.e2e.test.ts` (acceptance): on the plain fixture mark an element, a text
    selection and an area, copy from the panel → the clipboard equals
    `formatCollection(stored)` and holds `### 1. Element`, `### 2. Text` and `### 3. Area`
    with their lines.
  - clobbering fixture: text and area marking store the real title and correct targets.
  - modal fixture: inside an open modal dialog, select text → chip → save; press `a` and drag
    inside the dialog → the stored elements are the dialog's.
  - trap fixture: select text inside the trap container → chip → typing goes into the
    comment field and `Enter` saves.
- [ ] **Step 2: Run them** — `pnpm build && pnpm test:e2e`. Expected: PASS if Tasks 16–21
      hold; a failure is a bug in those tasks, fixed test-first.
- [ ] **Step 3: Run all checks** — `pnpm check && pnpm build && pnpm manifest:check && pnpm test:e2e`,
      Expected: PASS.
- [ ] **Step 4: Docs.** Spec section 8: the chip appears after a trusted pointer or key release,
      areas need 4 × 4 px, `Esc` cancels a drag; section 10: rows for text in web components
      and iframes and for area limits; section 11: `document` reads through prototypes, page
      text never read with `Selection.toString()`. AGENTS.md: status milestone 3. Milestone 4
      below: text and area items already re-anchor through their container.
- [ ] **Step 5: Commit** — `Cover all three marking types in one prompt and on hostile pages`

**Acceptance:** all three marking types appear correctly in one copied prompt; E2E green in
CI; manual smoke in a real Chrome.

---

## Milestone 4: Across pages, re-anchoring, remembered sites, code origin

**Goal:** Collections survive reloads, HMR and navigation; pins re-anchor; remembered origins
auto-load the overlay; Vue and Astro origins in the output.

**Expanded on 2026-10-06** from the milestone 3 code. Tasks 23–30 name files, interfaces and
the tests to write first; the implementation follows in the same pull request, which builds
on the milestone 3 branch. Steps are test-first: write the listed tests, watch them fail,
implement, watch them pass, commit.

**Facts this milestone relies on** (verified on 2026-10-06, Chrome for Testing 154):

- `activeTab` survives a reload and a same-origin navigation of the tab and ends with a
  cross-origin one; the background can then still inject scripts into the tab. It does not
  survive a reload of the extension.
- `chrome.scripting.executeScript({ world: 'MAIN', func, args })` runs on a page with a
  strict CSP and returns the function's result. `target.documentIds` (Chrome 106) pins it to
  the document that asked.
- A Vite dev server with `@vitejs/plugin-vue` gives every element a non-enumerable
  `__vueParentComponent` in the page's world (invisible to the content script's world);
  `type.__file` is the absolute path of the `.vue` file, `type.__name` the name of a
  `<script setup>` component. HMR re-renders a component in place after its file changes.
  Vite 8, `@vitejs/plugin-vue` and `vue` resolve from the repository root; a fixture copied
  into a temporary directory runs with `vue` aliased to the repository's copy.
- A test copy of the build whose manifest adds `host_permissions: ["http://localhost/*"]`
  answers `permissions.contains({ origins: ["http://localhost:<port>/*"] })` with true;
  `permissions.remove` of it fails ("You cannot remove required permissions");
  `scripting.registerContentScripts` accepts match patterns with a port and injects the
  registered overlay on the next load. The permission prompt itself cannot be automated.
- After `chrome.runtime.reload()` the old overlay stays on the page: nothing removes it.
  WXT's `ctx.isInvalid` notices a missing `browser.runtime.id` and runs the context's
  `onInvalidated` callbacks, which remove its UI; `ctx.setInterval` checks it on every tick.
- The Navigation API exists in the content script's world: `navigation.currententrychange`
  fires for `pushState`, `replaceState`, hash changes and back/forward.
- WXT's fake browser does not implement `permissions.*` or `scripting.*registered*`; unit
  tests install in-memory fakes for them.
- happy-dom's `TreeWalker.previousNode()` loses its place after a skipped element that has
  children (Chrome follows the spec); backward text walks are proven in Chrome.

**Decisions:**

- **Bridge by selector.** The overlay sends the selectors of the snapshots it just took; the
  main-world function looks them up with the prototype's `querySelector`. No attribute is
  written into the page. A DOM change between snapshot and lookup (tens of milliseconds) can
  give the origin of a replaced element; the page can lie about its components anyway, so
  origin data is page data: validated, capped, escaped.
- **Astro without the bridge.** `data-astro-source-*` are DOM attributes the content script
  reads itself. Vue wins when both exist (a Vue island inside an Astro page).
- **Origins arrive while the comment is typed.** The popover opens at once; the request runs
  in the background and the save waits for it at most 1.5 s after the target was marked.
- **No overlay after a plain reload** of a site that is not remembered: that is what
  **Always enable here** is for. **Go to** in the panel is the extension's own navigation and
  starts the overlay on the new page when the tab's grant still holds.
- **Orphaned overlays** remove themselves within a second (`ctx.setInterval`); the panel then
  shows the tab as not active, and a click on the toolbar icon starts a fresh overlay without
  a reload. After an update, tabs on remembered sites get a fresh overlay from the
  background. This replaces the "Reload the page" status of the spec.
- **Anchor status** ("not found") lives in `storage.session` (key `missing`, item ids),
  written by the background from overlay reports. An item counts as missing only after it
  was not found for 1.5 s, so HMR and slow first renders do not flap.
- **Remembered sites** are origins the developer remembered in the panel and Chrome still
  grants; access granted elsewhere (`chrome://extensions`) does not auto-load the overlay.
  The background keeps settings and the registered content script in step on remember,
  forget, `permissions.onRemoved`, install, update and browser start.

**Known limits** (documented in the spec): only the top frame gets the bridge; Vue 2 and
production builds have no component data; a page can fake or hide its components; a
remembered site gets the overlay on its next load, not in tabs that are already open (except
after an update of the extension); text re-anchoring searches only the container the
selection had and gives up after the reader's budget.

**Review focus for this milestone** (each line has a test in the owning task):

1. A hostile page feeding the bridge: throwing getters, cyclic or endless `parent` chains,
   huge strings, wrong types, patched `querySelector` → the origin is dropped or capped,
   nothing throws, the popover still saves (Tasks 23, 24).
2. Pages that mutate all the time (timers, animations): re-anchoring, status reports and pin
   placement stay bounded and debounced; the "not found" status does not flap (Task 26).
3. Text that occurs several times in its container, or changed after a reload: the pin goes
   to the occurrence whose context matches best, else to the container, never to text of
   another container (Task 26).
4. Client-side navigation while a comment is open, and rapid `pushState` sequences: the item
   is saved under the page where it was marked; pins of the previous page go away (Task 25).
5. Site access revoked in `chrome://extensions` or forgotten while pages are open: settings
   and the registered script follow; a forgotten origin gets no overlay on its next load; the
   panel's buttons match (Task 28).

**Pre-flight (shared interfaces):** Task 23 `parseVueOrigins`, `astroOrigin`,
`withInspectorLine` and `vueOrigins` (bridge) feed Task 24; Task 24's `origin:read` message
and the draft's `origins` promise are what Task 30 checks end to end; Task 25's `page` ref is
read by Task 26 (re-anchoring per page) and Task 29 (Go to); Task 26's `findText` and
`useTracking` split are consumed by Task 27's pin positions; Task 28's `Settings` and
`isRemembered` are read by Task 29 (Go to skips injecting on remembered sites).

### Task 23: Code origin from the page

**Files:**

- Create: `src/lib/capture/origin.ts`, `src/lib/capture/origin-bridge.ts`
- Test: `tests/unit/capture-origin.test.ts`, `tests/unit/origin-bridge.test.ts`

**Interfaces:**

- Produces (`origin-bridge.ts`): `vueOrigins(selectors: string[]): RawVueOrigin[]` — a
  self-contained function (no imports, no closures; it is serialized into the page) that
  returns, per selector, `null` or `{ chain: { name?: unknown; file?: unknown }[] }`
  (outermost → innermost, at most 32 components, strings cut to 1000 code units, every read
  in `try`). It finds the element with `Document.prototype.querySelector`, walks up at most
  64 elements to the first with `__vueParentComponent`, then follows `.parent`.
- Produces (`origin.ts`): `parseVueOrigin(raw: unknown): CodeOrigin | undefined` (entries
  with a string `file`; `name` from the raw entry when it is a string; innermost five;
  `clean`ed; anything malformed → `undefined`), `astroOrigin(el: Element): CodeOrigin |
undefined` (nearest `data-astro-source-file`, line from `data-astro-source-loc`
  `line:col`), `inspectorOf(el: Element): { file: string; line: number } | undefined`
  (nearest `data-v-inspector="file:line:col"`), `withInspectorLine(origin, inspector):
CodeOrigin` (adds the line to the innermost entry when its file ends with the
  inspector's path), `combineOrigin(vue, astro): CodeOrigin | undefined` (Vue first).

- [ ] **Step 1: Write the failing unit tests**:
  - `capture-origin.test.ts`: a raw chain of seven components gives the innermost five in
    outer → inner order; `__name` beats `name` (the bridge passes the one it found);
    components without a file are left out; a chain with no file is `undefined`; wrong types
    (number file, object name, missing chain, extra keys, a string instead of an array) give
    `undefined`; a 2000-character path is left out, a 200-character name is dropped and the
    entry kept; control and bidi characters are removed; Astro: `data-astro-source-file` on
    an ancestor with `data-astro-source-loc="12:5"` → `{ framework: 'astro', chain: [{ file,
line: 12 }] }`, a malformed loc keeps the file without a line; inspector:
    `src/components/Card.vue:7:5` on an ancestor adds line 7 to an innermost
    `/srv/app/src/components/Card.vue`, not to an innermost `Other.vue`; `combineOrigin`
    prefers Vue; every result passes `isElementSnapshot`'s origin check.
  - `origin-bridge.test.ts` (happy-dom, fake component objects on elements): the chain of
    an element rendered by `Card` inside `App`; an element without its own instance takes its
    parent's; a selector that throws or matches nothing gives `null`; a cyclic `parent`
    chain stops at 32; a getter that throws gives `null` for that selector only; a
    1 MB `__file` is cut to 1000; `vueOrigins.toString()` contains no reference to an import
    (no `__vite`, `import`, or bundler helper names), so it can be serialized.
- [ ] **Step 2: Run them to see them fail** —
      `pnpm vitest run tests/unit/capture-origin.test.ts tests/unit/origin-bridge.test.ts`,
      Expected: FAIL, modules missing.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** the two files, then `pnpm test:unit` — Expected: PASS.
- [ ] **Step 5: Commit** — `Read Vue and Astro code origins from the page`

### Task 24: Origins in every snapshot, from a real dev server

**Files:**

- Modify: `src/lib/messages.ts` (`origin:read`), `src/entrypoints/background.ts`,
  `src/entrypoints/overlay.content/Overlay.vue`, `tests/e2e/harness.ts`
  (`startVueDevServer`), `tests/unit/messages.test.ts`, `tests/unit/background.test.ts`
- Create: `src/lib/background/origins.ts`, `src/entrypoints/overlay.content/origins.ts`,
  `tests/fixtures/sites/vue-app/` (`index.html`, `src/main.ts`, `src/App.vue`,
  `src/router.ts`, `src/pages/HomePage.vue`, `src/pages/SettingsPage.vue`,
  `src/pages/AboutPage.vue`, `src/components/FeatureGrid.vue`,
  `src/components/FeatureCard.vue`, `src/components/ProfileForm.vue`,
  `src/components/NotificationPrefs.vue`), `tests/fixtures/sites/astro-attrs/index.html`,
  `tests/fixtures/sites/fake-vue/` (`index.html`, `fake-vue.js`), `tests/e2e/origin.e2e.test.ts`

**Interfaces:**

- Consumes: Task 23.
- Produces: `BackgroundMessage` `{ type: 'origin:read'; selectors: string[] }` (1–11
  selectors, each a valid selector string ≤ `LIMITS.selector`); reply
  `{ ok: true; origins: (CodeOrigin | null)[] } | { ok: false; error: string }`;
  `readOrigins(tabId, documentId, selectors)` in `src/lib/background/origins.ts`
  (`executeScript` with `world: 'MAIN'`, `target: { tabId, frameIds: [0], documentIds }`, a
  1500 ms timeout, every result through `parseVueOrigin`); overlay helpers
  `requestOrigins(snapshots: Element[] …)` and `attachOrigins(target, origins)`;
  `startVueDevServer(): Promise<{ origin; root; write(path, text); close() }>` in the harness.

Behavior: the background answers `origin:read` only for a content script in the top frame
(`sender.frameId === 0`, `sender.tab.id`, `sender.documentId`), never for extension pages.
When a draft opens, the overlay asks for the origins of the snapshot's elements (element;
text container; area container and elements), reads Astro attributes and inspector lines
itself, and keeps the result as a promise on the draft; `save` waits for it (at most until
1.5 s after marking) and adds `origin` to each snapshot. In element mode, an element the
pointer rests on for 150 ms gets its innermost component name in the hover label
(`button · ProfileForm · 160×48`), cached per element for the session; at most one request
runs at a time.

- [ ] **Step 1: Write the failing unit tests**: messages (`origin:read` valid with 1 and 11
      selectors, invalid with 0, 12, a non-string, an over-long selector, extra keys);
      background (`origin:read` from a content script runs `executeScript` with
      `world: 'MAIN'`, `frameIds: [0]` and the sender's `documentId`, and replies with parsed
      origins; from an extension page or a sub-frame → `{ ok: false }`; a rejecting or slow
      `executeScript` → `{ ok: true, origins: [null…] }` after the timeout, fake timers;
      malformed results → `null`).
- [ ] **Step 2: Run them to see them fail** —
      `pnpm vitest run tests/unit/messages.test.ts tests/unit/background.test.ts`, Expected:
      FAIL.
- [ ] **Step 3: Write the failing E2E** `origin.e2e.test.ts`:
  - Vue dev server (fixture copied to a temporary directory, `vue` aliased): element mode on
    the settings page's submit button → hover label shows `ProfileForm`; save → the stored
    element origin is `vue` with `App`, `SettingsPage`, `ProfileForm` and their real `__file`
    paths under the temporary root, outer → inner; the `data-v-inspector` line of the
    fixture's button is on the innermost entry; select the `NotificationPrefs` heading text →
    the container has its component; drag around the feature cards → container
    `FeatureGrid`, elements `FeatureCard`; the copied prompt has `- Component: App (…) ›
SettingsPage (…) › ProfileForm (…:7)`.
  - Astro attributes page: an element and an area get `astro` origins with file and line.
  - Fake Vue page (Review Focus 1): elements with hostile `__vueParentComponent` (throwing
    getter, self-referencing `parent`, a 1 MB file name, a number as name, a patched
    `Document.prototype.querySelector`) → every item saves within 2 s, origins are absent
    or capped, the prompt stays well-formed.
  - A page with a strict CSP (hostile fixture) still gets the bridge (no origin, no error).
- [ ] **Step 4: Implement** the message, the background handler, the overlay requests, the
      hover label and the fixtures.
- [ ] **Step 5: Run** `pnpm test:unit && pnpm build && pnpm test:e2e` — Expected: PASS.
- [ ] **Step 6: Commit** — `Add code origins to snapshots through a main-world bridge`

### Task 25: Pages change without a reload

**Files:**

- Create: `src/entrypoints/overlay.content/use-page.ts`, `tests/fixtures/sites/spa/`
  (`index.html`, `spa.js`), `tests/e2e/navigation.e2e.test.ts`
- Modify: `src/entrypoints/overlay.content/Overlay.vue`,
  `src/entrypoints/sidepanel/App.vue` (current group follows the status)
- Test: `tests/unit/overlay-page.test.ts`

**Interfaces:**

- Produces: `usePage(): { key: Ref<string> }` — `pageKey(location.href)`, updated on the
  Navigation API's `currententrychange` (fallback `popstate` and `hashchange` when
  `navigation` is missing), listeners removed on unmount; the draft gains `page: PageInfo`,
  taken when the target is marked.

Behavior: pins, the highlight, editing and the status reply use the current page key; a page
change hides the chip, tells the panel (`overlay:changed`) and re-anchors (Task 26). An open
draft stays open; its item is saved under the page where it was marked.

- [ ] **Step 1: Write the failing unit test** `overlay-page.test.ts`: the key follows
      `history.pushState`, drops the hash, stays for a hash-only change, follows `popstate`;
      without `navigation` the fallback events work; unmount removes the listeners.
- [ ] **Step 2: Run it to see it fail** — `pnpm vitest run tests/unit/overlay-page.test.ts`,
      Expected: FAIL.
- [ ] **Step 3: Write the failing E2E** `navigation.e2e.test.ts` on the `spa` fixture (links
      that `pushState` between `/spa/a`, `/spa/b` and `/spa/c` and render different content;
      the fixture server serves `index.html` for every `/spa/*` path): mark on A, click to B
      → A's pin is gone and the panel's current group is B; mark on B → copy → A's group
      before B's; back → A's pin is back; open the popover on B, click a link to C (Review
      Focus 4), type, `Enter` → the item belongs to B; five quick `pushState` calls → the
      pins match the last page.
- [ ] **Step 4: Implement** `usePage` and wire it in.
- [ ] **Step 5: Run** `pnpm test:unit && pnpm build && pnpm test:e2e` — Expected: PASS.
- [ ] **Step 6: Commit** — `Follow client-side navigation in the overlay and the panel`

### Task 26: Re-anchoring after reloads and HMR, "not found"

**Files:**

- Create: `src/lib/capture/find-text.ts`, `src/entrypoints/overlay.content/anchor-status.ts`,
  `src/lib/background/anchor-status.ts`, `tests/e2e/reanchor.e2e.test.ts`
- Modify: `src/entrypoints/overlay.content/use-tracking.ts` (`layout` and `frame`),
  `src/entrypoints/overlay.content/pins.ts`, `src/entrypoints/overlay.content/Overlay.vue`,
  `src/entrypoints/overlay.content/index.ts` (orphan check), `src/lib/messages.ts`
  (`anchors:report`), `src/entrypoints/background.ts`, `src/lib/format/markdown.ts`,
  `src/entrypoints/sidepanel/App.vue`, `src/entrypoints/sidepanel/ItemList.vue`
- Test: `tests/unit/find-text.test.ts`, `tests/unit/anchor-status.test.ts`,
  `tests/unit/format-markdown.test.ts` (+ golden), `tests/unit/messages.test.ts`,
  `tests/unit/background.test.ts`, `tests/unit/sidepanel-app.test.ts`

**Interfaces:**

- Produces: `findText(container: Element, target: TextTarget): Range | null` — reads the
  container's shown text (selectable, the reader's budget), finds every occurrence of the
  selected text (a cut selection by its part before `…`), scores each by how much of
  `before`/`after` matches next to it, returns the best as a range, `null` when none;
  `useTracking(): { frame: Ref<number>; layout: Ref<number> }` (`layout` changes on DOM
  mutations and resizes only, `frame` also on scrolling); `createAnchorStatus(report, now)`
  — `update(pageKey, found: string[], missing: string[])`, reports an item as missing only
  after 1.5 s without a placement, as found at once, at most every 250 ms;
  `BackgroundMessage` `{ type: 'anchors:report'; pageKey: string; found: string[];
missing: string[] }`; `loadMissing(): Promise<Set<string>>` and `watchMissing(cb)`
  (`storage.session`, key `missing`); `formatCollection(c, options?: { missing?:
ReadonlySet<string> })`.

Behavior: placements are recomputed when `layout` changes, rects on every `frame`. Text items
without a live range are searched with `findText` in their container after mount, after a
page change and 300 ms after DOM changes settle; a range found goes into the live map. The
overlay reports found and missing ids of the current page; the background keeps the set of
missing ids of items that exist (removed on found, cleared by **Clear all**). The panel marks
missing entries "Not found" (title "Not found when this page was last open") and the copied
prompt adds `(not found when the page was last open; data from when it was marked)` under their
heading. The overlay checks every second whether the extension is still there and removes
itself when it is not.

- [ ] **Step 1: Write the failing unit tests**:
  - `find-text.test.ts`: exact match; the second of two occurrences when the context fits it;
    a cut selection found by its first part; whitespace and line breaks differ from the
    capture; text split over inline elements; not found → `null`; text in a form field
    never matches; a huge container stays within the budget.
  - `anchor-status.test.ts` (fake timers): missing reported after 1.5 s only; found at once;
    a flap inside 1.5 s reports nothing; reports batched; a page change resets the timers.
  - formatter: an item in `missing` gets the line under its heading (golden file); others do
    not.
  - messages: `anchors:report` shapes (ids valid, at most 1000, a page URL).
  - background: a report writes `missing` in `storage.session` for ids of items on that page
    only; found ids are removed; **Clear all** clears it.
  - panel: a missing item shows "Not found"; copy uses the set.
- [ ] **Step 2: Run them to see them fail**, Expected: FAIL.
- [ ] **Step 3: Write the failing E2E** `reanchor.e2e.test.ts`:
  - plain fixture: mark an element, a text and an area → reload → toolbar click → three pins
    at their targets; the text pin sits at the selection, not at the start of its container.
  - the page replaces the marked paragraph with one that has the same text twice and the
    original context around the second → the pin moves to the second (Review Focus 3).
  - the page removes the marked element → after 1.5 s the panel shows "Not found", the copy
    has the line; the page adds it back → the mark goes away.
  - a page that changes the DOM every 16 ms (Review Focus 2): no "Not found" flapping, the
    long-animation-frame count stays low.
  - Vue dev server: mark the profile button, change its component file (HMR) → the pin is
    back at the re-rendered button within a second.
  - the extension is reloaded (`chrome.runtime.reload()`) → the old overlay host is gone
    within 2 s.
- [ ] **Step 4: Implement** `findText`, the tracking split, scheduling, status reports, the
      background store, the panel mark, the formatter line and the orphan check.
- [ ] **Step 5: Run** `pnpm test:unit && pnpm build && pnpm test:e2e` — Expected: PASS.
- [ ] **Step 6: Commit** — `Re-anchor items after reloads and HMR and mark the missing ones`

### Task 27: Pins in scroll containers, sticky headers, and hiding pins

**Files:**

- Modify: `src/entrypoints/overlay.content/pins.ts`, `src/entrypoints/overlay.content/Overlay.vue`,
  `src/lib/messages.ts` (`overlay:set-pins`, status `pins`), `src/entrypoints/sidepanel/App.vue`,
  `tests/fixtures/sites/plain/index.html`, `tests/fixtures/sites/plain/plain.css`
- Create: `tests/e2e/pins-layout.e2e.test.ts`
- Test: `tests/unit/overlay-pins.test.ts`, `tests/unit/messages.test.ts`,
  `tests/unit/sidepanel-app.test.ts`

**Interfaces:**

- Produces: `clipOf(el: Element): Rect | null` (the visible part of the viewport after every
  ancestor that clips its overflow, up to a fixed-position ancestor; `null` when nothing is
  visible), `pinPosition(rect, bounds)` taking the clip instead of the viewport;
  `OverlayMessage` `{ type: 'overlay:set-pins'; visible: boolean }`; `OverlayStatus.pins:
boolean`.

Behavior: a pin is shown only while part of its target is visible inside its clipping
ancestors, and stays inside that visible part; a target with an empty box (not rendered)
gets no pin and no highlight (resolves the deferred minor "hidden target gets a pin in the
top-left corner"). The panel gets a **Pins** toggle (eye icon) next to the mode switch;
hidden pins stay hidden until shown again or the overlay restarts.

- [ ] **Step 1: Write the failing unit tests**: pins (a target scrolled out of its container
      gets no pin; a target half inside gets its pin inside the container's box; a fixed
      target ignores its scrolled ancestors; an empty rect gets no pin); messages
      (`overlay:set-pins`); panel (the toggle sends `overlay:set-pins` and shows the state).
- [ ] **Step 2: Run them to see them fail**, Expected: FAIL.
- [ ] **Step 3: Write the failing E2E** `pins-layout.e2e.test.ts` (Review Focus 5 of the
      plan): an element inside `.scroll-box` → its pin moves with the box's scrolling and
      disappears when the element leaves the box; a `position: sticky` header marked → its
      pin stays at the header while the page scrolls 800 px; the panel's Pins toggle hides
      and shows all pins.
- [ ] **Step 4: Implement** clipping, the toggle and the status field.
- [ ] **Step 5: Run** `pnpm test:unit && pnpm build && pnpm test:e2e` — Expected: PASS.
- [ ] **Step 6: Commit** — `Keep pins inside scroll containers and let the panel hide them`

### Task 28: Remembered sites

**Files:**

- Create: `src/lib/settings.ts` (model, validation, store), `src/lib/background/sites.ts`,
  `src/entrypoints/sidepanel/SettingsView.vue`, `src/entrypoints/sidepanel/use-settings.ts`,
  `tests/unit/helpers/fake-sites.ts`, `tests/e2e/remembered.e2e.test.ts`
- Modify: `src/lib/messages.ts` (`site:remember`, `site:forget`),
  `src/entrypoints/background.ts`, `src/entrypoints/sidepanel/App.vue`, `tests/e2e/harness.ts`
  (`launch({ hostPermissions })`)
- Test: `tests/unit/settings.test.ts`, `tests/unit/background-sites.test.ts`,
  `tests/unit/messages.test.ts`, `tests/unit/sidepanel-app.test.ts`

**Interfaces:**

- Produces: `Settings { rememberedOrigins: string[] }`, `SETTINGS_KEY = 'settings'`,
  `isSettings`, `loadSettings`, `watchSettings`; `originPattern(origin): string`
  (`http://localhost:3000` → `http://localhost:3000/*`); `isSiteOrigin(x): x is string`
  (`http:`/`https:` origins only, normalized, no path); `createSites()` →
  `{ remember(origin), forget(origin), reconcile(), isRemembered(origin) }` run one at a time;
  messages `{ type: 'site:remember'; origin }` and `{ type: 'site:forget'; origin }`, only
  from extension pages.

Behavior: **Always enable here** (panel header, shown for an active `http`/`https` tab whose
origin is not remembered) calls `permissions.request` for the origin's pattern inside the
click, then sends `site:remember`; the background checks `permissions.contains`, adds the
origin (sorted, unique) and registers the overlay script (`id: 'overlay'`, the remembered
patterns, `document_idle`, persisted) or updates its matches. **Forget this site** (header)
and the remove buttons of **Settings → Sites** send `site:forget`: the background removes the
origin, updates or unregisters the script, then asks Chrome to remove the permission (a
failure is ignored). `permissions.onRemoved`, `runtime.onInstalled` and `runtime.onStartup`
run `reconcile`: origins Chrome no longer grants are dropped and the registration is
rewritten; after an update, tabs of remembered origins get a fresh overlay.

- [ ] **Step 1: Write the failing unit tests** (`fake-sites.ts`: in-memory granted origins,
      registered scripts, `permissions.onRemoved` with a trigger):
  - settings: validation (origins only, http/https, unique, at most 100), defaults.
  - sites: remember registers with the pattern; a second origin updates the matches;
    remember without the grant → error, nothing stored; forget unregisters the last one and
    calls `permissions.remove`, a rejected remove still forgets; `onRemoved` for one origin
    drops only that one (Review Focus 5); reconcile after start re-registers; concurrent
    remember/forget run in order.
  - messages: `site:*` valid only with a site origin; the background refuses them from a tab.
  - panel: the header button follows the active tab's origin and the settings; Always enable
    here calls `permissions.request` before anything is awaited; the settings view lists
    and removes sites.
- [ ] **Step 2: Run them to see them fail**, Expected: FAIL.
- [ ] **Step 3: Write the failing E2E** `remembered.e2e.test.ts` with a test copy of the build
      whose manifest grants `http://localhost/*` (the prompt cannot be automated; the shipped
      build is unchanged and `manifest:check` still runs on it): toolbar click → **Always
      enable here** → reload → the overlay is there without a click and shows the pins;
      **Forget this site** → reload → no overlay; Settings lists the remembered origin and
      its remove button forgets it; a second origin (`127.0.0.1`) stays unaffected.
- [ ] **Step 4: Implement** settings, the background module, the messages, the panel buttons
      and the settings view (shadcn-vue components only).
- [ ] **Step 5: Run** `pnpm test:unit && pnpm build && pnpm manifest:check && pnpm test:e2e` —
      Expected: PASS.
- [ ] **Step 6: Commit** — `Remember sites so the overlay loads by itself`

### Task 29: Go to, and the panel's link to the page

**Files:**

- Modify: `src/lib/messages.ts` (`tab:go`), `src/entrypoints/background.ts`,
  `src/entrypoints/sidepanel/ItemList.vue`, `src/entrypoints/sidepanel/App.vue`,
  `src/entrypoints/overlay.content/Overlay.vue` (panel port)
- Create: `src/lib/background/go-to.ts`, `tests/e2e/go-to.e2e.test.ts`
- Test: `tests/unit/background-go-to.test.ts`, `tests/unit/messages.test.ts`,
  `tests/unit/sidepanel-app.test.ts`

**Interfaces:**

- Produces: `{ type: 'tab:go'; tabId: number; pageKey: string }` (from extension pages only;
  the page key must be a page of the collection with an `http:`/`https:` URL); `goTo(tabId,
url)` updates the tab, waits for it to finish loading (at most 30 s) and injects the
  overlay unless the origin is remembered; a failed injection marks nothing.

Behavior: page groups other than the current one get **Go to** in their header. The panel
holds a port to the overlay of the active tab (`tabs.connect`, name `panel`); when it closes,
the overlay drops the panel's highlight (resolves the deferred minor "highlight stays after
the panel closes").

- [ ] **Step 1: Write the failing unit tests**: messages (`tab:go` shapes); background
      (`tab:go` for a page of the collection → `tabs.update` then `executeScript` after
      `complete`; an unknown page key or a `file:` page → refused; from a tab → refused;
      a remembered origin → no injection); panel (Go to on other groups only; it sends
      `tab:go` with the active tab id).
- [ ] **Step 2: Run them to see them fail**, Expected: FAIL.
- [ ] **Step 3: Write the failing E2E** `go-to.e2e.test.ts`: items on `/plain/` and
      `/plain/text.html`; on `text.html`, **Go to** the plain page → the tab shows it, the
      overlay is active, its pins are there; hovering an entry highlights, closing the panel
      removes the highlight.
- [ ] **Step 4: Implement** Go to and the port.
- [ ] **Step 5: Run** `pnpm test:unit && pnpm build && pnpm test:e2e` — Expected: PASS.
- [ ] **Step 6: Commit** — `Go to the pages of a collection from the panel`

### Task 30: A three-page session on the Vue app, docs

**Files:**

- Create: `tests/e2e/acceptance-vue.e2e.test.ts`
- Modify: `docs/specs/2026-10-05-annotation-extension.md` (sections 5, 8, 10, 11, 12, 13),
  `AGENTS.md` (status), this plan (milestone 5 note, if anything moved)

- [ ] **Step 1: Write the E2E test** (acceptance): on the Vue dev server, Home → mark the
      feature grid as an area; Settings (client-side) → mark the submit button; About → select
      a sentence; reload About → the pin is back at the selection; copy → the clipboard equals
      `formatCollection(stored)`, groups Home, Settings, About in that order, each item with
      its `Component:` line and real file paths.
- [ ] **Step 2: Run it** — `pnpm build && pnpm test:e2e`. Expected: PASS if Tasks 23–29
      hold; a failure is a bug in those tasks, fixed test-first.
- [ ] **Step 3: Run all checks** — `pnpm check && pnpm build && pnpm manifest:check && pnpm test:e2e`,
      Expected: PASS.
- [ ] **Step 4: Docs.** Spec: section 5 (storage: `missing` in `storage.session`, settings),
      section 8 (Go to, Pins toggle, header buttons, no "Reload the page" status), section 10
      (orphaned overlays, revoked access, client-side navigation, re-anchoring limits),
      section 11 (bridge by selector, origin data is page data), section 13 (results of this
      milestone's facts). AGENTS.md: status milestone 4.
- [ ] **Step 5: Commit** — `Cover a three-page session on a Vue app`

**Acceptance:** a three-page session on the Vue fixture copies one correct prompt; E2E green
in CI; manual smoke in a real Chrome.

---

## Milestone 5: Voice input

**Goal:** Dictate comments via OpenRouter with bring-your-own key.

**Expanded on 2026-10-06** from the milestone 4 code and spike 4. Tasks 31–38 name files,
interfaces and the tests to write first; the implementation follows in the same pull request.
Steps are test-first: write the listed tests, watch them fail, implement, watch them pass,
commit.

**Facts this milestone relies on** (spike 4, verified on 2026-10-06 with Chrome for Testing
154 and the live API):

- `POST https://openrouter.ai/api/v1/audio/transcriptions` takes the spec's JSON body with
  `input_audio.format: "webm"` and `provider.data_collection: "deny"`; it answers
  `{ text, usage }` within about a second for a 7 s clip (about $0.0002 with
  `openai/gpt-4o-mini-transcribe`). Silence gives `text: ""`; a wrong key 401
  (`"Missing Authentication header"`); an unknown model 400 (`"Model … does not exist"`);
  audio it cannot decode 400 (`"Provider returned 400"`). `GET /api/v1/key` answers 200 or
  401 and costs nothing. Both answer CORS preflights from any origin with
  `Access-Control-Allow-Origin: *` and allow the `Authorization` header.
- In an offscreen document (`USER_MEDIA`), `getUserMedia` fails with `NotAllowedError` until
  the extension's origin has the microphone permission (`permissions.query` says `prompt`;
  the document cannot show Chrome's prompt) and with `NotFoundError` when there is no device.
  Once the origin is granted, `MediaRecorder` records `audio/webm;codecs=opus` (EBML header
  `1A 45 DF A3`) there.
- Chrome's DevTools protocol sets the permission for the extension's origin:
  `Browser.setPermission({ permission: { name: "microphone" }, setting, origin })` with
  `granted`, `prompt` or `denied`; extension pages see the change through
  `permissions.query(…).onchange`. `--use-fake-device-for-media-stream` gives a beeping fake
  microphone, `--use-file-for-fake-audio-capture=<wav>` plays a file instead.
- `sidePanel.open()` called by the background while it handles a message that a content
  script sent from a trusted click succeeds; without a user gesture it fails.
- All four models of the spec's list exist and transcribe the synthetic English and German
  clips (`tests/fixtures/audio/`) almost word for word; they differ only in hyphens and
  commas (table in spec section 13).
- WXT's fake browser does not implement `runtime.connect`, `tabs.connect`, `offscreen.*` or
  `runtime.getContexts`; unit tests use in-memory fakes.

**Decisions:**

- **The offscreen document records and transcribes.** A service worker is stopped when a
  `fetch` takes longer than 30 s, and the request may take up to 65 s; the document has no
  such limit and keeps the audio for **Retry**. The background reads the key and the voice
  settings and sends them with `start` and `retry` over the recorder's own port, so no other
  context receives them. The document lives for one session: created on `start`, closed when
  the session ends.
- **One port per comment.** The popover opens a port named `voice` to the background on the
  first dictation and closes it when it closes; a closed port (popover closed, page gone,
  overlay replaced) cancels the recording or the request and closes the offscreen document.
  States flow back over the same port, so a recording stopped at the 120 s limit still
  reaches the popover. While a session runs, the recorder sends a heartbeat every 10 s, which
  keeps the service worker alive (Chrome 114+ counts port messages).
- **One session at a time.** A `start` from another popover ends the running session; that
  popover shows "Recording stopped: another one started."
- **Storage:** voice settings under their own key `voice` (`{ model, language }`) in
  `storage.local`, so a malformed value never resets the remembered sites. The API key lives in
  the extension origin's IndexedDB (changed after the final review: `storage.local` and its
  change events reach content scripts). Both are written only by the background. The ESLint
  rule forbids the overlay entrypoint to reference `openrouterKey` or import
  `@/lib/voice/key`.
- **Panel requests** (`voice:set`, `voice:key:save`, `voice:key:remove`, `voice:key:test`)
  are accepted only from the side panel's own URL. **Overlay requests** (`voice:grant`,
  `voice:settings`) only from the top frame of a tab; `voice:settings` opens the panel on its
  settings (a `panelView` entry in `storage.session` that the panel of that window reads).
- **Errors** map to the spec's messages; timeouts say "Transcription timed out", no network
  "Could not reach OpenRouter", and a 400 adds OpenRouter's own message (text only, one line,
  at most 200 characters, never the key). Every failure after recording keeps the audio for
  **Retry**, which reads the key and settings again.
- **Fixture audio** comes from OpenRouter's text-to-speech (`scripts/voice-fixtures.mjs`,
  local, with the test key): synthetic voices only, committed as 16-bit mono WAV.

**Known limits:** the text arrives after the recording stops (no live transcript); the
microphone permission is granted once in a tab of the extension (Chrome's prompt cannot show
in the panel or the offscreen document); a page can see that the popover's comment field
changed, as it can with typing.

**Review focus for this milestone** (each line has a test in the owning task):

1. The popover closes, the page navigates or the overlay is replaced while recording or
   transcribing: nothing is sent, the microphone is released, no text lands anywhere
   (Tasks 34, 35, 37).
2. A page dispatching clicks or `Alt+V` at the overlay, or messages at the background: no
   recording starts; overlay and panel messages from the wrong sender are refused
   (Tasks 31, 34, 35).
3. The API key never reaches the overlay, an error, a log line or the prompt; requests go
   only to `openrouter.ai` (Tasks 31, 32, 37).
4. Failures (401, 402, 429, 5xx, timeout, offline, empty text, unknown model): the right
   message, **Retry** without speaking again, and a retry after fixing the key works
   (Tasks 32, 33, 37).
5. The transcript lands at the caret with one separating space, replaces a selection,
   respects the comment limit and the comment guard, and keeps what the developer typed
   during the recording (Tasks 35, 37).

**Pre-flight (shared interfaces):** Task 31's `loadKey`, `loadVoiceSettings` and
`isPanelSender` feed Task 34 (the coordinator reads both) and Task 36 (the panel); Task 32's
`transcribe` and `VoiceFailure` are what Task 33's recorder calls; Task 33's `VoiceState`,
`VoiceCommand` and `RecorderCommand` (`src/lib/voice/protocol.ts`) are the contract of Tasks
34 and 35; Task 34's `voice:grant` and `voice:settings` are sent by Task 35 and answered by
Task 36's `panelView`; Task 37 drives everything through the shipped build.

### Task 31: Voice settings and the API key

**Files:**

- Create: `src/lib/voice/settings.ts`, `src/lib/voice/key.ts`,
  `src/lib/background/voice-settings.ts`
- Modify: `src/lib/messages.ts`, `src/entrypoints/background.ts`, `src/lib/settings.ts`
  (comment), `eslint.config.mjs`
- Test: `tests/unit/voice-settings.test.ts`, `tests/unit/background-voice-settings.test.ts`,
  `tests/unit/eslint-overlay-key.test.ts`, `tests/unit/messages.test.ts`

**Interfaces:**

- Produces (`settings.ts`): `VOICE_KEY = 'voice'`, `interface VoiceSettings { model: string;
language: string }`, `DEFAULT_MODEL = 'openai/gpt-4o-mini-transcribe'`, `MODELS: { id;
label }[]` (the spec's four), `LANGUAGES: { code; label }[]` (`auto` first),
  `isModelId(x)` (`vendor/name`, at most 100 characters, letters, digits, `._-:`),
  `isLanguage(x)` (`auto` or two lowercase letters), `isVoiceSettings(x)`,
  `loadVoiceSettings(): Promise<VoiceSettings>` (defaults for anything malformed),
  `watchVoiceSettings(cb): () => void`.
- Produces (`key.ts`): `KEY_STORAGE = 'openrouterKey'`, `isApiKey(x)` (8–256 visible ASCII
  characters, no spaces), `loadKey(): Promise<string | undefined>`, `maskKey(key): string`
  (`sk-or-v1-…` or `…`, then the last four characters).
- Produces (`voice-settings.ts`): `isPanelSender(sender): boolean` (no tab, our id, URL
  is the panel's), `saveVoice(settings)`, `saveKey(key)`, `removeKey()`,
  `testKey(check = checkKey): Promise<KeyTestReply>`.
- Produces (`messages.ts`): `VoiceSettingsMessage = { type: 'voice:set'; model; language } |
{ type: 'voice:key:save'; key } | { type: 'voice:key:remove' } | { type: 'voice:key:test' }`,
  `KeyTestReply = { ok: true; valid: boolean } | { ok: false; error: string }`, guards in
  `isBackgroundMessage`.

- [ ] **Step 1: Write the failing tests:**
  - settings: defaults when nothing is stored; a stored valid value loads; a malformed model,
    language or extra key falls back to the defaults without touching `settings`; the watcher
    reports changes of `voice` only.
  - key: `isApiKey` accepts a key-shaped string and refuses spaces, control characters, too
    short or too long; `maskKey` never returns more than the prefix and four characters;
    `loadKey` returns `undefined` for a malformed stored value.
  - background: each message from the panel writes; the same messages from a tab, from
    another extension page URL or with a malformed key or model are refused and write
    nothing; `voice:key:test` without a key says so; with a key it answers valid/invalid from
    the injected check and "Could not reach OpenRouter" when the check throws; no reply or
    error contains the key.
  - ESLint: a file under `src/entrypoints/overlay.content/` that reads `openrouterKey`,
    imports `@/lib/voice/key` or calls `browser.storage.local.get()` without keys fails
    lint; the same code elsewhere passes.
- [ ] **Step 2: Run them, watch them fail;** **Step 3: implement;** **Step 4: run
      `pnpm test:unit` and `pnpm lint`;** **Step 5: commit** "Store the voice settings and the
      API key".

### Task 32: OpenRouter client

**Files:**

- Create: `src/lib/voice/openrouter.ts`
- Test: `tests/unit/voice-openrouter.test.ts`

**Interfaces:**

- Produces: `OPENROUTER = 'https://openrouter.ai'` (the one place the origin is written; the
  E2E harness rewrites it in a copy of the build), `interface TranscribeRequest { key: string;
model: string; language: string }`, `transcribe(audio: Blob, request, options?: { signal?:
AbortSignal; fetch?: typeof fetch }): Promise<string>` (trimmed text), `checkKey(key,
options?): Promise<boolean>`, `class VoiceFailure extends Error { code: VoiceError; detail?:
string }` (its message is the code only), `TIMEOUT = 65_000`.
- `VoiceError` (in `src/lib/voice/protocol.ts`, created here): `'no-key' | 'mic-not-granted' |
'mic-blocked' | 'no-mic' | 'mic-failed' | 'invalid-key' | 'no-credits' | 'rate-limited' |
'rejected' | 'failed' | 'timeout' | 'offline' | 'no-speech' | 'interrupted' | 'taken'`, with
  `voiceErrorText(error, detail?)`.

- [ ] **Step 1: Write the failing tests** (mocked `fetch`): request URL, method, headers
      (`Authorization: Bearer <key>`, JSON content type) and body (`model`, `input_audio.data`
      is the blob's base64, `format: "webm"`, `provider.data_collection: "deny"`, `language`
      only when not `auto`); 401 → `invalid-key`, 402 → `no-credits`, 429 → `rate-limited`,
      400/404/422 → `rejected` with OpenRouter's message cut to one line of 200 characters,
      5xx and malformed JSON → `failed`, a rejected `fetch` → `offline`, no answer within 65 s
      (fake timers) → `timeout`, an aborted signal → `AbortError` passes through; `"  "` →
      `no-speech`; text is trimmed; neither `message`, `detail` nor `String(error)` of any
      failure contains the key, even when OpenRouter's message quotes it; `checkKey` → true on
      200, false on 401/403, `offline`/`failed` otherwise; a 2 MB blob encodes without a
      stack overflow.
- [ ] **Steps 2–5** as in Task 31; commit "Talk to OpenRouter's transcription API".

### Task 33: Recorder

**Files:**

- Create: `src/lib/voice/recorder.ts`, `src/entrypoints/offscreen/index.html`,
  `src/entrypoints/offscreen/main.ts`
- Modify: `src/lib/voice/protocol.ts`
- Test: `tests/unit/voice-recorder.test.ts`, `tests/unit/voice-protocol.test.ts`

**Interfaces:**

- Produces (`protocol.ts`): `VoiceState = { state: 'idle' } | { state: 'starting' } |
{ state: 'recording'; limit: number } | { state: 'transcribing' } | { state: 'done'; text:
string; atLimit: boolean } | { state: 'failed'; error: VoiceError; detail?: string; retry:
boolean }`, `VoiceCommand = { type: 'start' | 'stop' | 'cancel' | 'retry' }` (overlay →
  background), `RecorderCommand = { type: 'start'; request: TranscribeRequest } | { type:
'stop' } | { type: 'cancel' } | { type: 'retry'; request: TranscribeRequest }`
  (background → recorder), `RecorderMessage = VoiceState | { state: 'alive' }`, guards
  `isVoiceState`, `isVoiceCommand`, `isRecorderCommand`, `isRecorderMessage`, port names
  `VOICE_PORT = 'voice'`, `RECORDER_PORT = 'recorder'`, `LIMIT = 120_000`.
- Produces (`recorder.ts`): `createRecorder(deps: { permission(): Promise<PermissionState>;
getUserMedia(): Promise<MediaStream>; record(stream): MediaRecorderLike; transcribe(audio:
Blob, request, signal): Promise<string>; emit(state: RecorderMessage): void }): {
command(c: RecorderCommand): void; stop(): void }` — `stop()` ends everything (port gone).
- The offscreen page connects `RECORDER_PORT`, feeds it into the recorder, sends a heartbeat
  every 10 s while busy, and stops the recorder when the port closes.

- [ ] **Step 1: Write the failing tests** (fake stream, fake `MediaRecorder`, fake timers):
      `start` → `starting`, then `recording` with the limit; permission `prompt` →
      `mic-not-granted`, `denied` → `mic-blocked`, `getUserMedia` `NotFoundError` → `no-mic`,
      other errors → `mic-failed`, none with `retry`; `stop` → `transcribing` → `done` with the
      text, the tracks stopped as soon as recording ends; 120 s → stops by itself, `done` with
      `atLimit`; `cancel` while recording → `idle`, no transcription, tracks stopped; `cancel`
      while transcribing aborts the signal and drops a late answer; a failure → `failed` with
      `retry: true` (except `no-speech`), and `retry` sends the same audio with the new
      request; a second `start` while busy is refused; `stop()` releases the microphone and
      drops the audio; the recorder asks for `audio/webm;codecs=opus` at 32 kbit/s.
- [ ] **Steps 2–5**; commit "Record and transcribe in an offscreen document".

### Task 34: Background coordinator and the microphone page

**Files:**

- Create: `src/lib/background/voice.ts`, `src/entrypoints/mic-permission/index.html`,
  `src/entrypoints/mic-permission/main.ts`, `src/entrypoints/mic-permission/App.vue`
- Modify: `src/entrypoints/background.ts`, `src/lib/messages.ts`
- Test: `tests/unit/background-voice.test.ts`, `tests/unit/mic-permission.test.ts`,
  `tests/unit/helpers/fake-port.ts`

**Interfaces:**

- Consumes: `loadKey`, `loadVoiceSettings`, `isPanelSender` (Task 31); protocol (Task 33).
- Produces: `createVoice(deps?: { offscreen?: OffscreenLike; contexts?: () =>
Promise<unknown[]> })` with `onConnect(port)`; messages `{ type: 'voice:grant' }` (opens
  `mic-permission.html` in a new tab next to the sender's) and `{ type: 'voice:settings' }`
  (opens the panel synchronously, then writes `panelView: { windowId, view: 'settings', at
}` to `storage.session`), both only from frame 0 of a tab.
- The microphone page asks for the microphone on load and on **Allow microphone**, stops
  the tracks at once, says "Microphone allowed. You can close this tab." (and closes its tab
  after 1.5 s), or explains a block ("Chrome blocked the microphone for this extension…")
  or a missing device.

- [ ] **Step 1: Write the failing tests:**
  - coordinator (fake ports and offscreen API): `start` without a key → `failed: no-key`,
    no document; with a key → closes a stale document, creates one (`USER_MEDIA`), waits for
    the recorder port (5 s, else `failed: mic-failed`) and sends `start` with key, model and
    language; recorder states reach the overlay port, heartbeats do not; `stop`, `cancel`
    pass through; `retry` reads key and settings again; the overlay port closing cancels and
    closes the document; a second overlay's `start` ends the first session with `failed:
taken`; the recorder port closing mid-session → `failed: interrupted`; a `voice` port
    from a subframe, another extension or the panel is disconnected at once; a recorder port
    from any URL but `offscreen.html` is refused; `done` closes the document.
  - `voice:grant` and `voice:settings` from a tab's top frame work, from the panel or a
    subframe are refused.
  - microphone page: allowed, blocked (`NotAllowedError`) and missing device
    (`NotFoundError`) texts; tracks stopped.
- [ ] **Steps 2–5**; commit "Coordinate dictation in the background".

### Task 35: Dictation in the comment popover

**Files:**

- Create: `src/entrypoints/overlay.content/use-voice.ts`,
  `src/entrypoints/overlay.content/transcript.ts`, `src/entrypoints/overlay.content/VoiceButton.vue`
- Modify: `CommentPopover.vue`, `comment-guard.ts`, `keys.ts`
- Test: `tests/unit/overlay-transcript.test.ts`, `tests/unit/overlay-use-voice.test.ts`,
  `tests/unit/comment-popover.test.ts`, `tests/unit/overlay-keys.test.ts`,
  `tests/unit/comment-guard.test.ts`

**Interfaces:**

- Produces (`transcript.ts`): `insertTranscript(value, start, end, text, max =
LIMITS.comment): { value: string; caret: number; cut: boolean }` — replaces the selection,
  adds a space before when the character before is not whitespace, one after when the
  character after is not whitespace or punctuation, cuts the text to fit `max`.
- Produces (`use-voice.ts`): `useVoice(connect = () => browser.runtime.connect({ name:
VOICE_PORT })): { state: Ref<VoiceState>; seconds: Ref<number>; busy: ComputedRef<boolean>;
toggle(); cancel(); retry(); onText(cb: (text: string, atLimit: boolean) => void) }` —
  connects on the first `toggle`, disconnects on scope dispose, treats a closed port as
  `failed: interrupted`.
- `CommentGuard.accept(value)`: the overlay's own edit becomes the verified text.
- `popoverKey` returns `'voice'` for a trusted `Alt+V` (`code === 'KeyV'`, no Ctrl, Meta or
  Shift; not while composing).
- Popover footer: hint or voice status on the left (`● 0:12`, "Transcribing…"), the mic
  button and **Save** on the right; above it the voice message with its action (**Retry**,
  **Grant**, **Open settings**). Save is disabled while recording or transcribing; `Esc`
  cancels a running recording or request first; the text field stays editable.

- [ ] **Step 1: Write the failing tests:**
  - `insertTranscript`: empty field; caret at the start, middle, end; after a space, before a
    space or punctuation; a selection replaced; the limit cuts and reports it.
  - `useVoice` (fake port): toggle connects and sends `start`, toggles to `stop` while
    recording; the seconds count up and stop; `done` calls `onText` once; a closed port →
    `interrupted`; unmount disconnects; `cancel` and `retry` send their commands.
  - popover: the mic button sits next to Save; untrusted clicks do nothing; states show their
    texts; `done` inserts at the caret, focuses the field and keeps the guard in step (a
    later save sends the inserted text); text typed while recording stays; `Esc` while
    recording sends `cancel` and keeps the popover; Save is disabled while busy; each error
    shows its message and action; `voice:grant` and `voice:settings` are sent only from
    trusted clicks.
  - keys: `Alt+V` → `'voice'`; with Ctrl, Meta, Shift, while composing or untrusted → null;
    macOS `Alt+V` (`key: '√'`, `code: 'KeyV'`) → `'voice'`.
- [ ] **Steps 2–5**; commit "Dictate into the comment popover".

### Task 36: Voice settings in the panel

**Files:**

- Create: `src/entrypoints/sidepanel/VoiceSettings.vue`,
  `src/entrypoints/sidepanel/use-voice-settings.ts`, shadcn-vue `input`, `label` and `select`
  (or `native-select`) in `src/components/ui/`
- Modify: `SettingsView.vue`, `App.vue`
- Test: `tests/unit/sidepanel-voice.test.ts`

**Interfaces:**

- Consumes: Task 31 messages, `maskKey`, `KEY_STORAGE`, `MODELS`, `LANGUAGES`;
  `panelView` (Task 34).
- Produces: settings section **Voice**: API key (password field + **Save** when none is
  saved; else the masked key with **Test** and **Remove**; test result line), model (the list
  plus **Custom model…** with a field), language (`Detect automatically` + list), microphone
  (Allowed / Not allowed yet + **Grant** / Blocked + how to allow it), a line on what is sent
  where. App: opens the settings when `panelView` names this window's panel (on load and on
  change, at most 10 s old) and removes the entry.

- [ ] **Step 1: Write the failing tests:** saving sends `voice:key:save` and clears the
      field; the stored key shows masked only (never the full key in the DOM); Test shows
      "Key works." / "Invalid API key." / the error; Remove sends `voice:key:remove`; model and
      language send `voice:set`; a custom model id is validated before sending; the microphone
      status follows `permissions.query` and its `change` event; **Grant** opens the page;
      `panelView` for this window opens the settings, for another window does not, an old one
      is ignored.
- [ ] **Steps 2–5**; commit "Set up voice in the panel".

### Task 37: Dictation end to end

**Files:**

- Create: `tests/e2e/voice.e2e.test.ts`, `tests/e2e/fake-openrouter.ts`
- Modify: `tests/e2e/harness.ts`

**Interfaces:**

- Harness: `launch({ openrouter?: string; microphone?: 'granted' | 'prompt' | 'denied' })`
  — with `openrouter`, a copy of the build in which every `https://openrouter.ai` of the
  JavaScript files points at the fake (the launch fails when there is none to replace, so a
  test can never reach the real API); `microphone` adds Chrome's fake device and sets the
  permission over CDP. `setMicrophone(s, setting)`.
- Fake OpenRouter: answers preflights, records every request (headers and JSON body),
  answers from a queue (`reply(status, body, delay?)`), `/api/v1/key` by key.

- [ ] **Step 1: Write the failing E2E tests:** record → stop → the fake's text lands at the
      caret and is saved (request body: default model, `webm` whose base64 starts with the
      EBML header, `data_collection: "deny"`, no `language`, the key only in
      `Authorization`); `Alt+V` starts and stops; `Esc` while recording sends nothing and
      the offscreen document is gone; closing the popover while transcribing inserts nothing;
      500 → "Transcription failed" → **Retry** sends the same audio once more and inserts;
      401 shows "Invalid API key"; `""` shows "No speech detected."; no key → **Open
      settings** opens the panel's settings; microphone `prompt` → **Grant** opens the
      microphone page; settings in the panel save, test, mask and remove the key and a chosen
      language reaches the request; the comment saved by dictation is in the copied prompt.
- [ ] **Steps 2–5**; commit "Test dictation end to end".

### Task 38: Live test, fixtures and docs

**Files:**

- Create: `tests/live/voice.live.test.ts`, `vitest.live.config.ts`,
  `scripts/voice-fixtures.mjs`, `scripts/voice-fixtures.test.mjs`,
  `tests/fixtures/audio/clips.json`, `tests/fixtures/audio/*.wav`
- Modify: `package.json` (`test:live`), `.gitattributes` (`*.wav binary`), `AGENTS.md`,
  spec sections 5, 8, 9, 10, 11, 13

- [ ] **Step 1:** `wav()` test for the fixture script (RIFF header fields), watch it fail,
      implement, generate the clips.
- [ ] **Step 2:** live test, skipped without `OPENROUTER_API_KEY_TEST`: the real extension
      with the clip as fake microphone and the real API; for each clip the transcript in the
      popover contains at least 80 % of the expected words; then each model of `MODELS` once
      per clip, printing words found and time (the comparison for the spec).
- [ ] **Step 3:** run `pnpm test:live` locally; record the comparison in spec section 13.
- [ ] **Step 4:** commit "Add the live voice test".

**Acceptance:** dictating a comment works in a real Chrome; live test green locally; CI never
calls OpenRouter.

---

## Milestone 6: Review workflow

**Goal:** Make the extension fit a repeated review loop across several projects: one collection
per site, items that become done when copied, Copy again, a filter for done and deleted items,
undo and redo, an Edit and a Settings view with the shortcut list, and the page and the list
pointing at each other.

**Planned on 2026-10-06** after milestone 5 was tried in a real browser. Tasks 39–47 name files,
interfaces and the tests to write first; the implementation follows in the same pull request.
Steps are test-first: write the listed tests, watch them fail, implement, watch them pass,
commit.

**Facts this milestone relies on:**

- `MessageSender.url` is the URL of the frame that sent a message; for the overlay (top frame
  only) it names the page and so the site. `sender.frameId` is 0 for the top frame.
- `chrome.storage.session` holds 10 MB from Chrome 112 on and is closed to content scripts by
  default; `chrome.storage.local` and its change events reach content scripts.
- `tabs.create` needs no permission; an extension page may open `chrome://extensions/shortcuts`
  with it.
- Tailwind v4 no longer gives buttons `cursor: pointer`; one base rule restores it for every
  enabled button, link and `role="button"`.
- Without the `tabs` permission the panel learns a tab's URL only from its overlay (or for
  granted origins); a tab without an answering overlay has no known site.

**Decisions:**

- **A site is `URL.origin`** for `http:` and `https:` pages and `file://` for local files.
  Each site's collection is stored under `collection:<site>`; a write touches one site. The
  old single collection is split once, when the background starts (queued before any write).
- **Statuses** `open | done | deleted` are part of the model from the first task that changes
  it (Task 40), so the old collection is migrated once; the transitions come in Task 42.
- **Delete keeps the item** (status `deleted`); only **Clear all** removes items, and only
  those of the active site. Restore makes a deleted item open; Reopen makes a done item open;
  saving a changed comment on a done item reopens it.
- **Copy as prompt** formats the open items of the active site, writes the clipboard, then
  sends the ids it copied (`collection:copied`); the background marks exactly those done, so an
  item added meanwhile in another tab stays open. The same happens when the clipboard fails
  and the text is offered in the dialog. **Copy again** formats the ids of `lastCopy` that still
  exist and are not deleted, and changes nothing.
- **The filter** (`view` in `storage.local`, written by the background on `view:set` from the
  panel) is one choice for the panel's list and every tab's pins: `open`, `all` (open and
  done), `with-deleted`. Default `open`. Pins of hidden items are not placed at all.
- **Undo and redo** live in the background: every successful change of a site's collection is
  recorded as a step (the changed items and pages before and after, plus `nextNumber` and
  `lastCopy`), at most 50 per direction, in `storage.session` (`history:<site>`), with a small
  `historyLabels:<site>` entry for the panel's buttons and tooltips. Undo checks that every
  item and page it puts back still looks like the step's other side and refuses otherwise.
- **Senders:** collection messages from a page count only from the top frame and only for the
  site of `sender.url`; `collection:copied`, `collection:clear`, `annotation:reopen`,
  `history:*` and `view:set` only from the panel's URL; `annotation:remove` and
  `annotation:restore` from either.
- **The panel's layout:** title row (Edit or Settings, site, count, Undo, Redo, gear or X),
  then the buttons, then the texts, then the list; the footer holds Copy as prompt, Copy again
  and Clear all. Settings hides the buttons, the texts and the footer.
- **Status colors:** open `blue-600`, done `green-700`, deleted `red-600` (white numbers keep
  at least 4.5:1 contrast). The same three tones mark outlines and text shading.
- **Page ↔ list:** the overlay posts `{ type: 'pins:pointed', hovered, open }` (item ids or
  null) on the lines the panel keeps to it; the panel marks those entries for the tab it
  shows. A click on an entry of another page sends `tab:go`, then waits up to 30 s for the
  overlay of that page to answer and sends `overlay:reveal`; the overlay waits up to 3 s for
  the item to be placed.

**Known limits:** undo lasts for the browser session; a tab whose overlay is not active shows
no site in the panel (Chrome tells the panel nothing about it); the filter is the same for
every site.

**Review focus for this milestone** (each line has a test in the owning task):

1. An existing collection from milestone 5, including file pages and a malformed one: split
   by site with numbers kept and every item open; a second start changes nothing; nothing is
   lost when the split runs while a page saves (Task 40).
2. A page or another site's overlay sending collection, copy, clear, undo or view messages:
   refused, nothing written (Tasks 40, 42, 43, 45).
3. Copy while another tab adds an item: only the copied items become done; Copy again after
   a deletion leaves the deleted item out (Tasks 42, 43).
4. Undo and redo across tabs of a site, after a refused write, after the history and the
   collection got out of step, at the 50-step limit and when `storage.session` is full
   (Task 45).
5. The filter, pins and list agree: a hidden item has no pin, hovering a pin of a status the
   list hides cannot happen, a jump to a missing item or a page whose overlay never answers
   ends quietly (Tasks 43, 44, 46).

**Pre-flight (shared interfaces):** Task 40's `siteOf`, `Collection` (version 2 with `site`,
`status`, `lastCopy`), `loadSite`/`watchSite`/`loadSites` and the writer's `write(site, msg)`
feed every later task; Task 42's statuses and `collection:copied` are what Task 43's panel
and Task 44's popover send; Task 43's `view` store is what Task 44's overlay reads; Task 45
wraps the writer of Tasks 40 and 42; Task 46 uses Task 39's layout and Task 43's list.

### Task 39: Edit and Settings views, the shortcut list, pointer cursors

**Files:**

- Create: `src/lib/shortcuts.ts`, `src/entrypoints/sidepanel/ShortcutList.vue`,
  `tests/unit/shortcuts.test.ts`, `tests/e2e/panel-layout.e2e.test.ts`
- Modify: `src/entrypoints/sidepanel/App.vue`, `src/entrypoints/sidepanel/SettingsView.vue`,
  `src/assets/tailwind.css`, `src/entrypoints/overlay.content/CommentPopover.vue`
- Test: `tests/unit/sidepanel-app.test.ts`, `tests/unit/sidepanel-voice.test.ts`,
  `tests/unit/comment-popover.test.ts`, `tests/e2e/remembered.e2e.test.ts`,
  `tests/e2e/voice.e2e.test.ts`

**Interfaces:**

- Produces (`shortcuts.ts`): `interface ShortcutRow { keys: string[]; action: string }`,
  `interface ShortcutGroup { title: string; rows: ShortcutRow[] }`,
  `shortcutGroups(mac: boolean): ShortcutGroup[]` (On the page, Element mode, Area mode, In a
  comment), `isMacPlatform(platform: string): boolean`.
- Produces (panel): `data-testid="panel-title"` (Edit or Settings), `open-settings` (gear) and
  `close-settings` (X) in the same place of the title row, `shortcut-list`,
  `change-shortcut`.

- [ ] **Step 1: Write the failing tests:**
  - panel: the title says Edit; the mode switch, Pins toggle and filter come before the tab
    status in document order; the gear opens Settings, which says Settings, shows an X with
    `close-settings` and no mode switch, Pins toggle, tab status or footer; X returns to Edit;
    **Open settings** from a popover opens Settings with the same header.
  - shortcut list: Settings lists the toolbar shortcut Chrome assigned (or "Not set") with
    **Change**, which opens `chrome://extensions/shortcuts` in a new tab; it lists E, A, P,
    Esc, ↑, ↓, Enter (element mode), Esc (area drag), Enter, Shift+Enter, Esc, Alt+V (in a
    comment); macOS shows `⌥V` for Alt+V.
  - keys agree with the handlers: each page row's key gives the named action through
    `pageShortcut`, each comment row's through `popoverKey`.
  - popover: the element that cuts the title with an ellipsis is the target label in the
    muted color, never the title paragraph (the `…` takes the label's color).
  - E2E: every enabled `button` in both panel views and the overlay's pins and popover buttons
    computes `cursor: pointer`; a disabled one does not.
- [ ] **Step 2: Run them, watch them fail;** **Step 3: implement;** **Step 4: run
      `pnpm test:unit`, `pnpm build && pnpm test:e2e` for the touched files;** **Step 5:
      commit** "Give the panel an Edit and a Settings view with the shortcut list".

### Task 40: One collection per site

**Files:**

- Create: `src/lib/collection/site.ts`, `src/lib/collection/migrate.ts`,
  `tests/unit/collection-site.test.ts`, `tests/unit/collection-migrate.test.ts`,
  `tests/e2e/sites.e2e.test.ts`
- Modify: `src/lib/collection/{model,ops,validate,store}.ts`,
  `src/composables/use-collection.ts` (becomes `useSiteCollection`),
  `src/lib/background/{writer,anchor-status}.ts`, `src/entrypoints/background.ts`,
  `src/lib/messages.ts`, `src/entrypoints/sidepanel/App.vue`,
  `src/entrypoints/overlay.content/Overlay.vue`, `tests/unit/helpers/collection.ts`,
  `tests/e2e/overlay-helpers.ts` (`storedCollection` merges every site)
- Test: the collection, writer, background, anchor-status, panel, overlay and formatter unit
  tests; `tests/e2e/go-to.e2e.test.ts`, `tests/e2e/element-mode.e2e.test.ts`,
  `tests/e2e/voice.e2e.test.ts`

**Interfaces:**

- Produces (`site.ts`): `siteOf(url: string): string` (throws on a URL that is not
  `http:`, `https:` or `file:`), `isSite(x): x is string`, `siteLabel(site): string`
  (`localhost:3000`, `example.com`, `Local files`).
- Produces (`model.ts`): `type Status = 'open' | 'done' | 'deleted'`, `STATUSES`,
  `Annotation.status: Status`, `Collection { version: 2; site; nextNumber; pages; items;
lastCopy: string[] }`, `LegacyCollection` (version 1, items without status).
- Produces (`ops.ts`): `emptyCollection(site)`; `addAnnotation` refuses a page of another
  site and creates open items; `clearAll(c)` keeps the site.
- Produces (`validate.ts`): `isCollection(x)` for version 2 (site is a site, every page and
  item belongs to it, statuses known, `lastCopy` ids unique and at most 1000),
  `isLegacyCollection(x)`.
- Produces (`migrate.ts`): `splitLegacy(legacy: LegacyCollection): Collection[]`.
- Produces (`store.ts`): `COLLECTION_PREFIX = 'collection:'`, `LEGACY_KEY = 'collection'`,
  `collectionKey(site)`, `loadSite(site): Promise<Collection>` (empty for none, malformed or
  another site's value), `watchSite(site, cb): () => void`, `loadSites(): Promise<Collection[]>`
  (valid ones, by site), `watchSites(cb: () => void): () => void`.
- Produces (writer): `createWriter(now?)` → `{ write(site: string, msg: CollectionMessage):
Promise<Reply>; migrate(): Promise<void> }`; an empty collection removes its key.
- Produces (messages): `annotation:update`, `annotation:remove` and `collection:clear` carry
  `site`; `annotation:add` takes its site from `page.url`.
- Produces (composable): `useSiteCollection(site: Ref<string | null>): { collection:
Ref<Collection | null> }`.

- [ ] **Step 1: Write the failing tests:**
  - site: origins for `http`/`https` with and without port; `file:///a/b.html` → `file://`;
    credentials and paths never reach the site; `siteLabel`; `isSite` refuses paths, other
    schemes and `null`.
  - migrate: a legacy collection with items on two origins and a file page becomes three
    collections; every item keeps id, number, comment and target and is open; pages go with
    their items; `nextNumber` stays the legacy one; `lastCopy` empty.
  - validate: version 2 accepted; refused: unknown status, a page or item of another site,
    a `lastCopy` id twice, a version-1 value; `isLegacyCollection` accepts what milestone 5
    stored.
  - store: `loadSite` for a missing key, a malformed value and a value of another site under
    the key → empty collection of the asked site; `watchSite` reports only its key;
    `loadSites` skips malformed values.
  - writer: writes go to the page's site only; two sites count numbers from 1 each; clearing
    one site leaves the other; an emptied site removes its key; `migrate` splits the legacy
    key and removes it, leaves existing site keys alone, removes a malformed legacy value, and
    a second `migrate` does nothing; a write queued during `migrate` lands after it.
  - background: `annotation:add` from a tab whose `sender.url` is on another site, from a
    sub-frame or without a tab is refused; `annotation:update`/`remove` for another site than
    the sender's are refused; `collection:clear` only from the panel; anchor reports count only
    for the reported page's site; Go to finds the page in its site's collection.
  - panel: lists only the active site's items; switching to a tab of another site switches
    the list; a tab without an answering overlay shows the status and no list; copy and
    clear name the site.
  - overlay: pins and saves use the page's site.
  - E2E (`sites.e2e.test.ts`): two fixture servers on two ports; items on each start at 1;
    the panel follows the active tab; Copy as prompt on one copies only its items; a legacy
    `collection` written before the service worker restarts is split.
- [ ] **Steps 2–5** as in Task 39; commit "Keep one collection per site".

### Task 41: The site in the panel and in Settings

**Files:**

- Create: `src/entrypoints/sidepanel/use-sites.ts`, `src/entrypoints/sidepanel/SiteList.vue`
- Modify: `App.vue`, `ItemList.vue`, `SettingsView.vue`
- Test: `tests/unit/sidepanel-app.test.ts`, `tests/unit/sidepanel-sites.test.ts`

**Interfaces:**

- Produces: `useSites(remembered: Ref<string[]>): { sites: Ref<SiteEntry[]> }` with
  `SiteEntry { site: string; open: number; remembered: boolean }` (remembered sites and sites
  with items, sorted by label); `data-testid="site-label"`, `site-link`, `site-open-count`.

- [ ] **Step 1: Write the failing tests:** the title row shows `localhost:3000` with the full
      origin as tooltip and the open count; page headings show title and path (`/settings?tab=2`);
      Settings › Sites lists remembered sites and sites with feedback (counts of open items,
      **Auto** and **Forget** for remembered ones only); clicking a web site's address opens it in
      a new tab; a `file://` site has no link; nothing renders page strings as HTML.
- [ ] **Steps 2–5;** commit "Show the site in the panel and every site in Settings".

### Task 42: Statuses in the background

**Files:**

- Modify: `src/lib/collection/ops.ts`, `src/lib/background/writer.ts`,
  `src/lib/messages.ts`, `src/entrypoints/background.ts`
- Test: `tests/unit/collection-ops.test.ts`, `tests/unit/background-writer.test.ts`,
  `tests/unit/background.test.ts`, `tests/unit/messages.test.ts`

**Interfaces:**

- Produces (`ops.ts`): `setStatus(c, id, status, now)`, `markCopied(c, ids, now)` (open
  items among `ids` become done; `lastCopy` = the ids that exist), `updateComment` reopens a
  done item whose comment changed.
- Produces (messages): `annotation:remove` now marks deleted; new `{ type: 'annotation:restore';
site; id }`, `{ type: 'annotation:reopen'; site; id }`, `{ type: 'collection:copied'; site;
ids: string[] }` (1–1000 ids).

- [ ] **Step 1: Write the failing tests:** remove marks deleted and keeps the item, its page
      and its number; restore and reopen change only the matching status and answer ok without a
      write otherwise; a missing id says "This item no longer exists."; `markCopied` with an id
      added after the copy started leaves that item open, skips deleted ids, and sets `lastCopy`;
      editing a done item's comment reopens it, the same text does not; `collection:copied` and
      `annotation:reopen` from a tab are refused; restore from another site's overlay is refused.
- [ ] **Steps 2–5;** commit "Keep deleted items and mark copied ones done".

### Task 43: Copy, Copy again and the filter in the panel

**Files:**

- Create: `src/lib/view.ts`, `src/lib/status.ts` (labels and color classes),
  `tests/unit/view.test.ts`
- Modify: `src/lib/collection/ops.ts` (`pick`), `src/lib/messages.ts` (`view:set`),
  `src/entrypoints/background.ts`, `App.vue`, `ItemList.vue`, `ClearAllDialog.vue`
- Test: `tests/unit/sidepanel-app.test.ts`, `tests/unit/collection-ops.test.ts`,
  `tests/unit/background.test.ts`

**Interfaces:**

- Produces (`view.ts`): `VIEW_KEY = 'view'`, `type Filter = 'open' | 'all' | 'with-deleted'`,
  `FILTERS`, `isView`, `loadView()`, `watchView(cb)`, `shows(item, filter): boolean`.
- Produces (`status.ts`): `STATUS_BADGE: Record<Status, string>` (Tailwind classes),
  `STATUS_NAME`.
- Produces (`ops.ts`): `pick(c, ids: ReadonlySet<string>): Collection` (those items and their
  pages, for the formatter).
- Produces (messages): `{ type: 'view:set'; filter: Filter }`, panel only.
- Produces (panel): `filter-open`, `filter-all`, `filter-with-deleted`, `copy-again`,
  `item-reopen`, `item-restore`, `item-delete`.

- [ ] **Step 1: Write the failing tests:** Copy as prompt copies only open items and then
      sends `collection:copied` with exactly their ids (also when the fallback dialog opens);
      it is disabled without open items; Copy again copies the last copy's items that are not
      deleted, sends nothing, and is disabled without them; the three filters show open / open and
      done / everything, with counts, and send `view:set`; numbers take the status colors and a
      deleted comment is struck through; Reopen, Restore and Delete send their messages; Clear all
      names the site and its item count; `view` falls back to `open` when malformed; `view:set`
      from a tab is refused.
- [ ] **Steps 2–5;** commit "Copy open items, copy again, and filter by status".

### Task 44: Pins by status, Delete and Restore in the popover

**Files:**

- Modify: `src/entrypoints/overlay.content/{Overlay,CommentPopover}.vue`,
  `src/entrypoints/overlay.content/text-marks.ts`
- Test: `tests/unit/comment-popover.test.ts`, `tests/unit/overlay-text-marks.test.ts`,
  `tests/e2e/pins.e2e.test.ts`, `tests/e2e/voice.e2e.test.ts` ("Enter to save" is gone)

**Interfaces:**

- Produces (`CommentPopover`): props `status?: Status`; emits `remove` and `restore`;
  `data-testid="overlay-delete"` and `overlay-restore`.
- Produces (`text-marks.ts`): `set(marks: Record<Status, { normal: Range[]; strong:
Range[] }>)`, highlight names `webdev-pins-<status>` and `webdev-pins-<status>-strong`.

- [ ] **Step 1: Write the failing tests:** an existing open or done item's popover shows
      **Delete** on the left, a deleted one **Restore**, a new comment neither; no "Enter to
      save"; while dictating the status replaces the button; Delete and Restore act only on
      trusted clicks; text marks set one highlight pair per status and clear them all;
      E2E: with filter Open a done item has no pin and no outline, with All a green pin, with + Deleted a red one; Delete in the popover makes the pin go (filter Open) and the panel
      entry red (filter + Deleted).
- [ ] **Steps 2–5;** commit "Color pins by status and delete from the popover".

### Task 45: Undo and redo

**Files:**

- Create: `src/lib/background/history.ts`, `tests/unit/background-history.test.ts`
- Modify: `src/lib/background/writer.ts`, `src/lib/messages.ts`,
  `src/entrypoints/background.ts`, `App.vue`, `src/lib/shortcuts.ts`
- Test: `tests/unit/background-writer.test.ts`, `tests/unit/sidepanel-app.test.ts`,
  `tests/unit/shortcuts.test.ts`, `tests/e2e/sites.e2e.test.ts`

**Interfaces:**

- Produces (`history.ts`): `interface Step { label; items; pages; nextNumber; lastCopy }`
  (spec section 5), `HISTORY_LIMIT = 50`, `HISTORY_PREFIX = 'history:'`,
  `LABELS_PREFIX = 'historyLabels:'`, `stepBetween(before, after, label): Step | null`
  (null when nothing changed), `applyStep(c, step, to: 'before' | 'after'): Collection | null`
  (null when the collection does not match the other side), `loadLabels(site)`,
  `watchLabels(site, cb)`.
- Produces (messages): `{ type: 'history:undo'; site }`, `{ type: 'history:redo'; site }`,
  panel only.
- Produces (panel): `undo`, `redo` buttons with tooltips "Undo: <label>", "Redo: <label>".

- [ ] **Step 1: Write the failing tests:** each change (add, edit, delete, restore, reopen,
      copied, clear) is undone and redone exactly, including `nextNumber` and `lastCopy`; a new
      change clears redo; 51 changes keep 50; an item changed outside the history makes undo
      refuse with the spec's message and clears the history; a refused write records nothing; a
      full `storage.session` drops the oldest steps; the history of one site never touches
      another; the panel's buttons are disabled without steps, name the step, and Ctrl+Z,
      Ctrl+Shift+Z and Ctrl+Y (⌘Z, ⇧⌘Z on macOS) work only outside text fields and only in
      Edit; undo and redo from a tab are refused; E2E: delete, undo, redo across two tabs of a
      site.
- [ ] **Steps 2–5;** commit "Undo and redo every change of a site".

### Task 46: Page and list point at each other

**Files:**

- Modify: `src/lib/messages.ts` (`pins:pointed`), `Overlay.vue`,
  `src/entrypoints/sidepanel/{use-overlay-lines.ts,App.vue,ItemList.vue}`
- Test: `tests/unit/sidepanel-app.test.ts`, `tests/unit/messages.test.ts`,
  `tests/e2e/go-to.e2e.test.ts`, `tests/e2e/pins.e2e.test.ts`

**Interfaces:**

- Produces (messages): `type PinsPointed = { type: 'pins:pointed'; hovered: string | null;
open: string | null }`, `isPinsPointed(x)`.
- Produces (`use-overlay-lines.ts`): returns `{ pointed: Ref<{ hovered: string | null; open:
string | null }> }` for the tab the panel shows.
- Produces (overlay): `overlay:reveal` waits up to `REVEAL_WAIT = 3000` ms for the item to be
  placed.

- [ ] **Step 1: Write the failing tests:** a `pins:pointed` from the shown tab marks the entry
      (and scrolls it into view), from another tab or malformed does nothing, and the mark goes
      when the panel moves to another tab; the overlay posts hovered and open ids on every line
      and nothing else; clicking an entry of another page sends `tab:go` and, once the overlay of
      that page answers, `overlay:reveal`, and gives up after 30 s or when the developer
      clicks something else; E2E: hovering a pin marks its entry; clicking an entry of another
      page opens that page, scrolls to the item and opens its popover.
- [ ] **Steps 2–5;** commit "Let the page and the list point at each other".

### Task 47: The review loop end to end, docs

**Files:**

- Create: `tests/e2e/review-loop.e2e.test.ts`
- Modify: `AGENTS.md` (status), this plan (milestone 7 numbering), the spec where the
  implementation differs

- [ ] **Step 1: Write the E2E test:** two sites; mark three items on one; Copy as prompt →
      clipboard holds three items, all green; mark one more → Copy as prompt copies only it; Copy
      again copies it again; Undo makes it open, Redo done again; delete from the popover, find
      it under + Deleted, Restore; Clear all on one site leaves the other.
- [ ] **Step 2: run the whole suite** (`pnpm check`, `pnpm build`, `pnpm test:e2e`,
      `pnpm manifest:check`); **Step 3: commit** "Test the review loop and update the docs".

## Milestone 6b: Review polish

**Goal:** Smooth the review workflow after trying it on real projects: pins as the one name,
one pin copied on its own, Clear all into Deleted with a bin to empty, the site as a status pill
in the middle of the title row, starting the overlay from the panel where Chrome allows it, two
options in Settings, markings in the status color, and native scrolling in element and area
mode.

**Planned on 2026-10-06** after milestone 6 was tried in a real browser. Tasks 48–54; the
implementation follows in the same pull request. Steps are test-first.

**Facts this milestone relies on (2026-10-06, Chrome for Testing 154):**

- A click in the side panel does not grant `activeTab`: `scripting.executeScript` on a tab the
  extension has no access to fails ("Cannot access contents of the page"), and `tabs.query`
  leaves out that tab's `url`. The panel learns a tab's URL only where it may run already (an
  `activeTab` grant that outlived its overlay, e.g. after a reload or a same-origin navigation,
  or a granted origin).
- A wheel turn over a fixed element scrolls the viewport: the glass needs to scroll by script
  only what lies inside a scroll container. `scrollBy()` follows the page's
  `scroll-behavior: smooth`, and a smooth scroll started while another runs starts from where
  that one is, so quick turns lose distance; `behavior: 'instant'` does not.
- `contextMenus` entries persist across restarts until removed.

**Decisions:**

- **Pin is the name** of an item everywhere the developer reads it: the chip on a selection,
  the popover's title (**New pin**, **Pin 3**), the panel's texts, tooltips, labels and undo
  steps. The text of a pin stays its comment. Code names (`Annotation`, `CommentPopover`) stay.
- **Copy one pin:** an open entry has a copy button where a done entry has Reopen. It copies
  that pin as the prompt and sends `collection:copied` with its id: it becomes done and is
  what Copy again copies.
- **Clear all moves to Deleted:** `collection:clear` marks every open and done pin of the site
  deleted (no dialog: Undo and Restore bring them back). When only deleted pins are left, the
  button becomes **Empty bin**, which removes them for good after a confirmation
  (`collection:empty-bin`, undoable until the browser closes); numbering starts again at 1 once
  nothing is left. Both carry the bin icon.
- **The title row** is a three-column grid: the view's title on the left, the site pill in the
  middle (a dot and the site: green active, grey not active, red refused or failed; "Not
  active" when Chrome does not tell the panel the page), Undo, Redo and the gear on the right.
  The count badge goes; the filter shows the counts. Hovering or focusing the pill opens a
  small popover with its one action: **Forget this site** (remembered; asks in a dialog first),
  **Always enable here** (active, not remembered), **Annotate this page** (not active, page
  known). States without an action get no popover; the pill's tooltip names the full origin.
- **Annotate this page from the panel:** `tab:start { tabId }`, from the panel only, injects
  the overlay as the toolbar does; Chrome refuses where it gives no access, and the panel says
  so. The empty Edit view shows the button in its middle when the page is known, else how to
  start the overlay (toolbar icon, shortcut, and the context menu only while it is enabled).
- **Settings:** a General section with two switches stored in `settings` (written by the
  background on `settings:set { key, value }`, from the panel only, in the same queue as the
  remembered sites): **Show page titles** (off: page headings show the path only) and
  **Annotate this page in the context menu** (off: the background removes the entry; on: it
  adds it). Sections get more space between them. Settings › Sites asks before forgetting too.
- **Page headings:** **This page** first, then the path; the path of another page on the web
  is the Go to link (ghost button style, arrow), no separate button. More space between groups.
- **Layout:** the mode switch and Pins fill the row (equal widths, 8 px between Area and Pins);
  empty states sit in the middle of the list area; no key hints on the Edit view; the copy
  status and errors sit above the footer's buttons, so the footer's padding is the same on
  every side; scrollbars thin, in the border color.
- **Status color for every marking of a saved pin:** the panel's hover highlight and the
  marking of the pin being edited take its status color (blue, green, red); a new pin's stays
  blue.
- **Wheel in element and area mode:** over the document the browser scrolls by itself; inside
  a scroll container under the pointer, the glass scrolls the nearest one that can still move
  that way, at once and by the full distance. A body that is the scroll container itself (the
  root's overflow is not visible) counts as one; a container at its end that keeps the wheel
  (`overscroll-behavior`) scrolls nothing, as without the glass. No option: slower scrolling
  was a bug.

**Known limits:** a page the extension has no access to cannot be started from the panel and
its site cannot be named (Chrome); the panel's switches are the same for every site.

**Review focus for this milestone** (each line has a test in the owning task):

1. A page or another extension context sending `tab:start`, `settings:set` or
   `collection:empty-bin`: refused, nothing written or injected (Tasks 49–51).
2. Settings stored by milestone 6 (no options): read with both options off; a malformed option
   leaves the remembered sites intact (Task 49).
3. Clear all, then Undo; Empty bin, then Undo; Copy again after Clear all; Empty bin while
   open pins exist cannot be reached (Task 51).
4. A status change while the filter shows the pin: pin, outline, text shading, panel highlight
   and popover marking change color without a reload (Task 52).
5. Wheel over the document with `scroll-behavior: smooth`, over a container at its end, and
   with Ctrl held (Task 53).

### Task 48: Pins by name, and the panel's layout

**Files:**

- Modify: `src/entrypoints/sidepanel/{App,ItemList,SettingsView}.vue`,
  `src/entrypoints/overlay.content/{SelectionChip,CommentPopover,Overlay}.vue`,
  `src/lib/background/writer.ts` (step labels), `src/assets/tailwind.css` (scrollbars)
- Test: `tests/unit/{sidepanel-app,comment-popover,background-writer}.test.ts`,
  `tests/e2e/panel-layout.e2e.test.ts` and the E2E tests that name items

- [ ] **Step 1: Write the failing tests:** the chip says Pin; the popover says New pin or Pin 3
      and its buttons say "pin"; the panel says "Copied 2 pins", "Delete pin 1", "2 pins are
      hidden by this filter"; undo steps read "Delete pin 1", "Mark 2 pins done"; the Edit view
      has no key hints; the empty states are centered in the list area; E2E at 400 px: the four
      mode buttons span the row, Area and Pins are 8 px apart, the footer's bottom padding
      equals its side padding, groups are at least 16 px apart.
- [ ] **Step 2–4:** watch them fail, implement, run `pnpm test:unit` and the touched E2E files;
      **Step 5: commit** "Call them pins, and tidy the panel".

### Task 49: Settings options, page headings

**Files:**

- Create: `src/entrypoints/sidepanel/GeneralSettings.vue`, `src/components/ui/switch/*`
  (shadcn-vue CLI)
- Modify: `src/lib/settings.ts`, `src/lib/background/sites.ts` (the settings queue),
  `src/lib/messages.ts`, `src/entrypoints/background.ts`, `src/entrypoints/sidepanel/
{SettingsView,ItemList,App}.vue`
- Test: `tests/unit/{settings,background,messages,sidepanel-app}.test.ts`,
  `tests/e2e/panel-layout.e2e.test.ts`

**Interfaces:** `Settings { rememberedOrigins: string[]; pageTitles: boolean; contextMenu:
boolean }`; `{ type: 'settings:set'; key: 'pageTitles' | 'contextMenu'; value: boolean }` →
`Reply`.

- [ ] **Step 1: Write the failing tests:** old settings read with both off; a non-boolean option
      falls back to off without dropping the sites; `settings:set` from a page is refused; it
      keeps the remembered sites and runs in their queue; the context menu entry exists only
      while the option is on (startup, install, change); headings show the path only, the title
      too with the option on; **This page** comes before the path; another page's path is the
      Go to button and there is no `go-to` button; page-derived titles still render as text.
- [ ] **Step 2–4;** **Step 5: commit** "Add page titles and the context menu as options".

### Task 50: The site pill, Annotate this page from the panel

**Files:**

- Create: `src/entrypoints/sidepanel/{SitePill,ForgetSiteDialog}.vue`
- Modify: `src/entrypoints/sidepanel/{App,SiteList}.vue`,
  `src/entrypoints/sidepanel/use-active-tab.ts` (`url` of a known idle tab),
  `src/lib/messages.ts`, `src/entrypoints/background.ts`
- Test: `tests/unit/{sidepanel-app,background,messages}.test.ts`,
  `tests/e2e/{remembered,reactivate}.e2e.test.ts`

**Interfaces:** `TabStatus` idle and failed carry `url?: string`;
`{ type: 'tab:start'; tabId: number }` → `Reply`.

- [ ] **Step 1: Write the failing tests:** the pill sits between title and Undo, centered, with
      a green, grey or red dot and the site; hovering or focusing opens its action; Forget asks
      first and forgets only on confirm (also in Settings › Sites); Always enable here asks
      Chrome first; a known idle page offers Annotate this page in the pill and in the middle of
      the view, which sends `tab:start`; an unknown page shows "Not active" and how to start;
      `tab:start` from a page is refused; a refused start is shown. E2E: reload a page, start
      the overlay again from the panel without the toolbar.
- [ ] **Step 2–4;** **Step 5: commit** "Show the site as a pill and start the overlay from the
      panel".

### Task 51: Copy one pin, Clear all into Deleted, Empty bin

**Files:**

- Create: `src/entrypoints/sidepanel/EmptyBinDialog.vue` (replaces `ClearAllDialog.vue`)
- Modify: `src/lib/collection/ops.ts` (`clearAll`, `emptyBin`), `src/lib/messages.ts`,
  `src/lib/background/writer.ts`, `src/entrypoints/background.ts`,
  `src/entrypoints/sidepanel/{App,ItemList}.vue`
- Test: `tests/unit/{collection-ops,background-writer,background,messages,sidepanel-app}.test.ts`,
  `tests/e2e/review-loop.e2e.test.ts`

**Interfaces:** `clearAll(c, now): Collection` (open and done → deleted);
`emptyBin(c): Collection` (deleted pins removed, pages without pins dropped, `lastCopy`
filtered, numbering reset when empty); `{ type: 'collection:empty-bin'; site: string }`.

- [ ] **Step 1: Write the failing tests:** ops; writer labels "Clear all" and "Empty bin";
      undo after each; `collection:empty-bin` from a page refused, missing marks of removed pins
      forgotten; the panel's copy button on open entries copies one pin and sends its id, Copy
      again copies it again; Clear all needs no dialog and says how many moved; Empty bin shows
      only when nothing open or done is left, asks first.
- [ ] **Step 2–4;** **Step 5: commit** "Copy one pin, and clear into Deleted".

### Task 52: Markings in the status color

**Files:**

- Modify: `src/entrypoints/overlay.content/{HoverBox,TextHighlight,Overlay}.vue`,
  `src/lib/status.ts`
- Test: `tests/unit/overlay-boxes.test.ts` (new), `tests/e2e/pin-outlines.e2e.test.ts`

- [ ] **Step 1: Write the failing tests:** the panel's highlight and the popover's marking of a
      done pin are green, of a deleted one red, of an open one and a new one blue; E2E with All:
      Copy as prompt turns pin, outline and text shading green and Reopen blue, without a
      reload.
- [ ] **Step 2–4;** **Step 5: commit** "Mark pins in their status color everywhere".

### Task 53: Native scrolling in element and area mode

**Files:**

- Create: `tests/fixtures/sites/plain/smooth.html`
- Modify: `src/entrypoints/overlay.content/{picker.ts,Overlay.vue}`
- Test: `tests/unit/picker.test.ts`, `tests/e2e/element-mode.e2e.test.ts`

- [ ] **Step 1: Write the failing tests:** `scrollableAncestor` skips a container that cannot
      move further that way; E2E on a page with `scroll-behavior: smooth`: four quick wheel
      turns scroll the document as far in element mode as in browse mode, and a smooth inner
      container by the full distance; a container at its end lets the page scroll.
- [ ] **Step 2–4;** **Step 5: commit** "Scroll as fast in element mode as without it".

### Task 54: The loop end to end, docs

- Modify: `tests/e2e/review-loop.e2e.test.ts`, the spec (sections 5, 8, 10, 11), `AGENTS.md`
- [ ] **Step 1:** the review loop copies one pin, clears into Deleted, empties the bin;
      **Step 2:** whole suite (`pnpm check`, `pnpm build`, `pnpm test:e2e`,
      `pnpm manifest:check`); **Step 3: commit** "Test the polished loop and update the docs".

## Milestone 7a: Everyday fixes

**Goal:** Close the gaps from earlier reviews that a developer meets in daily use: unsaved text
that a click throws away, a hidden target's popover in the corner, the Pin chip stuck at the
viewport edge, dictation that Ctrl+Z cannot undo, and the last site's list flashing after a
site switch.

**Planned on 2026-10-07** from the deferred minors of milestones 2–6b that are still open
(checked against the code: overlapping pins, the pin of a hidden target, the highlight after
the panel closes and a grown popover were fixed in milestones 3 and 4). Tasks 55–60; one pull
request. Steps are test-first. The security review, the smoke checklist and the README stay in
milestone 7.

**Decisions:**

- **Unsaved text stays:** the popover has unsaved changes when its comment differs from the
  saved one (ignoring spaces at the ends; any text for a new pin) or a dictation runs or holds
  a recording to retry. While it has, a click on another pin, an entry in the panel or a Go to
  does not replace it: the popover says "Save or cancel this pin first." and takes the focus,
  and the panel shows the refusal. `Esc` and Cancel still discard. Clicking the pin whose
  popover is open, or its entry, keeps the popover as it is. Go to asks the overlay first
  (`overlay:leave`, background → overlay, before `tab:go` navigates).
- **A running overlay is not started again:** the toolbar, its shortcut, the context menu and
  the panel's Annotate this page inject the overlay only when none answers on the tab
  (`overlay:status`). A restart threw away the open popover, the mode and what was marked in
  the session (live anchors).
- **A hidden target's popover** (opened from the panel) sits in the middle of the viewport, a
  third from the top, and its header says "hidden" instead of a size; no marking is drawn in
  the corner. It moves next to the target once that is rendered. Hidden means no box at all
  (`display: none`), also for an area whose container is not rendered; a rendered box without
  height keeps its size.
- **The Pin chip** shows only while some of its selection (from its first shown character to
  its last) is visible in the viewport and in the boxes that clip it, and while its end is
  rendered; it comes back with the selection. A release over a pin offers the chip too.
- **Dictation:** `Ctrl+Z` takes the last dictated text out again and `Ctrl+Shift+Z` puts it
  back, while nothing else changed the field; the popover does it itself. (Planned first as an
  edit of the field with `insertText`, so the browser's undo would know it: dropped during the
  milestone, since the page's listeners read the input events of edits and would read what was
  dictated.) No space after an opening bracket or quote; guillemets open only after white
  space. A refused request (unknown model) offers **Open settings**. A dictation
  ended by another one says "Another dictation started, this one ended." (also when it only
  held a recording to retry).
- **After a site switch** the panel's list is empty until the new site's pins are read, never
  the last site's.

**Known limits:** a reload or a navigation by the page itself still drops unsaved text (the
overlay does not hold up the page's own navigation).

**Replaced in milestone 8b:** nothing is refused any more; a popover that closes keeps its pin
(a new one as a draft), also when the page goes, and a dictation's text goes into the stored
pin, where the panel's Undo takes it back instead of `Ctrl+Z` in the popover.

**Review focus for this milestone** (each line has a test in the owning task):

1. A popover with only spaces added, or an edit changed back to its saved text: not unsaved, a
   click elsewhere replaces it as before (Task 55).
2. `overlay:leave` and `overlay:status` from a page script or another extension: the overlay
   answers the extension only; an overlay that does not answer (orphaned, none) is started
   and Go to navigates (Task 55).
3. A page that hides the target while its popover is open, and shows it again (Task 56).
4. A selection inside a scroll container scrolled out of that container (Task 57).
5. A page that edits the field while the dictated text goes in: the guard restores the user's
   text and the dictated one (Task 58).

### Task 55: Unsaved text stays

**Files:**

- Modify: `src/entrypoints/overlay.content/{CommentPopover,Overlay}.vue`, `src/lib/messages.ts`,
  `src/entrypoints/background.ts`, `src/entrypoints/sidepanel/App.vue`
- Test: `tests/unit/{comment-popover,messages,background,sidepanel-app}.test.ts`,
  `tests/e2e/unsaved.e2e.test.ts` (new)

**Interfaces:** CommentPopover emits `unsaved: [boolean]` and takes `nudge?: number` (focus
the field when it changes); `{ type: 'overlay:leave' }` → `Reply`; the overlay's reply to
`overlay:reveal` is ok when the pin is shown or will be once placed, and refuses while
unsaved.

- [ ] **Step 1: Write the failing tests:** the popover reports unsaved for new text, a changed
      edit, a running dictation, not for spaces at the ends or an edit changed back; the
      `overlay:leave` guard; Go to is refused while the overlay refuses and goes when no
      overlay answers; the toolbar and the panel do not inject where an overlay answers; the
      panel shows a refused reveal and a refused Go to and drops the pending jump. E2E: a new
      pin with text survives a click on another pin, an entry, Go to, and the toolbar closing
      and opening the panel; the popover says why; after `Esc` the click works.
- [ ] **Step 2–4;** **Step 5: commit** "Keep unsaved text when something else asks for the
      popover".

### Task 56: A hidden target's popover

**Files:**

- Modify: `src/entrypoints/overlay.content/{place.ts,Overlay.vue}`
- Test: `tests/unit/overlay-place.test.ts`, `tests/e2e/pins.e2e.test.ts`

- [ ] **Step 1: Write the failing tests:** `placeNear` puts a popover for a target without a
      box in the middle, a third from the top; E2E: an entry of a hidden element opens its
      popover there with "hidden" in the header, no marking at the corner; showing the
      element moves the popover next to it.
- [ ] **Step 2–4;** **Step 5: commit** "Open a hidden target's popover in the middle".

### Task 57: The Pin chip follows its selection

**Files:**

- Modify: `src/entrypoints/overlay.content/Overlay.vue`
- Test: `tests/e2e/text-mode.e2e.test.ts`

- [ ] **Step 1: Write the failing tests:** E2E: the chip goes when its selection scrolls out of
      the viewport and comes back with it; a selection in a scroll container scrolled out of
      it has no chip; a selection released over a pin gets its chip; a chip clicked, the popover
      saved: no chip comes back for the old selection.
- [ ] **Step 2–4;** **Step 5: commit** "Show the Pin chip only with its selection".

### Task 58: Dictation fixes

**Files:**

- Modify: `src/entrypoints/overlay.content/{transcript.ts,comment-guard.ts,CommentPopover.vue}`,
  `src/lib/voice/protocol.ts`
- Test: `tests/unit/{overlay-transcript,comment-guard,comment-popover,voice-protocol}.test.ts`,
  `tests/e2e/voice.e2e.test.ts`

**Interfaces:** none new (the planned `insertTranscript` extras and `CommentGuard.expect` went
with the `insertText` approach, see the decision above).

- [ ] **Step 1: Write the failing tests:** no space after `(`, `[`, `{`, an opening quote;
      `Ctrl+Z` and `Ctrl+Shift+Z` switch between the texts before and after the dictation;
      Open settings for a refused request; the taken text. E2E: dictate, `Ctrl+Z` brings the
      text before the dictation back, and the page's own input listener never sees the
      dictated text.
- [ ] **Step 2–4;** **Step 5: commit** "Let Ctrl+Z undo a dictated text, and fix its
      messages".

### Task 59: The panel after a site switch

**Files:**

- Modify: `src/composables/use-site-collection.ts`
- Test: `tests/unit/sidepanel-app.test.ts` or a new `tests/unit/use-site-collection.test.ts`

- [ ] **Step 1: Write the failing test:** while the new site loads, the collection is null,
      never the last site's.
- [ ] **Step 2–4;** **Step 5: commit** "Show no list of the last site while the next loads".

### Task 60: Docs and the whole suite

- Modify: the spec (sections 8, 9, 10), `AGENTS.md`
- [ ] **Step 1:** docs; **Step 2:** whole suite (`pnpm check`, `pnpm build`,
      `pnpm test:e2e`, `pnpm manifest:check`); **Step 3: commit** "Describe the everyday
      fixes".

## Milestone 7b: Security review

**Goal:** Fix what an independent security review of the whole extension found, each finding
with a regression test that fails first (milestone 7).

**Reviewed on 2026-10-07** at the head of milestone 7a by three fresh reviewers in parallel, by
attack surface: the extension boundary (background, messages, side panel, permissions, the
API key), the page boundary (overlay, capture, the main-world bridge, the prompt) and the
supply chain (dependencies, CI, MCP, build output). Threat model: a hostile or compromised page
(also third-party scripts on the developer's own app), another installed extension, the
network, the supply chain; a compromised renderer or browser is out of scope (noted as
defense in depth). Tasks 61–68 are the extension and ship in one pull request; Tasks 69–70
change the repository's guards and CI and ship in their own pull request (`AGENTS.md`: a check
is fixed in its own PR).

**What held:** every background message is gated by sender and shape; no external messaging;
the API key never leaves the extension origin except to OpenRouter; no HTML sinks in the panel;
`isTrusted` on every overlay action; form values never captured; quotes and code spans in the
prompt cannot be broken; fork pull requests get no secrets; actions pinned; the production
build has no remote code, eval or source maps; nothing sensitive in the history.

**Decisions:**

- **The overlay's host is a `div`, not a custom element.** A page could define the custom
  element name first: the overlay then got the page's element, and through
  `ElementInternals` the page reached the closed shadow root (read and change the comment,
  move the focus onto Delete or the mic). A built-in element runs no page code and has no
  internals. The comment guard also requires trusted input events, and IME composition only
  between trusted `compositionstart` and `compositionend`.
- **The guard checks where an edit lands:** an insert keeps the text before and after the
  selection it was announced for; a deletion removes one range that touches that selection.
  A page's select-all plus a replay of the developer's keystroke is restored. The guard also
  keeps the selection the developer made (taken during their own selection gestures, else
  computed from the edits it accepted), puts it back before each key and announces each edit
  for it: a selection the page moves first (`selectAll`, `Selection.modify()`) does not decide
  where the developer's key lands. An input method writes where it started, a drag removes
  only the selection, a drop removes nothing, undo and redo return only to a text the
  developer had, and dictation goes in at the developer's selection.
- **Invisible characters never reach the prompt:** format characters (zero-width, Unicode
  tags, bidi controls, soft hyphen), variation selectors and filler characters are removed
  from captured text and from comments; one zero-width (non-)joiner or presentation selector
  attached to a character stays in captured text (Persian and Indic words, emoji sequences),
  and stored text items are found again by their text cleaned the same way; text hidden with
  `opacity: 0` or `font-size: 0` is not read.
- **Page strings in the prompt are always delimited:** component names and file paths as code
  spans (names must be identifiers, paths must end in a source extension, else dropped), the
  title quoted, style values in a code span, the URL heading in angle brackets. The preamble
  says that only the blockquoted lines are the developer's words.
- **A covered overlay takes no clicks:** Save, Delete, Restore, the mic, Retry, Grant and the
  Pin chip act only once the browser has reported them unobscured for half a second
  (Intersection Observer v2: a cover taken away as the pointer is pressed does not count);
  otherwise the popover says "Something on this page covers the overlay." until they are seen
  again. The host is raised again as soon as something covers it, at most once a second (a
  web component's popover opened later covers it, too). A page hiding the host's popover
  re-shows it. The overlay's theme is declared inside its shadow root, with the defaults of
  Tailwind's registered variables and a left-to-right direction: what a page sets on the host
  does not reach it.
- **No page-visible start signal:** the overlay uses its own content-script context without
  WXT's `postMessage` and document event (which revealed the extension id and let a page
  remove the overlay); a newer overlay stops the older one through the content-script
  world's own global.
- **Overlay questions fail closed:** `overlay:leave` and `overlay:status` wait up to 10 s; a
  late answer to `overlay:leave` refuses Go to ("The page is busy. Try again in a moment."),
  a late `overlay:status` counts as running.
- **The background trusts less:** `site:remember`, `site:forget` and `tab:go` accept the panel
  only; a page's URL is stored as its page key (no credentials, no fragment); the context
  menu entry follows the stored option in one queue; the panel talks to the top frame only
  and checks the overlay's site against the tab's URL; `externally_connectable` is declared
  empty.
- **Storage cannot be lost or filled:** a stored collection that no longer validates is kept
  (copied aside once) and its valid pins are used, never overwritten by an empty one;
  `unlimitedStorage` (no install warning) plus a per-site budget for pins with a clear
  refusal; the undo history has one budget across sites, in UTF-8 bytes.
- **OpenRouter requests** follow no redirect, send no cookies, referrer or cache, and the
  extension pages' CSP allows connections to `openrouter.ai` only.
- **Repository (own PR):** the denylist scan runs in its own CI job that installs nothing; the
  MCP server runs through `pnpm dlx` (age gate and build allowlist apply); `.zip`, `.output/`,
  `.wxt/` and `.superpowers/` are forbidden paths; a bundle check (no source maps, eval,
  dev hosts or unknown remote hosts) runs in CI and `pnpm zip`; a pre-push hook checks
  identities, messages, added lines and ref names of what is pushed; the history scan checks
  every pattern, paths, author names and merges.

**Known limits:** a page can still read the focused comment field through the selection
(an extension-origin editor iframe would close that; candidate for later); a page that moves
the field's selection during the developer's own selection gesture (a held press in the field,
an arrow key) still chooses where the next edit lands, spelling suggestions are not checked
against the selection, and Select All from the context menu is undone by the next key (the
same iframe would close these); Go to opens a page without its fragment, so a hash-routed app
opens on its default route; a page can still
observe its own pinned ranges through `CSS.highlights`; a page can freeze itself while the
developer points at a 1000-level-deep tree (selector search). Left for later as well: each
"not found" report reads every site's collection (performance; done right it needs the
missing marks stored per site), and a form dialog with a field named like a DOM method can
keep the popover from opening there. The development build keeps WXT's own content security
policy: its reload connects over a socket.

### Task 61: A built-in host, and a stricter comment guard

- Files: `src/entrypoints/overlay.content/{index.ts,comment-guard.ts,CommentPopover.vue}`,
  `tests/fixtures/sites/{taken-name,meddling}/`, `tests/unit/comment-guard.test.ts`,
  `tests/e2e/{activate,robustness}.e2e.test.ts`
- [ ] **Step 1:** failing tests: a page that defines `webdev-overlay` with
      `attachInternals()` cannot reach the shadow root and cannot add words on Enter; an
      untrusted or unannounced composition edit is restored; a select-all replay is restored;
      the failed-start notice still works (a page without an HTML body). **Step 2–4;**
      **Step 5: commit.**

### Task 62: Invisible characters and hidden text

- Files: `src/lib/text.ts`, `src/lib/capture/reader.ts`, `src/lib/format/escape.ts`,
  `tests/unit/{text,capture-text,format-escape}.test.ts`
- [ ] **Step 1:** failing tests: `collapse` drops `\p{Cf}`, tags, variation selectors,
      fillers; comments lose them in the prompt; `opacity: 0` and `font-size: 0` text is not
      read. **Step 2–5.**

### Task 63: Delimited page strings in the prompt

- Files: `src/lib/format/markdown.ts`, `src/lib/capture/{origin.ts,source-attributes.ts}`,
  `tests/unit/{format-markdown,capture-origin}.test.ts`, `tests/unit/golden/*`
- [ ] **Step 1:** failing tests: a component name or path with `) — Note …`, a title with
      ` · Viewport:`, a style value and a URL with instructions stay inside delimiters; names
      that are not identifiers and paths without a source extension are dropped; the
      preamble names the boundary. **Step 2–5.**

### Task 64: A covered overlay takes no clicks

- Files: `src/entrypoints/overlay.content/{CommentPopover.vue,SelectionChip.vue,top-layer.ts,
use-unobscured.ts}`, `tests/fixtures/sites/covering/`, `tests/e2e/top-layer.e2e.test.ts`,
  `tests/unit/overlay-start.test.ts`
- [ ] **Step 1:** failing tests: a `pointer-events: none` popover in a closed shadow root over
      the comment popover: a click on the mic starts nothing and the popover says why; the
      page's `hidePopover()` on the host is undone. **Step 2–5.**

### Task 65: No page-visible start signal

- Files: `src/entrypoints/overlay.content/index.ts`, `tests/e2e/reactivate.e2e.test.ts`
- [ ] **Step 1:** failing tests: the page's `message` listener never sees the extension id; a
      forged start event leaves the overlay running; a second injection still replaces the
      first. **Step 2–5.**

### Task 66: The background trusts less

- Files: `src/entrypoints/background.ts`, `src/lib/background/{ask-overlay,anchor-status}.ts`,
  `src/lib/collection/ops.ts`, `src/entrypoints/sidepanel/{App.vue,use-*.ts}`,
  `src/lib/settings.ts`, `wxt.config.ts`, `scripts/check-manifest.mjs`, tests
- [ ] **Step 1:** failing tests: offscreen-URL senders refused for the three messages; late
      answers refuse Go to and inject nothing; stored URL equals the page key; on→off toggled
      at once leaves no menu entry; `externally_connectable` is `{ ids: [] }`. **Step 2–5.**

### Task 67: Storage cannot be lost or filled

- Files: `src/lib/collection/store.ts`, `src/lib/background/{writer,history}.ts`,
  `wxt.config.ts`, `scripts/check-manifest.mjs`, tests
- [ ] **Step 1:** failing tests: a collection with one invalid pin keeps its valid pins after an
      add and is copied aside; adds beyond the site budget are refused with the message;
      history across sites stays within its byte budget. **Step 2–5.**

### Task 68: OpenRouter requests and the CSP

- Files: `src/lib/voice/openrouter.ts`, `wxt.config.ts`, `scripts/check-manifest.mjs`,
  `tests/e2e/harness.ts` (origin rewrite), tests
- [ ] **Step 1:** failing tests: fetch options; manifest CSP. **Step 2–5.**

### Task 69: Supply chain (own pull request)

- Files: `.github/workflows/ci.yml`, `.mcp.json`, `scripts/{privacy-check,check-bundle}.mjs`
  and tests, `.gitignore`, `package.json`, `pnpm-workspace.yaml`
- [ ] **Step 1:** failing script tests: the secret's job installs nothing; MCP servers run
      through pnpm with an exact version; forbidden paths; the bundle check. **Step 2–5.**

### Task 70: Guards before the push (same pull request as Task 69)

- Files: `.husky/pre-push`, `scripts/privacy-check.mjs` and its tests
- [ ] **Step 1:** failing tests: a rebased commit with another committer is refused before the
      push; history scan finds an address, a forbidden path and an author name. **Step 2–5.**

## Milestone 7c: Release readiness

**Goal:** The rest of milestone 7: an installable package from `pnpm zip`, a README for the
developer who installs and uses the extension, and the manual smoke checklist.

**Planned on 2026-10-07** after milestone 7b. Tasks 71–74; one pull request. Steps are
test-first wherever there is code, or a fact the docs repeat from the code.

**Decisions:**

- **The package:** `pnpm zip` builds for production and packs `.output/chrome-mv3` into
  `.output/webdev-browser-extension-<version>-chrome.zip` (WXT). It is installed by unpacking
  it into a folder that stays, then **Load unpacked** with Developer mode on. No Chrome Web
  Store listing and no signed `.crx`: Chrome installs `.crx` files only from the store, and a
  signing key would have to be kept. After the manifest and bundle checks, a zip check reads
  the package and compares it with the checked build, byte for byte, so what ships is what
  was checked: plain files only, stored or deflated, no encryption, no name outside the
  folder, nothing missing, nothing extra. It reads the zip format itself (Node's own modules
  only). CI runs `pnpm zip`, so every pull request proves the package.
- **Version 0.1.0:** the first version for daily use; the manifest takes the package's
  version.
- **One folder, one extension:** Chrome derives an unpacked extension's id from its folder,
  and pins, settings, the API key and the microphone grant belong to that id. The README says
  so: update by unpacking over the same folder and reloading; another folder is another
  extension with empty storage; removing the extension deletes its data. No `key` in the
  manifest: a fixed id needs a key pair whose private half must be kept, and nothing needs a
  fixed id.
- **README for users:** what it does, an excerpt of a real prompt, install and update, first
  steps, sites, code origin, dictation, the keys, settings, privacy and permissions, limits,
  development. Tests hold it to the code: the keys to the Settings list, the permissions to
  the manifest check, the prompt excerpt to the formatter's golden output. The logo is
  `public/icon/128.png`, no second image. No screenshots (the public-repo policy, and they
  would age with every change of the UI). **Changed after the milestone, at the owner's
  request:** screenshots of a made-up shop page, `tests/fixtures/sites/demo` (the page with its
  pins and the panel, element mode, a comment, the review loop's colors, Settings), taken by
  `pnpm screenshots` from the built extension, so they are retaken rather than redrawn when the
  UI changes; Inter stands in for the system font, so they look alike wherever they are taken.
  A test checks that the README shows every screenshot and that every image it shows exists.
- **Smoke checklist** (`docs/smoke-test.md`): what automation cannot do, in a real Chrome and
  in Brave: install from the zip, the toolbar icon and its shortcut, the context menu entry,
  Chrome's prompt for **Always enable here**, the microphone prompt and the operating
  system's, a real dictation, an update in place that keeps the data, the paste into an agent,
  the icon on a light and a dark toolbar. Pages: `https://example.com` and a local dev server
  of the developer's own app (Vue or Astro for the code origin). Before a release all of it;
  before a pull request the sections its change touches, which the pull request names (spec
  section 12). The owner runs it: an agent has no real browser profile, prompt or microphone.

**Review focus for this milestone** (each line has a test in the owning task):

1. A zip of an earlier version or build left in `.output/`: the zip check reads the zip of
   the current name and version, and fails when it is missing or differs from the build
   (Task 71).
2. A zip entry named outside the folder (`../`, an absolute path, a backslash, a drive
   letter), a directory entry, an unsupported method or encryption: refused (Task 71).
3. CI without the `pnpm zip` step: the repository configuration test fails (Task 71).
4. A key or a permission added later without the README: the tests fail (Task 72).
5. A change to the preamble or the format: the README's excerpt is held to the golden output
   (Task 72).

### Task 71: The package

- Files: `scripts/check-zip.mjs`, `scripts/check-zip.test.mjs`, `package.json`,
  `.github/workflows/ci.yml`, `scripts/repo-config.test.mjs`, `AGENTS.md`
- [ ] **Step 1:** failing tests: a zip equal to the build passes; a missing, extra or changed
      file, an entry outside the folder, a directory entry, an unsupported method, an
      encrypted entry and a file that is no zip are refused; the zip is found by the
      package's name and version; CI runs `pnpm zip`. **Step 2–5.**

### Task 72: README for users

- Files: `README.md`, `tests/unit/readme.test.ts`, `scripts/check-manifest.mjs`,
  `scripts/check-manifest.test.mjs`
- [ ] **Step 1:** failing tests: the README lists every key of the Settings list; it explains
      every permission and optional host the manifest check allows, and names the toolbar
      shortcut; its prompt excerpt is formatter output (its lines appear in the golden
      example, in order). **Step 2:** the README. **Step 3–5.**

### Task 73: The smoke checklist

- Files: `docs/smoke-test.md`, `README.md`, `AGENTS.md`
- [ ] **Step 1:** the checklist, each step with what to do and what to see; every quoted text
      checked against the source. **Step 2:** links from the README and `AGENTS.md`.
      **Step 3: commit.**

### Task 74: Docs and the whole suite

- Files: this plan, the spec, `AGENTS.md`
- [ ] **Step 1:** status in `AGENTS.md`, milestone 7 done in this plan. **Step 2:**
      `pnpm check`, `pnpm zip`, `pnpm test:e2e`. **Step 3: commit.**

## Milestone 7: Hardening and release readiness

**Goal:** Independent security review, smoke checklist, user documentation.

**Files:** `docs/smoke-test.md`, `README.md` (install from source, usage, voice setup,
privacy), fixes from the review.

**Required tests:** every finding of the security review gets a regression test in the owning
module before it is fixed.

**Acceptance:** security review findings resolved; smoke checklist passes in a real Chrome;
`pnpm build && pnpm zip` produce an installable package.

**Done (2026-10-07)** in milestones 7a, 7b and 7c: the review's findings are fixed, each with a
test that failed first (7b); `pnpm zip` produces the package and checks it against the build,
also in CI (7c); the README and `docs/smoke-test.md` are written (7c). The smoke test's run in
a real Chrome and in Brave is the owner's, before the first release.

**Spec follow-ups (apply in the milestone 1 PR):** spec section 12 names the live-test variable
`OPENROUTER_API_KEY_TEST`; section 8 uses `_execute_action` instead of an `activate` command;
section 14 moves the tree under `src/`; milestone 4 adds the pin visibility toggle and the
orphaned-overlay cleanup ("Reload the page").

## Milestone 8a: Rec in the panel

**Goal:** Dictation without a pin: **Rec** in the panel turns speech into text and puts it on
the clipboard as it is, to paste into an agent's prompt or anywhere else.

**Planned and built on 2026-10-07** at the owner's request, after milestone 7. Tasks 75–78;
one pull request.

**Decisions:**

- **The same dictation:** the panel opens its own `voice` port; the background accepts it
  from the panel's URL as it accepts a popover's from a tab's top frame, so key, model,
  language, microphone, the two-minute limit, Retry and "one recorder at a time" are the
  popover's. Rec needs nothing from the page and works on any tab.
- **Raw text, nothing stored:** the transcript goes to the clipboard as it is, without a
  header, a page or a pin; it changes no pin and is kept nowhere.
- **Without the focus:** the text arrives seconds after the stop, often when the developer is
  in the agent's window already. The Clipboard API refuses an unfocused document; the copy
  command does not, in a page of an extension with `clipboardWrite` (a spike in Chrome for
  Testing: the async write failed with "Document is not focused", the copy command wrote).
  The panel sets the text in the copy event, so no field is selected and the focus stays.
  When Chrome refuses anyway, the copy dialog offers the text.
- **Rec and pins at once: never mixed; the clipboard holds what the developer did last.**
  Rec copies only its text, Copy as prompt only pins. Pins copied while Rec runs keep the
  clipboard, also when the two-minute limit stops Rec, and the dialog offers the text
  (selected); Rec stopped or retried by the developer after a copy of pins takes the
  clipboard, and Copy again brings the pins back. A failed copy of pins holds nothing.
  Several texts for copying by hand come one dialog after the other.
- **Layout:** two rows on one grid: the modes and Rec, the filter and Pins. Rec and Pins
  share a column of 22 % of the row (at least 36 px), 8 px from the rest; the left column
  keeps at least its content's width. A container query hides their words below 76 px, so a
  narrow panel shows icons. The modes and the filter items are as wide as each other where
  there is room, and as wide as their words where there is not (in Chrome for Testing's font,
  a 400 px panel makes Element a few pixels wider than Browse). Known limit: in a 320 px
  panel, counts of three digits in every filter push Rec and Pins past the edge.
- **Keys:** `Alt+V` starts and stops Rec in the panel, by the key's place as in a pin; `Esc`
  cancels a running Rec while no dialog is open. Both are in the Settings list and the README.

**Review focus for this milestone** (each line has a test in the owning task):

1. A port from another page of the extension, another extension or a tab's subframe asking to
   dictate: refused (Task 75).
2. The text arriving after the developer left the panel: still on the clipboard (Task 77).
3. Copy as prompt while Rec runs: the pins keep the clipboard, the text is offered, also after
   a click on the busy Rec and after the limit's stop (Tasks 76, 77).
4. Closing the panel while recording: the recorder closes, nothing is sent (Tasks 76, 77).
5. A narrow panel with two-digit counts: nothing overflows, Rec and Pins show icons (Task 77).

### Task 75: The background takes the panel's dictation

- Files: `src/lib/background/voice.ts`, `src/lib/voice/protocol.ts`,
  `tests/unit/background-voice.test.ts`, `tests/unit/helpers/fake-ports.ts`
- [x] Failing tests: the panel dictates like a popover; a start in the panel ends a popover's
      dictation and the other way round; other extension pages stay refused. Then the change.

### Task 76: Rec in the panel

- Files: `src/composables/use-voice.ts` (moved from the overlay, shared),
  `src/entrypoints/sidepanel/{use-dictation.ts,clipboard.ts,RecButton.vue,App.vue,CopyFallbackDialog.vue}`,
  `src/lib/shortcuts.ts`, `tests/unit/sidepanel-rec.test.ts`,
  `tests/unit/sidepanel-clipboard.test.ts`, `tests/unit/shortcuts.test.ts`
- [x] Failing tests: start, clock, stop; the raw text on the clipboard and no pin changed;
      the two-minute note; no overlay needed; the dialog when the clipboard refuses; the
      conflict rules; failures with Grant, Open settings and Retry; `Alt+V` and `Esc`; the
      line closes with the panel. Then the composable, the button and the layout.

### Task 77: End to end

- Files: `tests/e2e/rec.e2e.test.ts`, `tests/e2e/panel-layout.e2e.test.ts`
- [x] Rec with Chrome's fake microphone and the fake OpenRouter: the text on the clipboard
      after the panel lost the focus (a focus-bound write fails this test), on a tab without
      the overlay, the conflict with Copy as prompt, `Alt+V` and `Esc`, no key, the panel
      closing. The layout at 320, 400 and 600 px.

### Task 78: Docs and screenshots

- Files: the spec (sections 3, 5, 8–12), this plan, `README.md`, `docs/smoke-test.md`,
  `AGENTS.md`, `docs/images`
- [x] The spec and the README describe Rec; the smoke test dictates with Rec into a real
      agent; the screenshots are retaken.

**Final review (2026-10-07):** an independent review of the branch found five defects, each
fixed with a test that failed first: a click on the busy Rec (or `Alt+V`) undid the rule for
pins copied meanwhile; the `Esc` that closes the site pill's action also cancelled Rec (that
`Esc` is now consumed); a copy of pins that failed still held the clipboard, and a second text
for copying by hand replaced the first (the dialogs now queue); pins copied while Rec recorded
lost the clipboard to the limit's stop; a page of the extension opened in a tab passed as a
popover's port. Deferred: Settings hides Rec while it records, so it runs on unseen there
until Edit or the two-minute limit.

## Milestone 8c: Text in a link

**Goal:** `Ctrl` + drag (`⌘` on macOS) in Browse mode selects text where Chrome drags a link
instead, while the panel is open; the click with the modifier opens nothing.

**Planned and built on 2026-10-09** at the owner's request, together with milestone 8b (planned
the same day, its own pull request). Tasks 79–81; one pull request.

**Decisions:**

- **The overlay selects by itself.** A spike in Chrome for Testing tried a style sheet adopted
  for the gesture (`-webkit-user-drag: none` and `user-select: text` on links): Chrome then
  selects inside a link, but a drag that starts on the first half of the link's first
  character selects nothing, also with the link made not draggable and also from just before
  the link without any rule. That is where a drag over a link's text begins. With the modifier
  the press is kept from the page instead (`preventDefault`, so no drag, no focus, and no
  handler of the page), the caret goes under the pointer (`caretPositionFromPoint`, else
  `caretRangeFromPoint`), each move with the button held extends the page's selection to the
  caret under the pointer, and a double click selects the word (`Intl.Segmenter`). Nothing is
  added to the page. The chip comes from the release as for any selection.
- **Only while the panel is open, only in Browse mode:** where the overlay loads by itself
  (remembered sites) and the panel is closed, `Ctrl` + click opens a tab as the developer
  expects. Element and area mode keep their glass.
- **Every click with the modifier stays away from the page**, also without a drag (a link,
  a card with a click handler): the gesture is for selecting. Clicks inside the overlay (the
  chip, the pins) are its own.
- **`⌘` on macOS:** `Ctrl` + click is a right click there.
- **Known limits:** no scrolling while the drag reaches the edge of the viewport; in a link the
  page made draggable or unselectable, Chrome paints no selection, but the chip comes and pins
  it.

### Task 79: The gesture

- Files: `src/entrypoints/overlay.content/{link-select.ts,Overlay.vue}`,
  `tests/unit/overlay-link-select.test.ts`
- [x] Failing tests: the modifier per platform; caret, extend, release, a move without the
      button, the double-click word; nothing for another button, an untrusted event, the
      overlay, a text field, Browse without the panel; the click kept from the page. Then the
      module and its listeners (capture phase on the window).

### Task 80: End to end

- Files: `tests/e2e/link-select.e2e.test.ts`, `tests/fixtures/sites/plain/links.{html,js}`
- [x] Text from a link's first letter, a word by double click, a link that starts with an
      image: selected, the chip, no navigation, no tab, no click for the page's handlers; the
      chip clicked with `Ctrl` held opens the popover; a card's click handler gets no
      `Ctrl` + click; with the panel closed `Ctrl` + click opens the link in a new tab.

### Task 81: Keys and docs

- Files: `src/lib/shortcuts.ts`, `src/entrypoints/sidepanel/ShortcutList.vue`, `README.md`,
  the spec (sections 8 and 11), `docs/smoke-test.md`, `tests/unit/{shortcuts,sidepanel-app}.test.ts`
- [x] The Settings list gets **Browse mode**: `Ctrl+drag` (`⌘+drag`) "Select text, also in a
      link", with the note "While this panel is open."; the README's table follows (its test
      holds it to the list); the smoke test drags across a real link.

## Milestone 8b: Dictation in the background, drafts and Rec notes

**Goal:** Dictation and comments behave like notes: nothing written or spoken is lost. The
text is transcribed in the background, so a comment closes on the stop and the panel shows
what is being transcribed; every pin is kept, a new one as a grey draft until it is saved;
Rec's texts stay in the panel as notes; `Space` dictates into an empty comment; a recording
pauses at a limit set in Settings and asks.

**Planned and built on 2026-10-09** at the owner's request, from daily use: the popover had to
stay open while its text was transcribed (closing it dropped the recording), a click on another
pin was refused while one held unsaved text, Rec's texts were gone once copied, and recordings
stopped hard after two minutes. Planned together with milestone 8c (its own pull request).
Tasks 82–90; one pull request. Steps are test-first.

**Decisions** (the owner's):

- **Every pin is kept.** `Esc`, **Close**, a click on another pin or entry, Go to and the page
  going close the popover and keep it: a new pin as a grey draft, also without any text; an
  existing pin's changed comment as it is, without changing its status (a done pin is not
  reopened), and never an empty comment. Only **Delete** throws a new pin away; it was never
  stored. `Esc` while a dictation records, starts or holds a recording that ended by itself
  still cancels it first. A running recording is handed over however the popover closes; a
  starting one and one that ended by itself are dropped (only **Retry** sends the latter, after
  principle 2).
- **Rec notes are global:** one list for every site, above the pages, newest first. Neither
  Copy as prompt nor Copy again takes them; each has its own **Copy** and **Delete**, and the
  footer's buttons, the filter and **Pins** do not act on them. Delete is for good at once:
  the undo history is per site, notes belong to none.
- **The limit:** 5 minutes by default, in Settings (1, 2, 3, 5, 10 or 15 minutes). At the
  limit the recording pauses and asks; **Keep** records on until another full limit,
  **Stop** hands it over; without an answer within 60 s it stops and is transcribed.
- **Parts of at most 5 minutes:** live checks sent a 15-minute English and a 10-minute German
  recording whole; the default model answered with 2048 tokens each and cut the end without
  a word (18 % and 14 % lost). The same German audio in two 5-minute parts came back whole
  (1314 and 1335 tokens). So the recorder sends parts: a part ends at a limit, or is cut in
  the first pause after 4 minutes (the microphone's level, from an analyser in the offscreen
  document), at 5 minutes at the latest; the next part starts before the last one ends. Each
  part is transcribed on its own and the texts are joined.
- **`Space` dictates** in an empty comment (only white space counts as empty) when a key is
  saved and the pin is not being transcribed, and stops while the field is still empty; with
  text in the field, a modifier, IME composition or a repeated key it types a space. Every
  stop saves the pin and closes the popover; `Enter` during a recording stops it and saves.

**Decisions** (technical):

- **The overlay owns the dictation:** one `voice` port per overlay instead of one per
  popover, so a popover can close while its recording goes on to the background. The popover
  is a view of it: the state comes in as props, commands go out as events, and the overlay
  reads the popover's text (`snapshot()`) when it stores the pin. A stop stores the pin
  first, then posts `stop { keep: { pin } }`, then closes; a message posted on a port arrives
  before its disconnect.
- **Jobs outlive ports.** The recorder records one dictation at a time and turns each stopped
  one into a job with an id, transcribed while the next records. The background keeps a
  register of jobs (job → pin or note) and puts each result into storage, not on a port:
  the text into its pin (`fill`, one undo step) or note, the state beside it. A client only
  learns that its recording was `handed`; each recording ends in exactly one of `handed`,
  `idle` or `failed`. No client names a key, a model or a limit.
- **One document**, kept while a recording runs or a job transcribes or holds audio; a new
  recording does not replace it. Its heartbeat keeps the service worker alive meanwhile; held
  audio bounds that, since it goes after 10 minutes (beyond 20 MB, the oldest first).
- **Job states in `storage.local`:** `dictation:<site>` by pin id (transcribing, failed,
  cut), no text and no key, written by the background only. The overlay reads it to show a
  pin being transcribed: content scripts can read `storage.local`, and `storage.session` is
  not opened to them for this. A note's job state lies in the note, so no rule spans two
  keys. When the background starts, it closes a document left from before, marks what was
  transcribing as failed (`lost`, "The transcription was interrupted.") and takes Retry from
  what failed; a recorder port that breaks marks its jobs the same way.
- **Text a pin cannot hold becomes a note:** the pin is gone (undone, the bin emptied), its
  site is over its budget, or the comment limit cut the text; then the whole transcript goes
  into a new Rec note, and a pin that is still there says so until Dismiss. No transcript is
  dropped silently.
- **A new pin's id is fixed when it is marked**, not when it is saved: a second
  `annotation:add` (a lost reply, a page back from the back/forward cache) fails with "This
  pin already exists." instead of adding a duplicate; within one popover a second store is an
  update.
- **`pagehide`** stores the open popover at once, without waiting for code origins (a new
  pin as a draft, saved while a recording runs), and hands its recording over; a page kept
  for Back closes the popover.
- **`yield`:** a start elsewhere first asks the running recording to hand itself over; one
  that does not within 1 s ends with "Another dictation started, this one ended." as before.
- **Refused only when storing fails:** `overlay:reveal` and `overlay:leave` answer
  asynchronously, once the popover is kept; the panel then shows `PIN_NOT_KEPT` ("The open
  pin could not be kept: its popover says why."), which replaces `UNSAVED_PIN`.
- **Drafts in the model:** `draft?: true` on version-2 items, the key absent on every other
  item (operations never write `draft: undefined`, since the history compares keys).
  `annotation:add` takes `draft`, and only then an empty comment; `annotation:update` takes
  `keep` for a popover closed without Save. Grey through `toneOf` (`zinc-500`) for the pin,
  the outline, the text shading and the panel's badge. Copy as prompt takes only open pins
  that are no drafts and not being transcribed, and says how many it left out; `markCopied`
  skips drafts. Undo labels: "Add draft 4", "Edit draft 4", "Save pin 4" (a draft saved),
  "Dictation into pin 4".
- **No undo of a dictation in the popover:** the text no longer goes into the field, so the
  `Ctrl+Z` of milestone 7a goes; the panel's Undo takes the step "Dictation into pin 4" back.

**Known limits:** a part cut at 5 minutes without a pause may split a word at its seam; a
model with a much shorter answer than the default one could still cut a part. A service worker restart (rare: the
heartbeat keeps it alive) loses the transcriptions under way ("The transcription was
interrupted."). An extension update while a popover is open still loses its unsaved text.
Two dictations into the same pin are prevented in the popover only (the mic and `Space` are
off while it is transcribed). A pin deleted while it is transcribed gets the text anyway and
stays deleted; once it is gone, the text goes into a note. Settings still hides Rec while it
records (milestone 8a): its question at the limit is not seen there, so Rec stops a minute
later, and its note keeps the text.

**Review focus for this milestone** (each line has a test in the owning task):

1. A port that closes right after its `stop`: the job still fills the pin or the note
   (Task 84; checked by mutation).
2. A pin undone, its bin emptied, its site full, or a text beyond the comment limit while it
   is transcribed: the whole text in a Rec note, nothing lost (Tasks 82, 84).
3. A page or another extension context sending `dictation:retry` or `dictation:dismiss` for
   another site, `note:retry` or `note:delete`, a `stop` for a pin from the panel or for a
   note from an overlay, `voice:ready` from a subframe: refused; `voice:ready` answers only a
   boolean (Task 84).
4. The background starting while jobs were transcribed or held audio: marked lost, no Retry;
   a document left from before is closed (Task 84).
5. A second `annotation:add` of the same pin (back/forward cache, a lost reply): refused by
   the writer, no duplicate (Task 82); a reload with an open pin stores it once (Task 89).
6. `Space` with a modifier, during IME composition, as a repeated key or from a page script:
   it types a space or does nothing, and never starts a recording (Task 88).
7. Pins or a note copied while Rec records or its note waits: what was copied keeps the
   clipboard, the text is offered (Task 87).
8. The limit's question unanswered: the recording stops after 60 s and is handed over, also
   for Rec (Tasks 86, 87).

### Task 82: Drafts in the model

- Files: `src/lib/collection/{model,validate,ops}.ts`, `src/lib/messages.ts`,
  `src/lib/background/writer.ts`, `src/lib/status.ts`, `src/lib/voice/transcript.ts` (moved
  from the overlay),
  `tests/unit/{collection-ops,collection-validate,background-writer,messages,status,voice-transcript}.test.ts`
- [x] Failing tests: an open item with the flag, also without a comment, and no flag key on
      other items; kept, a draft stays one and a pin keeps its status; saved, a draft without
      a comment stays one and with one becomes a pin; a pin's comment is never emptied;
      `fillTranscript` appends with the spacing rules, makes a draft a pin, reopens a done
      pin, leaves a deleted one deleted, cuts at the comment limit and gives the whole text
      back when it cut or the pin is gone; `markCopied` skips drafts; Clear all and Restore;
      the writer's `fill` as one undo step, the text given back on a full site; the labels;
      the message guards; `toneOf`. Then the change.

### Task 83: Recorder

- Files: `src/lib/voice/{protocol,recorder,openrouter}.ts`, `src/entrypoints/offscreen/main.ts`,
  `tests/unit/{voice-recorder,voice-protocol,voice-openrouter}.test.ts`
- [x] Failing tests: a stop becomes a job and the next recording starts while it is
      transcribed; the pause at the limit, a resume that pauses again a whole limit later, a
      paused recording stopped; each part between limits transcribed on its own and the texts
      joined, a silent part left out, Keep before the part ended; a part cut in the first
      pause after four minutes, or at five, with the next one started first; a stop with nothing recorded ends its job as "No speech
      detected."; a transcript cut at 20,000 code points; held audio sent again on Retry,
      gone after ten minutes and beyond 20 MB, oldest first; everything dropped when the port
      goes; the timeout for long audio; the shapes of the new commands and states. Then the
      recorder.

### Task 84: Background jobs, notes, recovery

- Files: `src/lib/background/{voice,notes,dictations}.ts`, `src/lib/notes/model.ts`,
  `src/lib/voice/jobs.ts`, `src/lib/storage.ts`, `src/lib/ids.ts` (moved from the overlay),
  `src/lib/messages.ts`, `src/entrypoints/background.ts`,
  `tests/unit/{background-voice,background-notes,background,messages,ids}.test.ts`
- [x] Failing tests: a pin's recording handed over to a job with the key and settings read
      at the stop; its text filled into the pin, also after the port went, and a handover
      that survives the port closing right after the stop (checked by mutation); what the pin
      cannot hold kept as a note, a cut pin marked; failure, Retry and Dismiss on a pin and on
      a note; the next recording in the same document; a pin's stop from the panel and a
      note's from an overlay refused; `yield` and the 1 s wait; the notes' limits and their
      ids coming back; the restart marking what was transcribed as lost and taking Retry from
      what was held; `voice:ready` telling only whether a key is saved; the senders of the
      new messages. Then the coordinator and the two writers.

### Task 85: The recording limit in Settings

- Files: `src/lib/voice/settings.ts`, `src/lib/background/voice-settings.ts`,
  `src/entrypoints/sidepanel/VoiceSettings.vue`,
  `tests/unit/{voice-settings,background-voice-settings,sidepanel-voice}.test.ts`
- [x] Failing tests: each field read on its own, a missing or malformed limit 5 minutes with
      the model and the language kept; `voice:set` requires the limit; the select offers 1
      to 15 minutes, 5 by default, saves the choice with the rest and shows a limit set
      elsewhere as its own choice. Then the setting.

### Task 86: Overlay and popover

- Files: `src/entrypoints/overlay.content/{Overlay,CommentPopover,VoiceButton,HoverBox,TextHighlight}.vue`,
  `src/entrypoints/overlay.content/text-marks.ts`, `src/composables/use-voice.ts`,
  `src/lib/background/ask-overlay.ts`, `src/entrypoints/background.ts`,
  `tests/unit/{comment-popover,use-voice,background}.test.ts`
- [x] Failing tests: Save until there is a comment or a recording; `Enter` stops a recording
      and saves; `Esc` closes, or cancels a recording first; Delete discards a new pin; the
      header of a draft; the field follows the stored comment; the clock and which key stops
      it; Keep and Stop at the limit, and the 60 s timer with fake timers; a pin being
      transcribed read-only; a failure with Retry and Dismiss; the cut notice; Retry of a
      recording that ended by itself hands it over; Go to stays on the page only when the
      overlay cannot keep the open pin. Then the overlay's port, `leave()`, `pagehide`, the
      asynchronous answers, the tone and the pulse.

### Task 87: Panel

- Files: `src/entrypoints/sidepanel/{App,ItemList,NoteList,RecButton}.vue`,
  `src/entrypoints/sidepanel/{use-dictation,use-stored}.ts`,
  `tests/unit/{sidepanel-app,sidepanel-rec}.test.ts`
- [x] Failing tests: a draft grey and counted as open, left out of Copy as prompt with the
      note, nothing to copy with drafts only; a pin being transcribed, its failure with Retry,
      Open settings and Dismiss; the jobs following the site; Rec's note at the top while it
      waits, its text copied once it is there; the clipboard rule per note, also when nobody
      answers at the limit; Keep and Stop in the footer; a handover when another recording
      starts; the notes newest first, expanded on a click, copied and deleted, and left alone
      by Copy as prompt, Copy again and Clear all. Then the list, the notes and Rec.

### Task 88: Keys

- Files: `src/entrypoints/overlay.content/keys.ts` (`spaceKey`), `src/lib/shortcuts.ts`,
  `README.md`, `tests/unit/{overlay-keys,shortcuts,readme}.test.ts`
- [x] Failing tests: `Space` starts in an empty field and stops while it stays empty, types
      a space with text, without a key or while the pin is transcribed, is swallowed while
      the microphone starts and as a repeat while it records, and leaves modifiers, IME
      composition and untrusted events alone; the Settings list and the README's table name
      `Space` and the new `Enter` and `Esc`. Then the keys.

### Task 89: End to end

- Files: `tests/e2e/{voice,drafts,rec,text-mode,element-mode,panel-layout}.e2e.test.ts`
  (`drafts` replaces `unsaved`; `text-mode` and `element-mode` expected `Esc` to discard a new
  pin), `tests/e2e/overlay-helpers.ts`
- [x] With Chrome's fake microphone and the fake OpenRouter, which can answer late: `Space`
      records, `Space` closes the popover, the entry shows "Transcribing…" and the text then
      fills the pin; `Enter` during a recording; `Esc` sends nothing; a reload during a
      recording still brings the text; a failure on the pin and Retry on its entry; HTTP
      errors on the pin; the limit at 10 s with Keep and Stop; Rec taking over a pin's
      recording; no key, the grant, the settings with the limit. Drafts: a click on another
      pin or an entry keeps the open one, `Esc` keeps an empty draft, Delete discards a new
      pin, `Enter` makes a draft a pin, Copy as prompt leaves drafts out, a reload and Go to
      keep the open pin, the panel closed and opened keeps its text. Rec: the note at the
      top, copied after the developer moved on, a copy of pins while it is transcribed, the
      note's Copy and Delete, the note filled after the panel closed, `Alt+V` and `Esc`, no
      key, no overlay needed, the panel closed before the stop. The layout: notes above the
      pages at 320 px, two lines each.

### Task 90: Docs and screenshots

- Files: the spec (sections 3–5, 7–12, 14, 15), this plan, `README.md`,
  `docs/smoke-test.md`, `AGENTS.md`, `docs/images`
- [x] The spec, the README and the smoke test describe drafts, `Space`, the background
      transcription, Rec's notes and the limit; the screenshots are retaken.

**Found while building:** the end-to-end test of Rec taking over a pin's recording showed that a
start arriving while the last recording still handed over its last chunk was dropped by the
recorder, and that the end of a handed-over recording was taken for the next one's. A start
now waits for the stop, and a handover reports no end.

**Final review (2026-10-09):** an independent review of the branch found twelve defects, none
of them about security; each is fixed, the ones that can be reached from a unit test with a
test that failed first: Save while the microphone started left a recording without a popover
(it is cancelled now); a transcript filled while the field held an edit of its own was
overwritten when the popover closed (the field gets the appended text after its edit); the
acknowledgement of a cancel ended the next recording (cancels are counted); a second
dictation into a pin cleared the first one's state (a pin with a job left keeps saying
"Transcribing…"); a note that could not be stored left the recording running and the document
open (both end, and the developer is told); a second stop while the first still stopped left
a job without an end; the key removed before a stop left an empty draft without a word (the
pin says so); a fill beyond the site's budget went to Rec silently (the pin says where it
went); a yield while the microphone started saved and closed the popover; `Esc`, Close and the
page going sent a recording that had ended by itself (now only Retry sends it); a leave while
a save was on its way stored the pin a second time; and Copy as prompt could copy pins still
transcribed before the site's states were read.
