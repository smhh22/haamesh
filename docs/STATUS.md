# Project status

Last updated: 2026-10-30, 02:20 (overnight autonomous session — read with `AGENTS.md`).

## Where the project is

- **Phases 0–2 complete. Phase 3 (sync) functionally complete end-to-end.**
- 14 commits on `main`, newest first: sanitizer hardening (`72e47cd`), app sync
  integration (`f395623`), WebDAV provider (`84ea213`), sync engine core
  (`6c6d072`), CI e2e + release workflow (`66a13d1`), Phase 2 close (`e634d8e`),
  app icons (`f3c9fcb`), then the 7 earlier commits (PDF zoom, PDF reading,
  SQLite, annotations, Phase 1, bootstrap…). Working tree clean.
- Gates at every commit: `pnpm lint` (Biome + tsc + boundary + logical-CSS),
  109 unit tests (Vitest incl. fast-check property tests), 12 Playwright e2e
  tests, `pnpm build`, `cargo fmt --check`, `cargo check`.

## Night session summary (for review with the user)

1. **Phase 2 closed** (`e634d8e`): 4-page PDF fixture; e2e for PDF page-locator
   resume, notes JSON/Markdown export round-trip, annotation drift (highlight
   redrawn after reopen + font-size change).
2. **App icons from the brand logo** (`f3c9fcb`): logo tile auto-detected in the
   2752×1536 JPEG, cropped, rounded-corner alpha, 1024px PNG at
   `apps/reader/src-tauri/icons-src/icon-source.png`, full Tauri icon set
   generated (desktop + Windows + Linux bundles; android/ios dirs trimmed).
3. **Linux installers built locally**: deb (6.5MB), rpm (6.5MB), AppImage
   (84MB) at `apps/reader/src-tauri/target/release/bundle/`. All Tauri Linux
   deps are present on this machine.
4. **Real-book stress test** (`scripts/stress-books.mjs`): 57MB Calculus PDF —
   import 764ms, reader ready 512ms, **1,176 pages**, zero console errors;
   16MB Persian PDF (طرح کلی اندیشه اسلامی در قرآن) — import 597ms, 862 pages,
   renders beautifully in two-page spread; 5.5MB EPUB — 145ms to ready.
5. **Phase 3 sync** — see below.
6. **CI/CD** (`66a13d1`): Playwright e2e job added to `ci.yml`;
   `.github/workflows/release.yml` builds Linux + Windows installers on `v*`
   tags via tauri-action (draft GitHub release). Ready for the GitHub push.
7. **Security audit** (`72e47cd` + notes below): sanitizer hardened with
   property tests; `pnpm audit` clean; Rust command surface reviewed.

## Phase 3 sync — what exists

- **Pure core** (`packages/sync/src/`): envelope per-field LWW with
  remove-wins tombstones; index document codec (schemaVersion gate,
  forward-compat decode); merge is commutative/associative/idempotent —
  **fast-check property tests**. Engine (`engine.ts`): pull each provider's
  `Hamesh/index.json`, apply remote-wins fields locally, transfer
  content-addressed book blobs (`Hamesh/books/<sha256>/book.<ext>` + meta),
  write merged index last as the commit point. Reading state rides on the
  book record behind `reading.*` field prefixes; notes are their own records.
- **Providers**: in-memory reference + **WebDAV** (`providers/webdav.ts`,
  injectable fetch for CORS bypass later; strict-server PUT 409 → MKCOL
  parents + retry; full-URL and absolute-path PROPFIND hrefs; AUTH/NETWORK/
  NOT_FOUND normalization). Shared **conformance suite** (`conformance.ts`)
  gates both. Local-folder + S3/SFTP providers are next.
