# Architecture (accepted 2026-10-29)

Status: accepted. Decisions are recorded in `docs/adr/0001`–`0009`. This
document describes the target architecture for Hāmesh, a local-first,
cross-platform ebook reader with first-class RTL and user-owned sync. License:
MIT.

## 1. Goals and non-goals

Goals:

- Read EPUB (and later PDF/MOBI/AZW3/FB2/CBZ) comfortably on desktop and web.
- Persian/Arabic/Hebrew reading and UI that feel native, not patched.
- Library, annotations, and reading progress that survive device loss.
- Sync through storage the user already owns. No account, no vendor backend.
- A codebase that stays understandable as it grows: strict layers, small
  interfaces, tests around the risky parts.

Non-goals for v1:

- Store, subscription, or any hosted service.
- Social features, recommendations, or telemetry.
- DRM removal. We read DRM-free files only.
- Feature parity with Readest. We ship fewer features, done properly.
- Mobile apps before desktop and web are solid (see roadmap).

## 2. Stack (accepted)

Rationale and rejected alternatives are in ADR-0001.

| Concern       | Choice                                                                                                  | Rationale                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell         | Tauri v2                                                                                                | Small binaries, Rust for files/DB/parsing, good webview reuse. Electron is heavier; a pure PWA cannot reliably touch the filesystem.                 |
| UI            | React 19 + TypeScript (strict) + Vite                                                                   | No SSR or server routes needed. Vite keeps the desktop and web builds identical and fast. Next.js would add routing/build complexity for no benefit. |
| State         | Zustand + service layer                                                                                 | Small, explicit, testable outside React. Avoid a store per feature.                                                                                  |
| Styling       | Tailwind v4 + CSS custom properties + Radix primitives                                                  | Logical utilities (`ms-*`, `ps-*`, `start-*`) and Radix `DirectionProvider` make RTL structural.                                                     |
| Lint/format   | Biome + `tsc --noEmit`                                                                                  | One fast tool; fewer configs than ESLint+Prettier.                                                                                                   |
| Unit tests    | Vitest + fast-check                                                                                     | Property tests for clocks and merge logic are mandatory.                                                                                             |
| E2E           | Playwright (web build)                                                                                  | Direction-aware UI tests and visual snapshots.                                                                                                       |
| Local DB      | SQLite everywhere: `rusqlite` behind Tauri commands on desktop, `@sqlite.org/sqlite-wasm` + OPFS on web | One schema, one query dialect, FTS5 available. Avoids two divergent persistence implementations.                                                     |
| Book blobs    | Content-addressed files (`books/<sha256>/...`) in app data dir (desktop) or OPFS (web)                  | Streaming, no JS heap blowup, dedupe by content.                                                                                                     |
| Reader engine | Upstream `foliate-js` (MIT), pinned commit, wrapped by `packages/engine`                                | Proven EPUB/PDF/CBZ/MOBI parsing and pagination. Fork only if an adapter-level patch is impossible.                                                  |

Risks in the stack:

- Linux uses WebKitGTK, which differs from WebView2/WKWebView in layout,
  IndexedDB, and PDF behavior. Test on WebKitGTK from Phase 1, not at the end.
- SQLite-WASM adds a worker and WASM payload to the web build. Acceptable; it
  buys one persistence model.
- `foliate-js` is explicitly unstable upstream. Pin the commit, keep patches in
  `packages/engine`, and run its tests in our CI.

## 3. Layers and dependency rules

```
apps/reader ──────────────► ui, engine, storage, sync, platform, core
apps/reader/src-tauri ────► OS APIs (fs, sqlite, keychain, parsers)
packages/ui ──────────────► core
packages/engine ──────────► core
packages/storage ─────────► core, platform (ports only)
packages/sync ────────────► core, storage (interfaces only)
packages/platform ────────► core
packages/core ────────────► nothing (pure TypeScript)
```

Rules:

