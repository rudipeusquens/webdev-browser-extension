# webdev-browser-extension

A Chrome extension for web development: highlight elements and leave comments directly on a
page, then export everything as one structured prompt for an AI coding agent that has access to
your code.

> **Status:** early. The repository base is set up; the extension itself is not built yet.

## Idea

1. Open the page you are working on.
2. Highlight elements or add comments wherever something should change.
3. The extension bundles highlights, comments and page context into a format an AI agent can
   act on.

## Development

Requirements: Node (version in `.nvmrc`) and pnpm (via corepack).

```bash
corepack enable
pnpm install
pnpm check      # lint, format, tests, secret and privacy scans
```

Conventions for contributors and AI agents: [`AGENTS.md`](AGENTS.md).

## Privacy

This repository is public and keeps personal data out with automated checks on every commit and
pull request — see [`docs/public-repo-policy.md`](docs/public-repo-policy.md). Security issues:
[`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE)
