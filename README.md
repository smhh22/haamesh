# Hāmesh

Hāmesh (هامش) is a local-first, cross-platform ebook reader with first-class
RTL support and sync to storage you own. No accounts, no vendor backend.

<p align="center">
  <img src=".github/assets/library.png" alt="The Hāmesh library with an EPUB, a PDF, and covers" width="49%" />
  <img src=".github/assets/reader.png" alt="A Persian book in the dark reading view" width="49%" />
</p>

## What works

- EPUB, PDF, and Markdown import with SHA-256 identity, metadata, covers, and
  duplicate detection (Markdown converts to a EPUB at import).
- Library search and content search, sort, grid/list views, and persisted
  reading progress.
- User categories (one shelf per book) and tags (many per book), with
  filtering, synced as per-field LWW with the rest of a book's metadata.
- Paginated and scrolled EPUB reading with typography controls: bundled font
  families (Vazirmatn, Noto Naskh Arabic, Literata), size, line height, page
  margins, justification, hyphenation, brightness, and themes.
- Direction-aware navigation for Persian/Arabic and English books.
- PDF page navigation, zoom, saved position, and page bookmarks/notes.
- Highlights, bookmarks, notes, Markdown/JSON export, and in-book search.
- Settings dialog with system/light/dark appearance, language (English/Persian),
  updates, and keyboard shortcuts; preferences stay local.
- Sync between devices through storage you own: WebDAV (with presets),
  S3-compatible storage, Dropbox (your own scoped app), SFTP, or a local
  folder such as one Syncthing syncs — with per-field last-writer-wins and
  tombstones.
- EPUB sanitization and a restrictive content CSP.
- SQLite persistence on desktop and web, with a one-time JSON import.
- Desktop shell with open-with and `.epub`/`.pdf` file associations; Linux
  (deb/rpm/AppImage) and Windows installers plus a signed Android APK from CI.

## Versioning and stability (1.x)

Hāmesh 1.0 freezes the contracts the app syncs and stores:

- **Sync wire schema v2** is frozen for 1.x: new fields may be added, existing
  fields and merge semantics do not change, and unknown keys are preserved.
  Index documents written by 0.x (schema v1) are still read and upgraded on
  the next write. A change that breaks the wire format ships only in a major
  release.
- **Storage schema v5** migrations are additive and idempotent; the JSON
  manifest remains an import path.
- **Device settings** (typography, themes, UI) migrate forward automatically
  and never sync.
- Releases follow semantic versioning derived from squash-merge titles; a
  `feat!:` or `BREAKING CHANGE` title marks a major. Release notes are
  generated from those titles and shown in-app before updating.

A 0.x client cannot read a v2 index document, so update every device before
syncing across versions.

## Requirements

- Node.js 22+
- pnpm 12 (or corepack)
- Rust + Cargo and WebKitGTK (Linux) or WebView2 (Windows) for the desktop shell

## Commands

```bash
git submodule update --init --recursive
pnpm install
pnpm dev        # web shell
pnpm tauri:dev  # desktop shell
pnpm test
pnpm test:e2e
pnpm lint       # biome + typecheck + boundary + logical-property checks
pnpm build
pnpm tauri:build
```

## Development workflow

`main` is protected: open a branch and a pull request instead of pushing to
`main` directly. CI runs lint, unit tests, the web build, the Playwright suite,
and a Windows desktop check on every pull request.

Releases are automatic. The squash commit subject (the PR title) drives the
version: `feat:` bumps minor, `fix:`/`perf:`/`refactor:` bumps patch,
`!:` or `BREAKING CHANGE` bumps major, and `docs:`/`ci:`/`chore:` merges do
not release. A merge creates the tag and publishes the installers immediately.
