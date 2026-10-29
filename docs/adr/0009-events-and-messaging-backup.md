# ADR-0009: Reading events and messaging backup

- Status: Accepted
- Date: 2026-10-29
- Deciders: user, agent

## Context

Two ideas came up during design review:

1. Syncing reading as an event stream ("user moved from page X to page Y").
2. Using messengers such as Telegram or Bale as storage, possibly behind a
   service that emulates list/overwrite/delete.

Both are technically possible and both are poor defaults for v1.

## Decision

**Events**

- Reading position, progress, bookmarks, and notes remain state-based with
  clocks. Page turns are not synced.
- A local-only `reading_events` table is planned for Phase 5 to support reading
  statistics. Only aggregates may sync, and only if cross-device stats are
  wanted.
- Event sourcing the core reading state is rejected: it adds compaction,
  snapshotting, and replay concerns without changing how "where am I" resolves.

**Messaging storage**

- Messengers are not sync providers. Bot APIs lack list, overwrite, atomic
  rename, and reliable delete semantics; they also impose per-file size and rate
  limits, and a bot token is a full-control secret.
- A **BackupChannel** may be added later as a one-way offsite copy: send the
  index and book files as documents, restore by replaying the chat. It is never
  the only copy and never participates in merge.
- A hosted relay that emulates a filesystem over a bot is rejected: it is a
  centralized service that sees user data, against the product constraint.
- Any future backup channel must verify current API limits, terms of service,
  and privacy behavior before implementation.

## Alternatives considered

- **Event-source progress:** more data, same resume result, more complexity.
- **Local bot adapter with a side index:** possible, but fragile under deletion
  windows and rate limits; more work than integrating S3.
- **Central relay:** violates the no-backend rule.

## Consequences

- Phase 3 sync stays state-based and simple.
- Reading stats arrive later without changing the sync model.
- Messaging work, if any, is isolated behind a separate interface.
