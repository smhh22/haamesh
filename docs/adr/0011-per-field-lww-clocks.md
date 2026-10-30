# ADR-0011: Per-field LWW clocks

- Status: Accepted
- Date: 2026-10-30
- Deciders: user, agent
- Supersedes the "per-record v1" simplification recorded in ADR-0006's
  consequences note (wire format unchanged; only local clock bookkeeping and
  the merge diff change).

## Context

ADR-0006 specifies per-field last-writer-wins with remove-wins tombstones, and
the remote wire format already carries one envelope (`{v, t}`) per field. The
initial implementation stamped the whole record on every local write: all
fields of a book shared one HLC. That means editing a title locally re-stamped
the untouched `series`, `authors`, etc., so a concurrent remote edit to any of
those fields lost to the local (unchanged) value on the next pull. The user
reviewed this trade-off and chose per-field stamping now.

## Decision

1. **Storage v4**: new table
   `sync_field_clocks(record_key TEXT, field TEXT, hlc TEXT, PRIMARY KEY(record_key, field))`.
   The existing record-level `sync_clocks` stays for legacy rows, bootstrap,
   and remove-wins tombstones (`...:deleted`), which remain whole-record.
2. **Stamp only what you touch**: every persistence write stamps exactly the
   fields it writes. Reading state is stamped as `reading.locator`,
   `reading.fraction`, `reading.status` under the book key, matching its wire
   field names on the book record.
3. **Resolution order** when building the local document:
   `field clock → record clock → legacy HLC derived from updatedAt`. The
   fallback chain keeps pre-upgrade data and imported books correct without a
   data migration.
4. **Pull applies stamps per field**: only fields that actually arrive from a
   provider are re-stamped with the remote timestamp. Tombstones stamp the
   record-level `:deleted` key.
5. **Merge layer unchanged**: `diffPull`, `mergeRecordDoc`, and the property
   tests already operate per field; the wire format stays
   `fields: Record<string, {v, t}>` with no schema change.

## Alternatives considered

- **Keep per-record v1**: simpler, but loses concurrent edits to different
  fields of the same record — observable as silently reverted metadata.
- **Field-level clocks with a schema change on the wire**: rejected — the wire
  already has per-field envelopes; no format change is needed.

## Consequences

- One extra read/write per field on local edits; negligible at ebook scale.
- Local clock bookkeeping grows with fields written, not records.
- Delete/revival semantics are unchanged (remove-wins, revival by new id).
- Every app-side `SyncStore` fake must implement the per-field clock shape.
