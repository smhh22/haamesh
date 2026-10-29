# Roadmap (accepted 2026-10-29)

Status: accepted. Phase order and gates were approved during design review.
Supporting decisions are in `docs/adr/0001`–`0009`.

Rules:

- Each phase ends with something a user can run.
- Do not start the next phase with an open exit criterion.
- Sync is built only after the reading state it would sync exists.
- RTL is exercised in every phase.
- No centralized service is introduced; if a feature seems to need one, it is
  out of scope.

## Environment prerequisites

- Node.js 22+ and corepack (pnpm).
- Rust and Cargo for the Tauri shell.
- Linux: WebKitGTK 4.1 development packages and a C toolchain.
- Windows: WebView2 runtime and Visual Studio C++ build tools.
- At least ~10 GB free disk for Rust targets plus node_modules.
- Current development machine: Node 22, pnpm 12, Rust 1.99, and WebKitGTK 4.1
  installed; the desktop shell builds and opens. Windows builds are not yet
  exercised.

## Phase 0 — Foundations (1–2 weeks)

Goal: a reproducible workspace where the web shell runs, the rules are
enforceable, and the desktop shell is ready to build once prerequisites exist.

Deliverables:

- MIT `LICENSE`, ADRs 0001–0009, updated `AGENTS.md`.
- pnpm workspace with `apps/reader` and `packages/{core,platform,engine,storage,ui,sync,test-fixtures}`.
- TypeScript strict, Biome, Vitest, CI (lint + typecheck + unit + web build).
- Vite + React web shell with a direction provider, i18n scaffold (`en`, `fa`),
  and an LTR/RTL proof screen.
- Logical-property CI check and package-boundary check, both with documented
  allowlists.
- Tauri shell scaffolded; the debug build opens a window on Linux.
- Font licensing resolved: Vazirmatn (OFL-1.1) is the only bundled font; XB
  Niloofar is not bundled because no authoritative license was found, with user
  font import as the supported path.

Exit criteria:

- Fresh clone → `corepack pnpm install && corepack pnpm dev` works.
- CI green on Linux: typecheck, lint, unit tests, web build.
- The proof screen flips between LTR and RTL from the same components with no
  per-component overrides.
- Boundary and logical-property checks fail on a deliberate violation.
- Desktop: `pnpm tauri:dev` opens a window (verified 2026-10-29 with Rust
  1.99 and WebKitGTK 2.52.6).

## Phase 1 — EPUB reader MVP (complete 2026-10-29)

Goal: a reader that replaces a basic EPUB reader for daily use, offline.

Status: complete on Linux and web. The 2 MB/1.5s opening budget has not been
measured on a large fixture; the current fixture opens well under one second.
Large libraries rely on `content-visibility: auto` rather than a JS virtualizer;
measure with a 1,000-book library before adding one. Windows CI compiles the
desktop shell (`cargo check`); Windows runtime smoke and installers are Phase 4.
Desktop open-with is wired through CLI arguments and `.epub` file associations.

Deliverables:

- Import via file picker, drag-and-drop, and open-with; hash identity; metadata
  and cover extraction; duplicate detection.
- Library: grid/list, sort/search, virtualization for 1,000+ books.
- Storage: Phase 1 uses a versioned JSON manifest plus content-addressed blobs
  through `DataStorePort` (OPFS on web, Tauri app-data commands on desktop;
  ADR-0010). SQLite migration follows with annotations.
- Reader: paginated and scrolled modes, TOC, progress bar, chapter navigation,
  font/size/theme controls, keyboard and touch navigation.
- Direction resolution; navigation semantics correct in RTL; Persian typography;
  justified default with toggle.
- Progress persistence and restore (CFI + fraction fallback).
- Error states: corrupt file, missing file, unsupported format.
- Windows smoke build from the first working reader increment.

Exit criteria:

- [x] A Persian EPUB reads correctly end to end: page order, keys, progress
  direction, TOC, justification.
- [x] An English EPUB reads correctly with the same build.
- [x] Progress and the library survive a full restart.
- [x] E2E: import → read → reload → resume at the same place.
- [x] Library search, sort, grid/list, and a 1,000+ book rendering strategy.
- [x] TOC, font size, theme, justification, and paginated/scrolled modes.
- [x] Desktop open-with and `.epub` file association.
- [ ] Windows runtime smoke pass (CI compiles the shell; runtime smoke and
  installers move to Phase 4).
- [ ] 2 MB EPUB opens in under 1.5s (budget defined; needs a large fixture).

## Phase 2 — Annotations, notes, search, and PDF track (in progress)

Goal: the reading state worth syncing exists, and the second format proves the
engine adapter.

Status (2026-10-29): highlights, bookmarks, notes, Markdown/JSON export, and
in-book search are implemented and covered by Playwright. Persistence migrated
to SQLite: rusqlite on desktop, sql.js with OPFS on web, with a one-time JSON
import and the manifest retained as a backup. The PDF track, a layout-drift
visual test for annotations, and library FTS remain.

