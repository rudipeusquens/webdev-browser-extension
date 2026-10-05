# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor) and humans working in this
repository. Read it at the start of every session.

## Project

A Chrome extension (desktop) for web development work. On any page you can highlight elements
or add comments; the extension bundles everything into a format you can hand to an AI agent
that has access to the code.

**Status:** repository base only. The product spec comes next (`docs/specs/`) — until it
exists, do not start building features.

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

Not decided yet — it comes with the spec. Present so far:

- **Package manager:** pnpm (pinned via `packageManager`), Node from `.nvmrc`
- **Linting:** ESLint flat config (`@eslint/js` + `typescript-eslint`) + Prettier, with
  `eslint-config-prettier` so they don't fight
- **TypeScript** pinned to `~6.0`: typescript-eslint 8 does not support TypeScript 7 yet
- **Secret scanning:** secretlint (hook + CI), gitleaks (CI, full history)
- **Personal-data guard:** `scripts/privacy-check.mjs` (hook + CI, full history)

## Commands

```bash
corepack enable          # once: pnpm in the version from package.json
pnpm install
pnpm check               # everything CI runs, except gitleaks
```

`package.json` is the source of truth for scripts (`lint`, `lint:fix`, `format`,
`format:check`, `test`, `secrets:check`, `privacy:check`).

## Quality gates

- **pre-commit:** commit identity must be a noreply address; secretlint and `privacy-check` on
  staged files; `eslint --fix` + `prettier --write` on staged files
- **commit-msg:** `privacy-check` on the message
- **CI** (`.github/workflows/ci.yml`, check name `ci`, required for merging): install → lint →
  format:check → test → secretlint over all tracked files → `privacy-check` over the tree and
  the full history → gitleaks over the full history
- `main` changes only through pull requests; the owner approves and merges

## Conventions

- **English** for everything in the repository: code, comments, docs, commit messages
- **Docs:** specs in `docs/specs/YYYY-MM-DD-<topic>.md`, implementation plans in
  `docs/plans/YYYY-MM-DD-<topic>.md`
- **Atomic commits;** one feature = one PR
- **Dependencies:** `pnpm add`. `pnpm-workspace.yaml` refuses versions younger than three days
  and runs install scripts only for packages listed in `allowBuilds`
- **GitHub Actions** are pinned to commit SHAs with the version as a comment
- **Tests for scripts** live next to them as `*.test.mjs` (`node --test`)

## Never do

- ❌ Commit anything from `.private/`, `.env*`, signing keys (`*.pem`) or packed builds (`*.crx`, `*.zip`)
- ❌ Use real pages, real URLs or real exported prompts as fixtures
- ❌ Put credentials anywhere but a local `.env` or a GitHub Actions secret
- ❌ `git commit --no-verify`, or turning off a check to get a commit through
- ❌ Print denylist terms or personal data in logs, errors or CI output
