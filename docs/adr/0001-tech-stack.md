# ADR-0001: Technology stack

- Status: Accepted
- Date: 2026-10-29
- Deciders: user, agent

## Context

Hāmesh is a local-first ebook reader for Linux and Windows, with Android later.
It must work offline, touch the filesystem, render EPUB content reliably, and
support first-class RTL. There is no server component and none is planned.

Readest, the closest reference product, uses Next.js 16 + React 19 + Tauri v2
because it also runs a web app, landing pages, auth callbacks, and API routes.
Hāmesh needs none of that.

## Decision

- **Shell:** Tauri v2 (Rust) for desktop. Android uses the same Tauri v2 shell
  later, behind a storage interface that is SAF-compatible from day one.
- **UI:** React 19 + TypeScript strict mode + Vite. No Next.js, no SSR.
- **State:** Zustand stores per domain plus a service layer.
- **Styling:** Tailwind CSS v4 with tokens, Radix primitives for accessible
  overlays and menus, CSS logical properties everywhere.
- **Quality:** Biome for lint/format, `tsc --noEmit` for types, Vitest +
  fast-check for units and property tests, Playwright for web E2E.
- **Local data:** SQLite everywhere. `rusqlite` behind Tauri commands on
  desktop; `@sqlite.org/sqlite-wasm` with OPFS in the browser. One schema and
  one query dialect.
- **Book engine:** upstream `foliate-js` (MIT), pinned to a commit, wrapped by
  `packages/engine`. Fork only if a patch cannot live in the adapter.
- **Workspace:** pnpm workspaces.

## Alternatives considered

- **Electron:** simpler native access, much larger binaries and memory use, and
  no meaningful advantage for our feature set.
- **Next.js:** adds routing, server, and build complexity for features we will
  never ship. Readest's use is driven by its hosted product.
- **Pure PWA:** no dependable filesystem access on desktop, which breaks local
  library management and local-folder sync.
- **Flutter:** strong RTL support, but the EPUB/pagination ecosystem and the
  available headless UI primitives are weaker for this product.

## Consequences

- Contributors need Rust plus WebKitGTK (Linux) or WebView2 (Windows) to build
  the desktop shell. The web build needs only Node.
- The browser build has CORS constraints for WebDAV/S3 providers; desktop does
  not. Desktop ships first.
- Pinning `foliate-js` means deliberate upgrades, not automatic ones.
- SQLite-WASM adds a worker and a WASM payload to the web build, in exchange
  for one persistence model across platforms.
