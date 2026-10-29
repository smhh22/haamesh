# Hāmesh

Hāmesh (هامش) is a local-first, cross-platform ebook reader with first-class
RTL support and sync to storage you own. No accounts, no vendor backend.

Status: Phase 1 is complete on Linux and web. Phase 2 (annotations, notes,
in-book search, PDF, SQLite migration) is next.

## What works

- EPUB import with SHA-256 identity, metadata, covers, and duplicate detection.
- Library search, sort, grid/list views, and persisted reading progress.
- Paginated and scrolled reading, TOC, font size, themes, justification, and
  direction-aware navigation for Persian/Arabic and English books.
- EPUB sanitization and a restrictive content CSP.
- Persistence via OPFS on web and app data on desktop.
- Desktop shell with open-with and `.epub` file association.

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
