# ADR-0002: Layer boundaries and packages

- Status: Accepted
- Date: 2026-10-29
- Deciders: user, agent

## Context

Readest is a single app package with roughly 2,700 TypeScript files. It works,
but boundaries there are implicit: UI code reaches into storage, sync code
knows about engines, and platform calls are spread through services. We do not
want to reproduce that shape.

Two planned extensions pressure the design: PDF (a second rendering path) and
Android (a second storage model, SAF). Both must be addable without touching
unrelated layers.

## Decision

Seven workspace packages with one-way dependencies:

| Package         | Responsibility                                                    | Must not contain             |
| --------------- | ----------------------------------------------------------------- | ---------------------------- |
| `core`          | Domain types, locators, progress math, HLC/LWW merge, validation  | DOM, IO, React, network      |
| `platform`      | Ports for filesystem, keychain, dialogs, paths, logs, device info | Business logic               |
| `engine`        | foliate-js adapter, pagination, direction resolution, selection   | React, app state, storage    |
| `storage`       | SQLite schema, repositories, blob store, migrations               | React, UI assumptions        |
| `sync`          | Provider contract, wire format, merge, conflicts, encryption      | UI, engine, direct DB access |
| `ui`            | Tokens, primitives, direction provider, icons                     | DB, sync, file access        |
| `test-fixtures` | Sample books, fake OS, fake clock, in-memory provider (dev only)  | Production imports           |

Dependency direction:

```
core ← platform ← storage ← sync
core ← engine
core ← ui
apps/reader → all packages (composition root)
```

Additional rules:

- **Libraries return error codes, never user-facing strings.** Only `app`/`ui`
  maps codes to localized messages.
- **Wire types live only in `sync`.** They are never reused as domain types;
  mapping to `core` is explicit.
- **Cross-package imports use public entry points.** Deep imports are banned.
- **Import and search orchestration are app services**, composing `engine` and
  `storage`; they are not packages.
- CI enforces the graph and the import rules.

## Alternatives considered

- **Five packages (merge storage and sync):** fewer packages, but sync would
  depend on concrete IO and lose pure testability.
- **Fold engine into the app:** less indirection early, but PDF and engine
  replacement would touch screens.
- **Single package with folders:** fastest start, but this is how boundaries
  decay at this size.

## Consequences

- More wiring and a little ceremony in Phase 0.
- `core` and `sync` are testable without a browser or filesystem.
- PDF and Android become adapter work, not rewrites.
- Package public APIs must be maintained deliberately; breaking them is a
  versioned change even inside the monorepo.
