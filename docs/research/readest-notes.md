# Readest research notes

Sources inspected: `github.com/readest/readest` at commit
`578b50fa7e2064ac3da6d1b082a90541394c6a75` (app version 0.12.16, 2026-10-29),
plus the `packages/foliate-js` submodule it pins
(`0c7a0edcda672218e958fb92b4cdf090d7ca9daa`). Readest moves fast; re-verify
before relying on any detail here.

These notes record evidence, not decisions. Decisions live in
`docs/design/architecture.md` and `docs/adr/`.

Our own license decision is MIT (ADR-0003), so Readest code is reference only and
must not be copied; `foliate-js` (MIT) may be used as a dependency.

## 1. Shape of the project

- Monorepo with pnpm workspaces: `apps/readest-app` plus plugin apps
  (`readest.koplugin`, `readest-calibre-plugin`, `readest-crosspoint-plugin`).
- `apps/readest-app` uses Next.js 16.4.2, React 19.2.8, Tauri v2, Zustand
  5.0.10, Tailwind CSS 4, daisyUI 5, Biome, Vitest + Playwright/WebdriverIO.
  (Root and app `package.json`.)
- Size: about 2,710 `.ts`/`.tsx` files and roughly 544k lines under
  `apps/readest-app/src` (including tests). This is a mature product, not a
  starter template.
- Targets: macOS, Windows, Linux, Android, iOS, and web. The web build is
  Next.js via OpenNext on Cloudflare (`package.json` deploy scripts).
- License: AGPL-3.0 (`LICENSE`). Treat the source as read-only reference.

## 2. Reader engine

- `packages/foliate-js` is a fork of John Factotum's foliate-js (MIT), pinned as
  a git submodule. It provides EPUB/MOBI/KF8/FB2/CBZ parsing and the
  reflowable paginator (`paginator.js`) and fixed-layout renderer
  (`fixed-layout.js`).
- Supported formats are declared in `src/libs/document.ts:157`:
  EPUB, PDF, MOBI, AZW, AZW3, CBZ, FB2, FBZ, TXT, MD, HTML, plus
  server-streamed audiobook formats.
- Native Rust pre-parsers exist for speed: `src-tauri/src/epub_parser.rs`,
  `mobi_parser.rs`, `comic_parser.rs`, `pdf_parser.rs`, `cover_thumbnail.rs`.
  A comment in `src/libs/document.ts` states the Rust EPUB pre-parser drops
  initialization from about 1.5s to 0.3s on iOS when the prefetch cache hits.
- The reader UI is large: ~60 components and ~54 hooks under
  `src/app/reader/`, including `FoliateViewer.tsx`, `Reader.tsx`,
  `usePagination.ts`, `useFoliateEvents.ts`, `useIframeEvents.ts`,
  `useTextSelector.ts`, `annotator/`, `tts/`, `notebook/`, `sidebar/`.

## 3. State and persistence

- 29 Zustand stores in `src/store/` (`libraryStore`, `readerStore`,
  `settingsStore`, `fileSyncStore`, `themeStore`, ...). Hooks are the glue.
- Local database layer is SQLite: `src/services/database/` contains
  `webDatabaseService.ts`, `nativeDatabaseService.ts`,
  `nodeDatabaseService.ts`, `migrate.ts`, and `migrations/`. It uses
  `@readest/turso-database-wasm` and a `tauri-plugin-turso` submodule.
- Platform abstraction: `src/services/appService.ts` defines a
  `BaseAppService`; `webAppService.ts` and `nativeAppService.ts` implement it,
  with a `nodeAppService.ts` for tooling. The `AppService` contract in
  `src/types/system.ts` covers filesystem, dialogs, storage roots, and more.
  This keeps UI code platform-agnostic.

## 4. Sync: three distinct mechanisms

### 4.1 Centralized cloud (what we will not build)

- Account-based sync through Readest's own HTTP API: `src/libs/storage.ts`
  calls `/storage/upload`, `/storage/download`, `/storage/list`,
  `/storage/purge`, etc. Auth and rows are Supabase-backed (107 source files
  mention Supabase), with Stripe subscriptions.
- This is server-mediated storage: the vendor can read the library, and the
  service is account- and payment-gated. Our product deliberately excludes it.

### 4.2 Replica CRDT sync

- `src/libs/crdt.ts` and `src/libs/crdt.README.md` describe the design:
  hybrid logical clocks (HLC) packed as
  `physicalMs-counter-deviceId`, per-field last-writer-wins envelopes
  `{v, t, s}`, and remove-wins tombstones. Field writes do not revive a
  tombstoned row; revival requires an explicit reincarnation token.
- Merge must be commutative, associative, and idempotent; property tests exist
  in `src/__tests__/libs/crdt.test.ts`.
- Server-side merge is a Postgres function `crdt_merge_replica()`, so client and
  server must stay semantically aligned. That server dependency is not part of
  our design, but the client-side merge rules are a good reference.

### 4.3 File-based sync into user-owned storage (our direction)

Directory: `src/services/sync/file/`.