- `core`: domain types, locators, progress math, clocks, merge. No DOM, no
  React, no IO, no timers. 100% unit-testable.
- `platform`: ports for filesystem, keychain, dialogs, paths, logs, and device
  info. Tauri and web each provide one adapter; no business logic.
- `engine`: foliate-js adapter, pagination state machine, selection and
  highlight geometry, direction resolution. DOM allowed, React and app state
  not.
- `storage`: repositories and migrations; exposes interfaces consumed by
  `sync`; no React and no UI assumptions.
- `sync`: provider contract, wire format, merge orchestration, conflict
  reporting, optional encryption. Depends on `core` and storage interfaces, not
  on engine or UI.
- `ui`: presentational components and tokens. No direct DB, sync, or file
  access; data arrives through props or hooks.
- `test-fixtures`: sample books, fake OS, fake clock, in-memory provider. Dev
  only; never imported by production code.
- `apps/reader`: composition root. Wires stores, services, platform adapters,
  and routes. This is the only place allowed to know about everything.

Two cross-cutting rules: libraries return typed error codes, and only `app`/`ui`
maps codes to user-facing strings; wire types live only in `sync` and are mapped
explicitly to `core` types.

A dependency-cruiser (or ESLint `no-restricted-imports`) check runs in CI to
enforce the arrows.

## 4. Repository layout

```
apps/reader/
  src/
    app/            routes/screens (library, reader, settings)
    components/     app-specific composition of ui primitives
    hooks/
    stores/         library, reader, settings, sync
    services/       platform bridge, import pipeline, sync orchestration
    locales/en|fa/
  src-tauri/
    src/            commands: fs, sqlite, keychain, epub/mobi/cbz parsers
packages/
  core/             types, locators, hlc, merge, validation
  platform/         ports: fs, keychain, dialogs, paths, logs, device
  engine/           foliate-js adapter, direction, highlights
  storage/          sqlite schema, repositories, blob store
  sync/             provider contract, wire, engine, providers/*
  ui/               tokens, primitives, icons, direction provider
  test-fixtures/    sample books, fake OS/clock, in-memory provider
docs/
  research/ design/ adr/
```

## 5. Domain model

- `Book`: content hash, format, title, authors, language, publisher, series,
  identifiers, cover ref, file ref, added-at, last-opened-at.
- `BookConfig`: locator, progress fraction, last-read-at, bookmarks, notes,
  reading stats, `updatedAt` clocks per field.
- `BookNote`: id, type (highlight/bookmark/note), locator range, color,
  selected text, note text, created/updated/deleted clocks.
- `Locator`: EPUB CFI for reflowable EPUB; `{page}` for fixed layout/PDF;
  `{offset}` for plain text. Serialized as a stable string plus a fraction
  fallback for cross-format robustness.
- `Device`: id (UUID), name, last-seen. Local only; never a user account.

Identity:

- Book identity is SHA-256 of the file bytes. Re-importing the same file is a
  no-op; a revised file is a new book.
- Notes and configs have UUIDs generated on the writing device.

## 6. Local persistence

Persistence is SQLite now: rusqlite in the desktop app data directory, and
sql.js with OPFS on web. The Phase 1 `library.json` manifest is imported once
(`json_migrated` marker) and retained as a debounced backup; books and covers
remain content-addressed blobs through `DataStorePort`. The schema below is the
target shape; the shipped tables are `books`, `reading`, `notes`, and `meta`.

Schema (SQLite, migrated in order, never edited after release):

```
books(id, hash UNIQUE, format, title, authors_json, language, cover_path,
      file_path, size, added_at, updated_at)
book_configs(book_id PK, fields_json, hlc_json, deleted_at, updated_at)
book_notes(id PK, book_id, type, locator, color, text, note, created_at,
           updated_at, deleted_at, hlc_json)
devices(id PK, name, last_seen_at)
sync_state(provider_id PK, device_id, last_sync_at, cursor_json)
sync_report(id PK, provider_id, started_at, finished_at, summary_json)
settings(key PK, value_json)
```

