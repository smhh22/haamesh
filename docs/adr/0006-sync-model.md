# ADR-0006: Sync model

- Status: Accepted
- Date: 2026-10-29
- Deciders: user, agent

## Context

Hāmesh must never require a server we run. Users connect storage they already
have. The sync engine must converge across devices, survive partial failures,
and never destroy reading state.

## Decision

**Transport**

A small provider contract: `readText`, `readBinary`, `head`, `list`,
`writeText`, `writeBinary`, `ensureDir`, `deleteDir`, plus optional streaming
upload/download. Errors normalize to
`AUTH_FAILED | NOT_FOUND | NETWORK | CONFLICT | UNKNOWN`. Each provider passes
one shared conformance suite.

Provider order:

1. Local folder (works with Syncthing, desktop sync clients, USB drives).
2. WebDAV (Nextcloud, ownCloud, Alist).
3. S3-compatible (MinIO, Arvan, Liara, R2, B2).
4. SFTP (desktop only).
5. Google Drive / OneDrive last, only if demanded; OAuth and availability in
   Iran make them expensive.

**Remote layout (frozen contract)**

```
<root>/Hamesh/
  index.json                  # commit point
  books/<sha256>/book.<ext>
  books/<sha256>/meta.json
  devices/<deviceId>.json     # optional diagnostics
```

Paths are hash-only: no titles in filenames. This avoids Unicode and
case-sensitivity problems, does not leak reading habits, and does not change
when encryption is enabled. `schemaVersion` is present in every document; fields
may be added, never renamed. Unknown top-level keys are preserved on rewrite.

**Clocks and merge**

- HLC string `<physicalMs hex 13>-<counter hex 8>-<deviceId>`; lexicographic
  order equals temporal order.
- Per-field LWW for metadata and config, per-note LWW with remove-wins
  tombstones. Ties break by device id, so all devices converge.
- Tombstoned rows are not revived by field writes; revival uses a new id.
- Merge must be commutative, associative, and idempotent, verified by property
  tests over N simulated devices.

**Algorithm**

1. Read local index and every enabled provider's `index.json`.
2. Merge indexes by clock.
3. Merge per-book metadata/config; apply remote wins locally; write back when
   local had newer fields.
4. Upload missing blobs (content-addressed, hash verified on download).
5. Write `index.json` last as the commit point.
6. Record a per-provider sync report.

Crash safety: content-addressed blobs make partial uploads unusable rather than
corrupting a book; `meta.json` writes use temp+rename where supported, otherwise
read-merge-write with ETag/If-Match. **Implemented:** the index commit uses a
conditional write (`If-Match`/`If-None-Match: *`) with a bounded
read-merge-retry loop (3 attempts); the etag is read before the body so a
concurrent writer forces a retry instead of being clobbered.

**Deletion**

A delete writes a tombstone. Other devices remove their managed copy only if the
tombstone is newer than their last local edit. A user's original file is never
deleted. Tombstones are retained; compaction is an explicit later operation.

**Multi-provider**

The engine accepts a list of providers from day one. Phase 3 ships one provider
at a time; Phase 4 adds mirroring UI. Providers are treated as replicas of the
same logical library, so the existing merge rules apply. Sharding a library
across providers is rejected: one outage would hide books and repair complexity
is disproportionate for ebook-sized data.

**Encryption**

v1 is plaintext. The payload wrapper carries a version and an `enc` marker so
passphrase encryption (Argon2id + AES-256-GCM) can be added without changing the
layout. Blobs are not encrypted initially; that limitation is documented when
encryption ships.

## Alternatives considered

- **Server-mediated sync:** rejected by product constraint.
- **Readable titles in remote paths:** friendlier to browse, but leaks metadata
  and breaks on some WebDAV/S3 servers.
- **Pooled/sharded storage:** combines quotas but makes availability worse and
  adds chunk maps, repair, and quota logic.
- **Encryption at launch:** stronger privacy, but adds passphrase UX, key
  recovery failure modes, and debugging cost to the riskiest phase.

## Consequences

- No real-time sync; convergence happens on open, close, a 5-minute timer
  while the app is visible, and manual sync.
- Plaintext v1 means a storage provider can read titles, progress, and notes.
- Mirroring multiplies bandwidth and storage in Phase 4.
- The conformance suite is the gate for every new provider.
