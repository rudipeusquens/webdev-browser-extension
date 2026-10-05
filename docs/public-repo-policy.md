# Public repository policy

This repository is public. Everything that is committed — files, commit messages, author
identities and the entire history — can be read by anyone, and it is copied by forks, caches
and archives. Deleting a file later does not unpublish it. So the rule is simple: **personal
data never enters the repository**, not even for a single commit.

## What is public

- Source code of the extension and its build and tooling configuration
- Tests and fixtures built from **synthetic** data only: `example.com` addresses, placeholder
  names, hand-written HTML pages
- Product documentation: `README.md`, `AGENTS.md`, specs (`docs/specs/`) and implementation
  plans (`docs/plans/`). They describe the extension, not the owner's work.
- Screenshots of synthetic test pages only

## What is never public

| Category                   | Examples                                                                                                 | Where it goes instead               |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Personal data              | real name beyond the GitHub handle, private or work email addresses, phone number, postal address        | nowhere, or `.private/`             |
| Client and project context | client names, URLs of real sites (staging or production), names of other projects, server hostnames, IPs | `.private/`                         |
| Captures of real pages     | DOM snapshots, screenshots, HAR files, prompts the extension exported during real work                   | `.private/`                         |
| Credentials                | API keys, tokens, `.env` files, the extension signing key (`*.pem`), Chrome Web Store credentials        | local `.env`, GitHub Actions secret |
| Machine details            | home directories with a user name (`/Users/<name>/…`), local hostnames                                   | nowhere                             |
| Private infrastructure     | details of the owner's servers, private repositories and internal tooling                                | nowhere                             |

`.private/` is gitignored and exists only on the machine where it was created: no backup, no
history. Anything worth keeping long-term belongs in a private repository, not here.

## Commit identities

Every commit must carry a GitHub noreply address (`…@users.noreply.github.com`) as author and
committer, because commit metadata is public too. The owner's account should have, under
**GitHub → Settings → Emails**:

- ✅ Keep my email addresses private
- ✅ Block command line pushes that expose my email

The pre-commit hook refuses any other address and explains how to fix it.

## Guards

Defense in depth — each layer catches what the one before missed:

| Layer        | Checks                                                                                                                                  | When                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `.gitignore` | keeps `.private/`, `.env*`, `*.pem`, `*.crx`, `*.zip`, `*.har`, logs out of `git add`                                                   | always               |
| pre-commit   | commit identity, secretlint and `privacy-check` on staged files, ESLint + Prettier                                                      | every commit         |
| commit-msg   | `privacy-check` on the commit message                                                                                                   | every commit         |
| CI (`ci`)    | lint, format, tests, secretlint over all files, `privacy-check` over all files **and the full history**, gitleaks over the full history | every PR, every push |
| GitHub       | secret scanning with push protection (repository settings)                                                                              | every push           |
| Review       | PR checklist, approval by the owner                                                                                                     | every PR             |

Hooks are never bypassed (`git commit --no-verify`) and checks are never weakened to get a
commit through. If a check is wrong, fix the check in its own PR.

## privacy-check

`scripts/privacy-check.mjs` finds what secret scanners don't look for:

- **email** — any address except GitHub noreply addresses and reserved example domains
  (`example.com`, `.test`, …)
- **home-path** — home directories that contain a user name
- **forbidden-file** — tracked files under `.private/`, env files, keys, packed extensions, HAR
  captures (catches `git add -f`)
- **identity** — author and committer addresses of every commit
- **denylist** — the owner's own terms, see below

A false positive in a synthetic example line can carry the marker `privacy-check: allow`. It
silences the email and home-path rules for that line only; denylist hits cannot be silenced.

### The denylist

Patterns cannot know the owner's name, clients or servers. That knowledge lives in a denylist
that is itself never public:

- **Locally:** `.private/denylist.txt`
- **In CI:** the repository secret `PRIVACY_DENYLIST` (**Settings → Secrets and variables →
  Actions**), same content. GitHub does not pass secrets to PRs from forks; there the pattern
  rules still run.

Format: one term per line, matched case-insensitively as a substring, at least three
characters, `#` starts a comment. Good entries: the full name with a space, postal address,
phone number, private email domains, client names, staging hostnames. Avoid parts of the
GitHub handle — it legitimately appears in `CODEOWNERS`, `LICENSE` and commit trailers.

Findings name the file, line and entry number, never the term itself: CI logs are public.

## If something slipped through

1. **Not pushed yet:** fix the commit (`git commit --amend`, `git rebase -i`) and check again.
2. **Pushed:** treat every credential in it as compromised and rotate it immediately — bots
   scrape public pushes within minutes. Then rewrite the history (`git filter-repo`), and ask
   GitHub Support to purge cached views and pull request refs.
