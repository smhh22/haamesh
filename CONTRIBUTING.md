# Contributing to Hāmesh

Hāmesh is a local-first ebook reader: no accounts, no vendor servers, sync only
to storage the user owns. Contributions that respect those constraints are very
welcome.

## Before you start

- Open an issue (or comment on an existing one) before a non-trivial change, so
  the approach can be agreed before code.
- Security problems go through [SECURITY.md](SECURITY.md), never a public issue.
- By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
- Contributions are accepted under the project's MIT license.

## Set up

Requirements: Node.js 22+, pnpm 12, and — for the desktop shell — Rust plus
WebKitGTK on Linux or WebView2 on Windows. Android builds additionally need the
Android SDK/NDK.

```bash
git submodule update --init --recursive
pnpm install
pnpm dev        # web shell
pnpm tauri:dev  # desktop shell
pnpm test       # unit tests
pnpm test:e2e   # Playwright (Chromium)
pnpm lint       # Biome + typecheck + package boundaries + logical CSS
```

## Workflow

`main` is protected: changes land through pull requests only.

1. Branch from `main` (for example `fix/sync-timeout`).
2. Keep the change scoped; do not mix refactors with behavior changes.
3. Run the checks that apply before pushing:
   - `pnpm lint`, `pnpm test`, and `pnpm test:e2e` for app changes.
   - `cargo fmt --check` and `cargo check` in `apps/reader/src-tauri` for shell
     changes. `android-check` compiles the shell for Android in CI.
4. Open the PR using the template. The **PR title must follow
   [Conventional Commits]** — it becomes the squash-merge subject, the release
   note line, and the version bump:
   - `feat: …` → minor, `fix:`/`perf:`/`refactor:` → patch
   - `feat!: …` or `BREAKING CHANGE` → major
   - `docs:`, `ci:`, `chore:`, `test:` → no release
5. A maintainer reviews and merges; CI must be green.

[Conventional Commits]: https://www.conventionalcommits.org/

## Project rules that reviewers enforce

- **RTL is first-class.** Use CSS logical properties only (`margin-inline-*`,
  `padding-inline-*`, `inset-inline-*`, `border-inline-*`,
  `text-align: start|end`). Check UI changes in both LTR and RTL, in light and
  dark.
- **All user-visible strings go through i18next**, with `en` and `fa` shipped
  together. Persian copy should read naturally, not as word-for-word
  translations of English terms.
- **Layers stay one-way**: `core` has no DOM/IO/React; `engine` may touch the
  DOM but not React or app state; `sync` does not import UI/engine code; the app
  is the composition root. Wire types live only in `sync`.
- **No centralized backend.** Do not add accounts, telemetry, vendor-hosted
  sync, or a service that needs our servers to read a library. Sync means
  user-provided storage.
- **Never delete a user's original file**, and deletions sync as tombstones.
- **Licenses:** dependencies must be MIT/BSD/Apache/ISC/OFL. Readest is AGPL and
  is reference only — do not copy its code, prompts, or assets.
- **Book content is untrusted**: sanitize markup before it reaches the reader,
  and keep the restrictive CSP intact.

## Tests

New behavior needs tests. `packages/core` and `packages/sync` changes need unit
tests plus property tests for merge/locator invariants. UI changes need
Playwright coverage, including RTL where layout changes. Bug fixes should come
with a regression test when practical.

## Good first contributions

- Reproducing bugs with a minimal sample file.
- Translation of UI strings (natural phrasing, both directions).
- Documentation fixes and screenshots.
- Provider support for storage users already own.