- `fields_json` holds only synced reading state. Device preferences live in
  `settings` and never enter sync.
- Blob store layout: `<appData>/books/<hash>/<hash>.<ext>` plus
  `<appData>/covers/<hash>.webp`.
- Writes are transactional. Deleting a book removes the managed copy only; a
  user-opened external file is never deleted.
- Web: the same schema in SQLite-WASM, blobs in OPFS under `/books/<hash>/`.
  A repository interface hides the async/worker boundary.

## 7. Sync design (the differentiator)

### 7.1 Provider contract

```ts
interface StorageProvider {
  readonly id: string;
  readonly capabilities: {
    etag: boolean;
    atomicRename: boolean;
    streaming: boolean;
    mkdirs: boolean;
    rangeRequests: boolean;
  };
  readText(path: string): Promise<string | null>;
  readBinary(path: string): Promise<ArrayBuffer | null>;
  head(path: string): Promise<{ size?: number; etag?: string } | null>;
  list(path: string): Promise<Entry[]>;
  writeText(path: string, body: string): Promise<void>;
  writeBinary(path: string, body: ArrayBuffer): Promise<void>;
  ensureDir(paths: string[]): Promise<void>;
  deleteDir(path: string): Promise<void>;
  uploadStream?(path: string, localPath: string): Promise<boolean>;
  downloadStream?(path: string, localPath: string): Promise<boolean>;
}
```

Errors normalize to `AUTH_FAILED | NOT_FOUND | NETWORK | CONFLICT | UNKNOWN`
with an optional HTTP status. Every provider passes the same conformance suite
(in-memory mock + live optional integration).

Provider priority (proposal):

1. Local folder (desktop): works with Syncthing, Dropbox/Nextcloud clients, USB
   drives. No network code, no OAuth.
2. WebDAV: Nextcloud, ownCloud, Alist, most self-hosted setups.
3. S3-compatible: MinIO, Arvan, Liara, Cloudflare R2, Backblaze B2.
4. SFTP (desktop only).
5. Google Drive / OneDrive (OAuth, keychain tokens) — only if users ask.
6. KOSync interop (progress only) — later, optional.

### 7.2 Remote layout

```
<root>/Hamesh/
  index.json                  # commit point; plaintext in v1
  books/<sha256>/book.<ext>
  books/<sha256>/meta.json    # per-book config + notes; plaintext in v1
  devices/<deviceId>.json     # optional presence/diagnostics
```

Deliberate differences from Readest:

- No human-readable title inside remote paths. Titles leak reading habits and
  break on case-insensitive or Unicode-hostile servers. Titles live inside the
  (optionally encrypted) metadata. Local UI can still show friendly names.
- `index.json` is a commit point, written last.

Frozen contract: directory names, file names, and the envelope shape. Add
fields, never rename them. `schemaVersion` increments only for breaking changes,
with a documented migration.

### 7.3 Clocks and merge

- HLC string: `<physicalMs hex 13>-<counter hex 8>-<deviceId>`. Lexicographic
  order equals temporal order. Persisted locally; on pull, the local clock
  absorbs the maximum observed remote HLC.
- Per-field LWW: each field stores `{v, t, s}`. Merge keeps the greater HLC;
  ties break by device id lexicographically, so all devices converge.
- Remove-wins tombstones: a delete carries an HLC; later field writes do not
  revive it. Intentional revival uses a new entity id.
- Merge must be commutative, associative, and idempotent. Property tests run
  over random operation sequences and N simulated devices.
- `meta.json` is rewritten with unknown top-level keys preserved so older
  clients do not destroy data written by newer ones.

### 7.4 Sync algorithm

1. Read local index and remote `index.json`.
2. Merge the index by HLC (books, tombstones, metadata clocks).
3. For each book present on both sides: read remote `meta.json`, merge
   config/notes per field, apply if remote won, then write the merged result
   back when local had newer fields.
