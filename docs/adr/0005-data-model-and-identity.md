# ADR-0005: Data model and book identity

- Status: Accepted
- Date: 2026-10-29
- Deciders: user, agent

## Context

Sync correctness depends on a data model where two devices can write
concurrently without losing each other's work. The model must also survive
reflow, font changes, and the later addition of PDF.

Readest's file sync informs the shape: content-hash book directories, per-field
last-writer-wins for config, per-note LWW with timestamps, and an explicit list
of which fields are device-local.

## Decision

**Identity**

- A book's identity is the SHA-256 of its file bytes.
- Re-importing identical bytes is a no-op. A re-encoded file is a new book.
- Notes and configs use UUIDs generated on the writing device.

**Local schema**

| Table                       | Contents                                            | Merge                     |
| --------------------------- | --------------------------------------------------- | ------------------------- |
| `books`                     | Hash, format, metadata, file/cover refs, timestamps | Per-field LWW             |
| `book_configs`              | Locator, progress, reading status                   | Per-field LWW             |
| `book_notes`                | Type, locator range, color, text, note              | Per-note LWW + tombstones |
| `devices`                   | Local device id/name                                | Never synced              |
| `sync_state`, `sync_report` | Cursors, outcomes, errors                           | Never synced              |
| `settings`                  | Font, size, theme, brightness, view mode            | Never synced              |

**Rules**

- Reading state and device preferences are separate categories, defined by one
  allowlist in `core`. No other code decides what syncs.
- Config fields are stored as `{v, t, s}` envelopes (value, clock, device), so
  concurrent edits to different fields both survive.
- Notes are rows, not an array in config, so concurrent additions merge.
- Locators are a tagged union: EPUB CFI plus fraction now, page plus rect for
  PDF later, offset for text. Adding a format adds a tag, not a schema change.
- Reading time and session statistics are per-device facts and stay local.
- Book blobs live outside SQLite in a content-addressed store:
  `books/<sha256>/<sha256>.<ext>`.
- Migrations are forward-only and tested from every released version.

## Alternatives considered

- **Sync view/theme settings too:** nice continuity, but a phone setting can
  override a desktop preference and the allowlist grows.
- **ISBN or Calibre id as identity:** keeps annotations across re-encoding, but
  metadata is often missing or duplicated and adds a "same id, different bytes"
  merge case.
- **Whole-config LWW:** less code, but progress and bookmark edits on two
  devices clobber each other.

## Consequences

- Replacing a file with a differently encoded copy loses its annotations; a
  future duplicate-merge feature can address this explicitly.
- Per-field envelopes make config rows slightly larger and require a small
  merge library with property tests.
- The schema does not change when PDF arrives.
