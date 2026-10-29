# Hāmesh

Hāmesh (هامش) is a local-first, cross-platform ebook reader with first-class
RTL support and sync to storage you own. No accounts, no vendor backend.

Status: Phase 2 is in progress. Annotations, notes, in-book search, SQLite
persistence, and PDF reading are implemented. Page-based PDF locators, zoom,
PDF annotations, and remaining polish are next.

## What works

- EPUB and PDF import with SHA-256 identity, metadata, covers, and duplicate
  detection.
- Library search, sort, grid/list views, and persisted reading progress.
- Paginated and scrolled EPUB reading, TOC, font size, themes, justification,
  and direction-aware navigation for Persian/Arabic and English books.
- PDF opening and page navigation in the fixed-layout renderer.
- Highlights, bookmarks, notes, Markdown/JSON export, and in-book search.
- EPUB sanitization and a restrictive content CSP.
- SQLite persistence on desktop and web, with a one-time JSON import.
- Desktop shell with open-with and `.epub`/`.pdf` file associations.

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

## Documentation

- `AGENTS.md` — working rules for contributors and agents
- `docs/setup.md` — environment prerequisites and the desktop build path
- `docs/design/architecture.md` — layers, stack, data model, sync, RTL
- `docs/design/roadmap.md` — phases and exit criteria
- `docs/adr/` — accepted decisions
