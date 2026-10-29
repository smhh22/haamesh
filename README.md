# Hāmesh

Hāmesh (هامش) is a local-first, cross-platform ebook reader with first-class
RTL support and sync to storage you own. No accounts, no vendor backend.

Status: Phase 0 (foundations). The web shell runs; the Tauri desktop shell
requires Rust and WebKitGTK/WebView2. See `docs/design/roadmap.md`.

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