4. Download missing book blobs only when opened, or eagerly per user setting.
   Verify SHA-256 after download; a mismatch is a hard error, not a silent
   overwrite.
5. Upload local-only books (stream), then their `meta.json`.
6. Write `index.json` last as the commit point.
7. Persist a sync report: per book, what changed, who won, what failed.

Crash safety: book blobs are content-addressed, so a partial upload is never
mistaken for valid data; hashes are verified on read. `meta.json` writes use
temp + rename where the backend supports it, otherwise read-merge-write with
ETag/If-Match where available.

Deletion: a device deleting a book writes a tombstone to the index. Other
devices remove the managed local copy only if the tombstone is newer than their
last local edit. Tombstones are retained; compaction is a later, explicit
operation.

### 7.5 Encryption

v1 ships plaintext. The wire envelope reserves a version and an `enc` marker, so
passphrase encryption can be enabled later without changing the layout.

When it ships:

- Argon2id (WASM or Rust) derives a key; AES-256-GCM encrypts `index.json` and
  each `meta.json`. Blobs stay unencrypted initially (large files, streamed);
  document that limitation clearly.
- The passphrase never leaves the device and is not recoverable. Losing it
  loses metadata, not the books.
- Threat model: the storage provider sees file sizes, timestamps, and book
  hashes. It does not see titles, authors, progress, or notes.

## 8. RTL and bidi strategy

### 8.1 UI

- One source of truth: active locale → `dir` on `<html>` → Radix
  `DirectionProvider`. Components read direction from context, never from CSS
  hacks.
- CSS uses logical properties exclusively. A CI check rejects
  `margin-left|margin-right|padding-left|padding-right|left:|right:|text-align:
  left|right` in styles and classnames, with a small, commented allowlist for
  genuinely physical effects (e.g., a shadow direction).
- Icons that imply direction (arrows, chevrons, back/forward) mirror via a
  `DirectionalIcon` wrapper. Non-directional icons never mirror.
- Progress bars, sliders, steppers, tabs, carousels, and drag-and-drop read
  direction from context.
- Dynamic values in mixed-direction text are wrapped in `<bdi>`; user-generated
  titles and notes use `dir="auto"`.

### 8.2 Book content

- Direction resolution order: OPF `page-progression-direction` → book
  `dc:language` → per-document `dir` → text heuristic. Pagination uses the
  book-level result; mixed-language paragraphs still render correctly because
  each document gets its own `dir`.
- Inject a stylesheet into every iframe document with logical properties and
  script-appropriate typography.
- Navigation is direction-aware: "next" is the visual left in RTL; arrow keys,
  swipe gestures, and click zones flip; the progress bar fills from the start
  edge; the TOC indentation uses `padding-inline-start`.
- Selection handles, footnote popups, and highlight overlays anchor to
  direction-independent geometry (`Range.getClientRects()`) and mirror only
  their chrome.
- Typography for Arabic-script languages: Vazirmatn (OFL-1.1), bundled, for
  both UI and book text. No second bundled font; XB Niloofar can be added later
  only through user font import with a verified license. No letter-spacing;
  line-height 1.8–2.0; no hyphenation; book body text justified by default in
  both directions with a toggle; preserve ZWNJ and ZWJ; do not strip diacritics
  on import.
- `dir="auto"` is not applied to book paragraphs. It is reserved for user
  notes, titles, and other user-generated text.
- Numbers: UI uses `Intl.NumberFormat` with the active locale; book text is
  never transformed.

Testing: a Persian EPUB fixture, an Arabic fixture, and a mixed bidi fixture;
Playwright snapshots in both directions; unit tests for direction resolution
and key mapping.

## 9. i18n

- i18next/react-i18next; ICU plurals; typed keys generated at build time.
- `en` and `fa` are authored together from day one. Persian is not a
  post-launch translation.
- No concatenated sentences; placeholders for values; `<Trans>` for embedded
  components.
