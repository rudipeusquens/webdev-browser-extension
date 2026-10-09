# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor) and humans working in this
repository. Read it at the start of every session.

## Project

A Chrome extension (desktop) for web development work. On any page you can highlight elements
or add comments; the extension bundles everything into a format you can hand to an AI agent
that has access to the code.

**Status:** milestones 1–7 of `docs/plans/2026-10-05-annotation-extension.md` are done
(scaffold, test harness, spikes; element marking end to end; text and area marking; across
pages, re-anchoring, remembered sites, code origin; voice input; review workflow: one
collection per site, statuses, Copy again, filter, undo and redo; review polish: pins as the
name, copy one pin, Clear all into Deleted and Empty bin, the site pill, starting the overlay
from the panel, Settings options; everyday fixes: unsaved text kept, a hidden target's
popover, the Pin chip with its selection, undo of a dictation; security review: the host as a
div, a stricter comment guard, delimited prompt strings, no invisible characters, clicks only
on an unobscured overlay, no page-visible start signal, panel-only senders, storage budgets,
OpenRouter-only connections, a denylist job that installs nothing, a pre-push check, a bundle
check, the MCP server through pnpm; release readiness: the package from `pnpm zip` checked
against the build, the README, the manual smoke test), milestone 8a: **Rec**, dictation in
the panel without a pin, its text copied as it is, and milestone 8b: dictation transcribed in
the background, `Space` to dictate, every pin kept (grey drafts), Rec notes in the panel, a
recording limit that asks. Next: the owner's smoke test before the first release; later
candidates are in the plan's known limits and deferred items. The spec is
`docs/specs/2026-10-05-annotation-extension.md` — read both before working on a feature.

## This repository is public

Hard rules. The full policy, including what goes where, is `docs/public-repo-policy.md`.

- **No personal data, ever:** no real names beyond the GitHub handle, no email addresses other
  than GitHub noreply and `example.com`, no client or project names, no URLs of real sites, no
  server names, no screenshots, captures or exported prompts from real pages.
- **Fixtures and examples are synthetic:** `example.com`, placeholder names, hand-written HTML.
- **Specs and plans are public product docs.** Describe the extension, not the owner's clients
  or work. Personal context goes to `.private/` (gitignored, local only).
- **Commit messages and PR descriptions are public too** — same rules.
- **Never bypass or weaken a guard:** no `--no-verify`, no disabling hooks or CI steps, no
  `privacy-check: allow` on real data. If a check is wrong, fix the check in its own PR.

## Stack

- **Extension:** WXT (Vite-based, Manifest V3), sources under `src/`, Chrome ≥ 116.
  WXT auto-imports are off (`imports: false`): import `browser` from `wxt/browser` and helpers
  from `wxt/utils/…` explicitly
- **UI:** Vue 3 + TypeScript, Tailwind v4, shadcn-vue
- **Tests:** Vitest (unit, `tests/unit/`, happy-dom + WXT fake browser), Puppeteer with Chrome
  for Testing (E2E, `tests/e2e/`), `node --test` for `scripts/`
- **Package manager:** pnpm (pinned via `packageManager`), Node from `.nvmrc`
- **Linting:** ESLint flat config (`@eslint/js` + `typescript-eslint`) + Prettier, with
  `eslint-config-prettier` so they don't fight
- **TypeScript** pinned to `~6.0`: typescript-eslint 8 does not support TypeScript 7 yet
- **Secret scanning:** secretlint (hook + CI), gitleaks (CI, full history)
- **Personal-data guard:** `scripts/privacy-check.mjs` (hooks + CI, full history)

## Commands