- `provider.ts` is the transport contract: `readText`, `readBinary`, `head`,
  `list`, `writeText`, `writeBinary`, `ensureDir`, `deleteDir`, plus optional
  streaming `uploadStream`/`downloadStream`. Errors normalize to
  `AUTH_FAILED | NOT_FOUND | NETWORK | CONFLICT | UNKNOWN`. Everything above
  the transport is provider-agnostic.
- `layout.ts` defines a frozen remote tree:
  `<root>/Readest/library.json` and
  `<root>/Readest/books/<bookHash>/<safe-title>.<ext>` with `cover.png` and
  `config.json`. Hash directories avoid title collisions and make renames
  metadata-only. The comments explicitly mark the layout as a frozen wire
  contract.
- `wire.ts` wraps `BookConfig` in an envelope with `schemaVersion`,
  `bookHash`, `writerDeviceId`, `writerVersion`, and `updatedAt`. It maintains
  an explicit trim list of which config fields travel; device-local view
  settings are deliberately excluded. The trim list is the single source of
  truth for "reading state vs. device preference". `referencePageCount` rides
  as a separate envelope key for the same reason.
- `merge.ts` merges per-field by `updatedAt`, per-note by `updatedAt` plus
  `deletedAt`, and treats an absent field as "no opinion".
- `engine.ts` orchestrates pull/merge/push, file upload skipping when hashes
  match, and remote book directory deletion. `providerRegistry.ts` memoizes one
  provider per backend kind because path-to-id caches are expensive to rebuild.
- Providers in `src/services/sync/providers/`: `webdav`, `s3`, `gdrive`,
  `onedrive`, `icloud`, plus shared `oauth`. Google Drive and OneDrive tokens
  live in the OS keychain; WebDAV credentials live in settings.
- There is a provider-conformance suite concept in comments: a new backend is
  "one of these and nothing else".
- `src/services/sync/syncCategories.ts` and the settings types show
  sub-toggles per category (progress, notes, book files, covers, TTS packs).

## 5. RTL support in Readest

RTL exists, but it reads as a retrofit:

- Locales include `fa`, `ar`, `he` (`apps/readest-app/public/locales/`).
- UI direction is a class toggle: `src/components/Providers.tsx:136` adds
  `.ui-rtl` to `documentElement`, and `src/styles/globals.css:556-584` patches
  individual components (dropdowns, settings menu, view menu) back to RTL.
  This is the pattern we want to avoid; logical properties remove the need for
  per-component overrides.
- Book direction detection is in `src/libs/document.ts:720-749`: it reads the
  document's `dir`, computed `direction`, and `page-progression-direction`.
- Direction-aware behavior exists for paragraph mode and keys in
  `src/utils/paragraphPresentation.ts` (left/right zones and arrow keys swap in
  RTL), page-turn animation in `src/utils/pagePush.ts` (an `rtl` parameter), and
  cover spread placement in `src/utils/spread.ts:138`.
- `src/utils/rtl.ts` hardcodes the RTL language set (`ar, he, fa, ur, dv, ps,
  sd, yi`) for UI direction.
- Persian-specific typography (fonts, ZWNJ-aware search, Arabic-Indic digits,
  justification) is not evident from a quick scan; this is where we can be
  materially better.

## 6. Feature set observed (for scoping, not parity)

From `README.md`: multi-format reading, scroll/paginated modes, in-book and
library search, highlights/bookmarks/notes, dictionaries (including
Yomitan/RDICT import), parallel read, OPDS/Calibre, web clipping, translation
(DeepL/Yandex), audiobooks, TTS, EPUB Media Overlays, cross-platform sync,
KOReader sync (KOSync), accessibility, reading ruler, paragraph mode, RSVP.

Satellite integrations: KOReader plugin, Calibre plugin, Crosspoint plugin,
send-to-Readest browser extension, email and IAP-reconcile workers.

## 7. What to borrow, what to avoid

Borrow (re-implement, do not copy):

1. The provider contract shape: a tiny file-operation interface with normalized
   error codes, everything else transport-agnostic.
2. A frozen, documented remote layout with content-hash book directories and
   human-readable filenames inside them.
3. An explicit wire envelope with `schemaVersion` and a single source-of-truth
   list of which fields sync.
4. HLC + per-field LWW + remove-wins tombstones, with property tests.
5. Platform service abstraction with web and native implementations behind one
   interface.
6. Rust-side pre-parsing for large EPUBs (later, as an optimization).
7. Per-category sync toggles and provider conformance tests.

Avoid:

1. Server-mediated sync, accounts, payments, or any vendor backend.
2. Next.js for a purely local-first app; it exists in Readest for landing
   pages, auth callbacks, API routes, and web hosting. A Vite SPA is simpler.
3. Retrofit RTL via class-based CSS overrides; use logical properties and
   direction-aware primitives from day one.
4. A single 2,700-file app package. Keep `core`, `engine`, `storage`, `sync`,
   and `ui` separate with enforceable dependency rules.
5. Forking critical dependencies unless a patch cannot live in our adapter
   layer. Readest forks both foliate-js and Tauri; that carries maintenance
   cost.
6. A store per feature (29 stores). Prefer a few domain stores plus services.
