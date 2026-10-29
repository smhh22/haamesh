# ADR-0008: Product identity and naming

- Status: Accepted
- Date: 2026-10-29
- Deciders: user, agent

## Context

The product name is **Hāmesh** (هامش), chosen by the user. Identifiers must be
stable across packages, installers, the remote storage tree, and documentation.

## Decision

- Display name: **Hāmesh**, with the Persian name **هامش**.
- Package scope and code identifiers: `@hamesh/*` and `hamesh` (ASCII, no
  diacritics).
- Desktop application identifier: `app.hamesh.reader`.
- Remote storage root directory: `Hamesh/` (ASCII, no diacritics) to avoid
  Unicode normalization and encoding problems on WebDAV/S3 servers.
- Repository directory name may remain `haamesh`; code and docs use Hāmesh.

## Consequences

- All user-facing text uses Hāmesh/هامش consistently.
- File paths, bundle ids, and package names never use the macron.
- Translation files keep the Persian name as a translatable string.