- **App integration**: storage v2 adds `sync_clocks` (per-record HLC +
  `:deleted` tombstones, migration handles v1 DBs). Adapter
  `apps/reader/src/services/syncStore.ts` implements the SyncStore port
  (unit-tested). Local writes stamp clocks in `libraryPersistence.ts`.
  Settings UI `apps/reader/src/components/SyncSettings.tsx` (WebDAV url/user/
  password, Test connection, Sync now; en+fa). Orchestration in
  `services/syncService.ts`. Device id persisted per install (`device-id`).
- **Night decisions to review**:
  - Per-RECORD LWW v1 (record-level clock stamps) instead of per-field:
    simpler migration; per-field can come later without wire-format change
    (envelopes are already per-field, stamps are just equal per record).
  - WebDAV as first real provider (universal, self-hostable, sanction-safe).
  - Sync credentials in **localStorage** for now — MUST move to the OS
    keychain (KeychainPort) before shipping; flagged in the UI comment.
  - Tombstoned books keep blobs remotely (no remote deletion in v1).
  - No automatic/periodic sync yet: manual "Sync now" only (ADR-0006 says
    convergence on open/close/manual — wire open/close triggers next).
  - Watchdog cron ran 00:45–04:30 to restart this session if it stalled.

## Security audit results

- `pnpm audit --prod`: **no known vulnerabilities** (must use
  `--registry=https://registry.npmjs.org` on this machine — the default mirror
  lacks the audit endpoint). `cargo audit` install was still running at
  02:15; run `~/.cargo/bin/cargo audit` in `apps/reader/src-tauri` and fix.
- Tauri capabilities: only `core:default`, no plugins — least privilege ✓.
- Rust commands: `resolve_data_path` rejects absolute/traversal components ✓;
  external file reads gated to `.epub`/`.pdf` ✓. Remaining hardening (low
  risk, note for later): symlink escape through a planted link inside the
  data dir; write the follow-up when hardening again.
- `tauri.conf.json` still has `"csp": null`. Proposed follow-up (needs a
  desktop run to verify, not attempted blind):
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self'
  ipc: http://ipc.localhost; frame-src blob:; media-src blob:`.
- EPUB sanitizer now strips to a fixed point (defeats `<scr<script>ipt>`),
  removes iframe/object/embed/base/form + meta refresh, checks URL attributes
  after entity decoding, and gives headless docs a synthetic `<head>` so the
  injected CSP is actually honored. Replace with a DOM sanitizer before
  user-authored HTML features.

## What works right now

- Everything from the previous handoff (EPUB+PDF import/reading, SQLite on
  both platforms, annotations, search, export, resume, zoom, open-with) plus:
  multi-page PDF resume, notes export round-trip, WebDAV sync with manual
  trigger, installer builds, brand icons, real-book stress verified.
- Reader internals worth knowing: overlay SVGs live in foliate's **closed
  shadow root** (unqueryable) — `data-annotations-drawn` counter on
  `.reader-stage` is the test hook. Upstream foliate ResizeObserver fires
  after teardown with null contentDocument — patched at build time by
  `foliateUpstreamGuards` in `apps/reader/vite.config.ts` (two exact-string
  guards; do not edit the submodule).

## Remaining work (suggested order)

1. Connect GitHub (user) → CI goes green; push a `v0.0.1` tag to smoke the
   release workflow.
2. Sync: auto-sync on app open/close; local-folder provider (Syncthing
   story); move credentials to OS keychain; real WebDAV server test (user
   said they may provide one).
3. ReaderView.tsx refactor (still ~1000 lines; extract panels).
4. Library content FTS; PDF annotation support (deliberately deferred);
   RTL page-progression detection for Persian PDFs.
5. Windows smoke test on real hardware (friend with Windows).
6. Phase 5: Android, stats events, messaging backup channel.

## User actions still pending

- Create the GitHub repo and push (CI + release workflows are ready).
- Optionally provide a WebDAV server to test against (Nextcloud/Alist/...).
- Real 2MB+ Persian EPUB spot-check on the desktop build (web e2e covers the
  synthetic ones).
- Review "Night decisions" above and the ADR list.