Deliverables:

- [x] Migrate the Phase 1 JSON manifest to SQLite (desktop) and SQLite on web,
  with a one-way migration from schema version 1.
- [x] Highlights (colors), bookmarks, notes; per-book sidebar; direction-aware
  selection popovers.
- [ ] Annotation rendering across reflow, font size, theme, and resize; overlap
  is implemented, but add a drift regression test.
- [x] In-book search. Library FTS remains open.
- [x] Note editing, deletion, export to Markdown/JSON.
- [ ] PDF adapter behind `packages/engine`: open, page, zoom, page locator, and
  the same annotation model where practical (parallel track).

Exit criteria:

- Highlights survive font-size and window-size changes without drift.
- RTL selection and notes are correct in a Persian book.
- Export round-trips into a fresh library.
- PDF opens, pages, and restores a page-based locator.
- Locator union tests cover EPUB and PDF.

## Phase 3 — Sync core and first providers (4–6 weeks)

Goal: two devices converge through storage the user owns, with no data loss.

Deliverables:

- `packages/sync`: HLC, per-field LWW, tombstones, wire envelopes, schema
  versioning, merge orchestration.
- Provider contract, in-memory provider, conformance suite.
- Local-folder provider (desktop) and WebDAV provider.
- Remote layout `Hamesh/index.json`, `books/<sha256>/book.<ext>`, `meta.json`;
  content-addressed blobs; hash verification.
- N-provider-capable engine; UI enables one provider.
- Sync report UI, manual and automatic sync with backoff, local snapshot before
  applying remote changes.
- Deletion semantics across devices; explicit restore from tombstone.

Exit criteria:

- Three simulated devices × 200 random operations converge; merge is
  commutative, associative, idempotent.
- Fault injection: network loss mid-upload, 401, 409, 412, stale ETag, partial
  file — no corruption and no silent data loss.
- Two real devices sync a library with annotations both ways.
- Deleting a book does not resurrect it.
- Conformance suite passes for local folder and WebDAV.

This is the highest-risk phase. If it slips, cut providers, not correctness.

## Phase 4 — More providers, mirroring, and packaging (3–4 weeks)

Goal: fit more storage setups and ship installable builds.

Deliverables:

- S3-compatible provider with streaming (MinIO, Arvan, Liara, R2, B2).
- SFTP provider (desktop).
- Multi-provider mirroring UI: each provider holds a full replica, merged with
  the same rules. No sharding.
- Windows installer, signing decision, auto-update, crash-safe writes.
- Proxy settings and per-provider connectivity diagnostics.
- Google Drive / OneDrive only if demanded; last priority.

Exit criteria:

- Each provider passes the conformance suite and a manual matrix (create,
  update, delete, conflict, offline).
- Mirroring across two providers converges.
- Installers work on Linux and Windows, update, and uninstall cleanly.

## Phase 5 — Advanced reading (ongoing)

Order by feedback:

- Android (Tauri v2) with SAF-compatible storage.
- Reading statistics with a local `reading_events` table; aggregates may sync.
- Optional one-way messaging BackupChannel (never a sync provider, never the
  only copy).
- Dictionaries, translation with user-supplied keys, TTS with system voices.
- OPDS/Calibre catalogs.
- KOSync progress interop.
- Reading ruler, paragraph mode, RSVP.
- Additional formats: MOBI/AZW3, FB2, CBZ, TXT, HTML.
- macOS once signing/notarization is justified.

## Sequencing rationale

- Phase 0 makes the rules cheap to enforce.
- Phase 1 proves the engine, storage, and RTL on real books before sync
  multiplies the cost of a wrong data model.
- Phase 2 defines the synced state; sync before annotations would sync an empty
  set and hide design flaws. PDF runs in parallel because it is adapter work.
- Phase 3 isolates the riskiest work with a test budget proportional to failure.
- Phase 4 is mostly transport variety and packaging.
- Phase 5 is additive and reorderable.

## Phase 0 task order

1. Write `LICENSE` and the ADRs (done).
2. Scaffold the pnpm workspace and package skeletons.
3. Add TypeScript, Biome, Vitest, and CI.
4. Build the direction provider and LTR/RTL proof screen.
5. Add the logical-property and boundary checks.
6. Add the i18n scaffold.
7. Resolve font licensing (Vazirmatn only; XB Niloofar user-imported only).
8. Install Rust + WebKitGTK; scaffold and run the Tauri shell.
9. Add the Windows smoke workflow.
10. Tag Phase 0 complete.

## Decisions still open at their phase

| Decision                               | Decide in        |
| -------------------------------------- | ---------------- |
| Eager vs. on-demand book file download | Phase 3          |
| KOSync interop priority                | Phase 5          |
| OPDS/Calibre timing                    | Phase 5          |
| Mobile timing and scope                | Before Phase 5   |
| macOS timing                           | Phase 4 or later |
