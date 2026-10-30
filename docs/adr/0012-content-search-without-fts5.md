# ADR-0012: Content search without FTS5

- Status: Accepted
- Date: 2026-10-30
- Deciders: user, agent

## Context

Library content search extracts per-section EPUB text at import into
`book_texts` (storage v3) and answers queries by loading rows and filtering in
JavaScript with `normalizeForSearch` (NFKC, Arabic yeh/kaf folding, lowercase).
Persian text variants (ي vs ی, ك vs ک) are common in real Iranian EPUBs, so any
search must fold them on both the content and query side.

## Decision

Ship content search **without SQLite FTS5**:

1. `book_texts(book_id, section, content)` is the single source of truth on
   both platforms.
2. Queries load rows and filter with the shared normalizer; snippets are cut
   from the original text around the normalized match index.
3. No FTS5 virtual table, no tokenizer configuration.

## Rationale

- **Platform parity.** Native SQLite can bundle FTS5; sql.js/WASM availability
  is build-dependent. One schema and one query path avoids a silently degraded
  web build.
- **Normalization fidelity.** Stock FTS5 tokenizers do not fold Arabic
  yeh/kaf; porting `normalizeForSearch` into a custom tokenizer is native-only.
- **Scale.** Ebook libraries are hundreds of books / thousands of sections;
  JS filtering is milliseconds. FTS5 pays off at 10⁵+ documents.

## Consequences and switch conditions

- Each query reads all `book_texts` rows. Acceptable at this scale; revisit if
  a library reaches a few thousand books or latency becomes visible.
- Snippet windows assume length-preserving normalization; exotic NFKC forms
  could shift a window slightly.
- PDFs are not searchable (no text extraction yet).
- **Upgrade path:** add FTS5 as an index _beside_ `book_texts` (desktop only),
  keep the JS path for web, backfill the index at migration. No data migration
  and no wire-format change.
