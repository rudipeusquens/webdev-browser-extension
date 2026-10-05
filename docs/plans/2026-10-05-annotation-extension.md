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

**Depth:** Milestone 1 is planned task by task. Milestones 2–6 are outlined with goals, files,
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
  `clipboardWrite`; optional host permissions `http://*/*`, `https://*/*`; no
  `host_permissions`.
- State in `chrome.storage.local` only, never `sync`; the background is the only writer.
- Page-derived strings are untrusted: no `v-html`, no `eval`, no remote code; caps: visible
  text 120 chars, selected text 500, context 40 each side, origin chain 5, area elements 10,
  selector depth 8.
- Shortcuts: `Alt+Shift+A` activate (the `_execute_action` command, which fires the same
  `action.onClicked` handler as the icon); `E` element, `A` area, `Esc` browse;
  `Enter` save (not during IME composition), `Shift+Enter` new line, `Alt+V` voice.
- Default speech-to-text model `openai/gpt-4o-mini-transcribe`; language `auto`; recordings
  stop at 120 s; request timeout 65 s.
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

Milestone 3 already places text and area items through their container's selector after a
reload (`pins.ts`, `placeItems`); finding the selected text itself again is new here.

**Files:** `lib/capture/origin.ts` (parsing + validation of bridge output),
`entrypoints/origin-bridge.ts` (main-world function), overlay re-anchoring
(`MutationObserver`, scroll/resize tracking, Navigation API), background remembered sites
(`chrome.permissions.request`, `registerContentScripts`, `permissions.onRemoved`), side panel
groups, Go to, settings → sites, `tests/fixtures/sites/vue-app/` (Vite dev server),
`tests/fixtures/sites/astro-attrs/`.

**Required tests:**

- Unit `origin`: Vue chain innermost 5 in outer→inner order, `__name` vs `name`,
  `data-v-inspector` line; Astro attributes on ancestor; malformed bridge output rejected.
- E2E: mark → reload → pin back at the element; mark on page A, navigate (pushState) to B,
  mark → output grouped A then B; element removed → "not found" line; remember site → reload
  without action click → overlay present; forget → absent; **pin on an element inside a scroll
  container and on a `position: sticky` header stays attached while scrolling** (Review
  Focus 5); Vue fixture → real `__file` paths in output.

**Acceptance:** a three-page session on the Vue fixture copies one correct prompt.

---

## Milestone 5: Voice input

**Goal:** Dictate comments via OpenRouter with bring-your-own key.

**Files:** `lib/voice/openrouter.ts` (`transcribe(audio: Blob, opts): Promise<string>`,
`checkKey(key): Promise<boolean>`, error mapping), `entrypoints/offscreen/` (recorder),
`entrypoints/mic-permission/`, background voice coordinator, popover mic button and states,
settings → voice, `tests/fixtures/audio/` (text-to-speech clips + expected text, generation
script), `tests/live/voice.live.test.ts`.

**Required tests:**

- Unit `openrouter`: request body shape (`input_audio.format: "webm"`,
  `provider.data_collection: "deny"`, `language` omitted for `auto`); 401/402/429/5xx/timeout →
  the spec's messages; empty text → "No speech detected"; the key never appears in thrown
  errors.
- Unit: an ESLint rule (`no-restricted-syntax`) forbids reading `openrouterKey` in
  `entrypoints/overlay.content/**`; a lint fixture proves it fires.
- E2E with Chrome's fake microphone (`--use-fake-device-for-media-stream`,
  `--use-file-for-fake-audio-capture`) against a local fake OpenRouter (test build only):
  record → stop → transcript inserted at the caret; Esc cancels without a request; failure →
  Retry without re-recording; no key → settings hint.
- Live (`pnpm test:live`, local only): fixture audio → real API → transcript contains the
  expected words; also records the model comparison for the spec.

**Acceptance:** dictating a comment works in a real Chrome; live test green locally; CI never
calls OpenRouter.

---

## Milestone 6: Hardening and release readiness

**Goal:** Independent security review, smoke checklist, user documentation.

**Files:** `docs/smoke-test.md`, `README.md` (install from source, usage, voice setup,
privacy), fixes from the review.

**Required tests:** every finding of the security review gets a regression test in the owning
module before it is fixed.

**Acceptance:** security review findings resolved; smoke checklist passes in a real Chrome;
`pnpm build && pnpm zip` produce an installable package.

**Spec follow-ups (apply in the milestone 1 PR):** spec section 12 names the live-test variable
`OPENROUTER_API_KEY_TEST`; section 8 uses `_execute_action` instead of an `activate` command;
section 14 moves the tree under `src/`; milestone 4 adds the pin visibility toggle and the
orphaned-overlay cleanup ("Reload the page").
