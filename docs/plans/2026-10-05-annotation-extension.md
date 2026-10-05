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
   Markdown, fences never break, nothing is interpreted. → milestone 2 formatter tests.
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
Markdown. Single page; no reload persistence of pins yet (the collection itself persists).

**Files:**

- `lib/capture/selector.ts` — `buildSelector(el: Element, root?: ParentNode): string`
- `lib/capture/snapshot.ts` — `snapshotElement(el: Element): ElementSnapshot` (opening tag,
  text, box, curated styles; form values excluded)
- `lib/capture/styles.ts` — `CURATED_STYLES` (spec section 6 order) and `pickStyles()`
- `lib/collection/model.ts` — types from spec section 5 (`Collection`, `Annotation`, …)
- `lib/collection/ops.ts` — `addAnnotation`, `updateComment`, `removeAnnotation`, `clearAll`,
  `groupByPage` (pure functions over `Collection`)
- `lib/format/markdown.ts` — `formatCollection(c: Collection): string`
- `lib/format/escape.ts` — `inlineCode()`, `quoted()`, `clean()`
- `lib/messages.ts` — typed message union + `isMessage()` guard
- `entrypoints/background.ts` — message handling, storage writes
- `entrypoints/overlay.content/` — element mode, hover chip, `↑`/`↓`, popover, pins
- `entrypoints/sidepanel/` — list, empty state, Copy as prompt, Clear all, copy-failure dialog
- `tests/fixtures/sites/plain/`, `tests/fixtures/sites/hostile/`

**Required tests:**

- Unit `selector`: unique id; generated-looking ids skipped (`:r1:`, `v-12`, `el-123456`);
  `data-testid`; hashed and CSS-module classes skipped; **identical siblings** resolved with
  `:nth-of-type` (Review Focus 3); result always matches exactly one element; depth ≤ 8.
- Unit `snapshot`: text truncated at 120 with `…`; styles only from the curated list in order;
  `input`/`textarea`/`select` → only type and name, never value.
- Unit `formatter` (golden files in `tests/unit/golden/`): the spec section 7 example
  reproduced exactly; empty fields omitted; **backticks, Markdown, HTML and line breaks in page
  text** (Review Focus 2); multi-line comments as blockquote; **gaps in numbering** after
  deletion; pages ordered by first annotation.
- Unit `ops`: numbering stable with gaps, reset by `clearAll`; update keeps number;
  grouping order.
- Unit `messages`: `isMessage()` rejects unknown types and wrong shapes.
- E2E: activate → element mode → click a fixture button → type comment → Enter → panel shows
  item → Copy as prompt → clipboard equals expected Markdown. Same flow on the hostile page:
  overlay visible above `z-index: 2147483647` content, styles intact under `all: unset`.
  **Top layer** (found in the milestone 1 review): a fixture that opens `dialog.showModal()`;
  the overlay must stay visible and usable above the modal, and an element inside the modal
  can be marked (spec section 13, spike 3 limit).

Also in this milestone: side panel tab status ("Active on …", "Can't run on this page"),
hovering a panel entry highlights its target, clicking scrolls to it; E2E: events dispatched by
the page (`isTrusted: false`) never open the popover or save an annotation.

**Acceptance:** E2E flow green in CI; manual smoke in a real Chrome on a local dev server.

---

## Milestone 3: Text and area marking

**Goal:** Browse mode with the Comment chip for text selections; Area mode with rectangle drag.

**Files:** `lib/capture/text.ts` (`snapshotSelection(sel: Selection): TextTarget | null`),
`lib/capture/area.ts` (`snapshotArea(rect): AreaTarget`), overlay modes, formatter sections
for text and area (golden files).

**Required tests:**

- Unit `text`: selected text capped at 500, context 40 on each side, container = common
  ancestor; **selection inside `input`/`textarea` returns `null`** (Review Focus 1).
- Unit `area`: container = smallest element containing the rectangle; topmost fully-contained
  elements, max 10, `moreCount` correct; empty area → container only.
- E2E: select text → chip → comment → output contains the context line; drag area over three
  cards → output lists three elements.

**Acceptance:** all three marking types appear correctly in one copied prompt.

---

## Milestone 4: Across pages, re-anchoring, remembered sites, code origin

**Goal:** Collections survive reloads, HMR and navigation; pins re-anchor; remembered origins
auto-load the overlay; Vue and Astro origins in the output.

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