```bash
corepack enable          # once: pnpm in the version from package.json
pnpm install             # also runs `wxt prepare` (generates .wxt/)
pnpm dev                 # WXT dev build with reload, opens a browser if one is available
pnpm build               # production build in .output/chrome-mv3/
pnpm zip                 # production build, packed into .output/<name>-<version>-chrome.zip and
                         # checked: manifest, bundle, and the zip against the build
pnpm compile             # type-check (vue-tsc)
pnpm test:unit           # Vitest only
pnpm test:e2e            # real extension in Chrome for Testing — run `pnpm build` first
pnpm test:live           # local only: dictation against the real OpenRouter API, with
                         # OPENROUTER_API_KEY_TEST from .env — never in CI
pnpm voice:fixtures      # local only: regenerates the synthetic audio in tests/fixtures/audio
pnpm screenshots         # local only, after `pnpm build`: retakes the README's screenshots in
                         # docs/images from the made-up page in tests/fixtures/sites/demo
pnpm manifest:check      # built manifest has exactly the allowed permissions
pnpm bundle:check        # the build has no source maps, eval, dev-server code or unknown hosts
pnpm check               # everything CI runs, except build, E2E and gitleaks
```

If Chrome for Testing fails to start because system libraries are missing
(`error while loading shared libraries`), set `LD_LIBRARY_PATH` to a folder that provides them.

`package.json` is the source of truth for scripts. If `.wxt/` is missing (e.g. after a
"pnpm install" that had nothing to do), run `pnpm exec wxt prepare`.

## Quality gates

- **pre-commit:** commit identity must be a noreply address; secretlint and `privacy-check` on
  staged files; `eslint --fix` + `prettier --write` on staged files
- **commit-msg:** `privacy-check` on the message
- **pre-push:** `privacy-check --push` on everything the push sends (also commits made by a
  rebase, cherry-pick or `git am`, which run no pre-commit hook), and the ref names
- **CI** (`.github/workflows/ci.yml`, checks `ci` and `privacy`, required for merging): `ci`
  runs install → lint → format:check → compile → build → manifest:check → bundle:check → zip →
  E2E in Chrome for Testing → unit tests → secretlint over all tracked files →
  `privacy-check` over the tree and the full history → gitleaks over the full history;
  `privacy` runs the privacy check with the denylist secret in a job that installs nothing
- **MCP servers** (`.mcp.json`) start through `pnpm dlx` with an exact version, so the age gate
  and the build allowlist apply
- **Smoke test** (`docs/smoke-test.md`): manual, in a real Chrome and in Brave, run by the owner
  before a release; a pull request names the sections its change touches
- `main` changes only through pull requests; the owner approves and merges

## Conventions

- **English** for everything in the repository: code, comments, docs, commit messages
- **Docs:** specs in `docs/specs/YYYY-MM-DD-<topic>.md`, implementation plans in
  `docs/plans/YYYY-MM-DD-<topic>.md`
- **Atomic commits;** one feature = one PR
- **Dependencies:** `pnpm add`. `pnpm-workspace.yaml` refuses versions younger than three days
  and runs install scripts only for packages listed in `allowBuilds`
- **GitHub Actions** are pinned to commit SHAs with the version as a comment
- **shadcn-vue components** are copied into `src/components/ui/` with
  `pnpm dlx shadcn-vue@2.8.2 add <name> -y`, style `new-york`; never add them as a dependency,
  and revert any change the CLI makes to `src/assets/tailwind.css` (no remote font imports).
  The `shadcn` MCP (`.mcp.json`, no tokens, version pinned) can look up components; a session
  restart loads it
- **Tests for scripts** live next to them as `*.test.mjs` (`node --test`)
- **Screenshots** in the README show only the made-up demo page; after a change to the UI, retake
  them with `pnpm build && pnpm screenshots` and commit `docs/images` with the change

## Never do

- ❌ Commit anything from `.private/`, `.env*`, signing keys (`*.pem`) or packed builds (`*.crx`, `*.zip`)
- ❌ Use real pages, real URLs or real exported prompts as fixtures
- ❌ Put credentials anywhere but a local `.env` or a GitHub Actions secret
- ❌ `git commit --no-verify`, or turning off a check to get a commit through
- ❌ Print denylist terms or personal data in logs, errors or CI output