- A dev-only pseudo-RTL locale can catch physical CSS during review.

## 10. Security and privacy

- Tauri capabilities are minimal and explicit. The shell plugin is not enabled.
- WebDAV/S3 credentials live in the OS keychain on desktop; on web they are
  session-only or encrypted with the user's passphrase. Never in `localStorage`
  or SQLite plaintext.
- Book HTML is untrusted: scripts, event-handler attributes, and `javascript:`
  URLs are stripped, a restrictive CSP is injected into each document, network
  access from book content is blocked, and external links are suppressed by
  default. The reader iframe must allow scripts for foliate-js event handling on
  WebKit, so the sanitizer is the security control; replace the regex stopgap
  with a DOM sanitizer before annotations ship. No `dangerouslySetInnerHTML`
  outside the sanitizer.
- Strict CSP for the app shell; no remote script, no eval.
- Sync providers are scoped to the `/Hamesh` subtree and validate paths
  against traversal.
- No telemetry. Logs are local and exportable by the user.
- Web build caveat: WebDAV/S3 require CORS on the user's server. Desktop has no
  such constraint. This is one reason desktop ships first.

## 11. Testing strategy

- `core`: unit + property tests (merge, HLC, locators, progress).
- `sync`: provider conformance suite, randomized multi-device simulations,
  fault injection (network loss, partial writes, 401/409/412, stale ETags).
- `storage`: migration tests from every released schema version.
- `engine`: direction resolution, pagination invariants, selection geometry
  with jsdom/Playwright.
- `ui`: component tests with Testing Library; both directions for anything
  layout-sensitive; axe accessibility checks.
- E2E (web): import → read → annotate → restart → sync between two local
  providers.
- Desktop: a small Tauri smoke suite later; manual platform matrix until then.

## 12. Performance budgets (initial)

- Cold start to library < 2s on a mid-range laptop; reader open < 1.5s for a
  2 MB EPUB after first parse.
- Page turn < 50 ms input-to-paint in paginated mode.
- 1,000-book library scrolls at 60 fps with virtualized covers.
- No book blob larger than 8 MB is ever fully held in the JS heap.

## 13. Risks

| Risk                                      | Mitigation                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| WebKitGTK quirks on Linux                 | Test early on Linux; keep engine version pinned; avoid unsupported CSS.                              |
| foliate-js instability                    | Pin commit; wrap in adapter; run upstream tests; keep patches small and documented.                  |
| Sync data loss                            | Property tests, fault injection, content hashes, local snapshots before applying remote, tombstones. |
| CORS on web builds                        | Document provider requirements; desktop-first release.                                               |
| RTL regressions                           | Logical-property lint, RTL fixtures, visual tests, Persian-first review.                             |
| Scope creep toward Readest parity         | Roadmap gates; each phase has explicit exit criteria.                                                |
| AGPL contamination from reference reading | No copy/paste from Readest; re-implement from behavior and public specs; record sources.             |

## 14. Decisions and remaining choices

Accepted and recorded in `docs/adr/`:

- License: MIT; Readest reference only (ADR-0003).
- Platforms: Linux + Windows v1; Android later, SAF-compatible (ADR-0004).
- Formats: EPUB v1, PDF next (ADR-0004).
- Layers: seven packages with enforced dependencies (ADR-0002).
- Data model: hash identity, per-field LWW, per-note tombstones (ADR-0005).
- Sync: N-capable engine, one provider in v1, mirroring later; hash-only paths;
  plaintext v1 with an encryption-ready wrapper (ADR-0006).
- RTL: document base direction, preserve paragraph direction, justified default
  (ADR-0007).
- Events: state-based now, local reading events later (ADR-0009).
- Messaging: deferred as a one-way backup channel, never a provider (ADR-0009).

Still open, to be decided at the phase noted in `docs/design/roadmap.md`:
eager vs. on-demand book download, KOSync priority, OPDS timing, and mobile
timing after the Android decision.
