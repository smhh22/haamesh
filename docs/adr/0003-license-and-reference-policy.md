# ADR-0003: License and reference policy

- Status: Accepted
- Date: 2026-10-29
- Deciders: user, agent

## Context

Readest is licensed AGPL-3.0. It is the closest reference for architecture and
behavior. Copying its code into a permissively licensed product would force the
whole product under AGPL. The user plans to design from scratch rather than
copy, and wants a simple license for the project.

`foliate-js` is MIT and may be used as a dependency.

## Decision

- Hāmesh is licensed **MIT**.
- Readest source is **reference only**. We may read it, describe its behavior,
  and re-implement ideas. We do not copy code, comments, or asset files from it.
- Every third-party dependency must be license-compatible with MIT
  distribution (MIT, BSD, Apache-2.0, ISC, OFL for fonts). AGPL and GPL
  dependencies require an explicit ADR before adoption.
- Bundled fonts must permit redistribution. Vazirmatn (OFL-1.1) is the only
  approved bundled font. XB Niloofar is **not approved for bundling**; its
  redistribution terms could not be verified, so it is only available through
  user font import.
- The repository ships a `LICENSE` file and keeps dependency licenses
  auditable.

## Alternatives considered

- **AGPL-3.0:** would allow direct reuse of Readest code but imposes source
  disclosure on network use and complicates commercial distribution.
- **Apache-2.0:** also permissive, with a patent grant, but more notice
  obligations than needed for this project.
- **No license yet:** blocks contributions and reuse, and leaves the reference
  policy ambiguous.

## Consequences

- No copy/paste from Readest, including small utility functions. Behavior may
  be re-implemented from observation and public specifications.
- Dependency additions need a license check, recorded in the PR or ADR.
- Font licensing is a release blocker; XB Niloofar stays user-imported until
  verified.
