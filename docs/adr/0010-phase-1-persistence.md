# ADR-0010: Phase 1 persistence format and adapters

- Status: Accepted (scoped to Phase 1)
- Date: 2026-10-29
- Deciders: user, agent

## Context

Phase 1 needs the library and reading state to survive a restart. The target
storage model in ADR-0005 is SQLite on desktop and SQLite-WASM on web, but those
adapters require plugin permissions, a WASM worker, and migrations before the
data model has been exercised. Annotations and full-text search are the
features that actually need SQL; they are Phase 2 work.

## Decision

- Phase 1 persists a versioned JSON manifest, `library.json` (version 1),
  containing books and reading states.
- Book files are content-addressed blobs: `books/<sha256>.epub`.
- Covers are blobs at `covers/<sha256>`; the manifest stores their MIME type.
  Runtime object URLs are never persisted; they are recreated on load.
- All access goes through `DataStorePort` in `packages/platform`.
- Desktop: thin Tauri commands read and write under the app data directory.
  Paths are validated to reject absolute paths, parent traversal, and prefixes.
- Web development build: OPFS through `navigator.storage.getDirectory()`.
- This is a Phase 1 adapter, not the final storage model. ADR-0005 remains the
  target; a JSON-to-SQLite migration must exist before annotations ship.

## Consequences

- Persistence works on both platforms now, with one small interface.
- The manifest is rewritten on changes; acceptable at library scale, and saves
  are debounced.
- Cover MIME types are persisted because a Blob URL alone does not survive a
  restart.
- Desktop binary IPC currently sends byte arrays; replace it with streaming or
  the filesystem plugin when book files or libraries grow.
- A migration path to SQLite is required in Phase 2.

## Status note (2026-10-29)

The SQLite migration landed on the same day. Desktop uses rusqlite in the app
data directory; web uses sql.js with OPFS. The JSON manifest is imported once
(`json_migrated` marker) and retained as a debounced backup. Annotations,
reading state, and books read and write SQLite now; this JSON adapter remains
the fallback when SQLite is unavailable (for example, a browser without OPFS).
