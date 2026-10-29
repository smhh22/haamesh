# ADR-0004: Platforms and formats

- Status: Accepted
- Date: 2026-10-29
- Deciders: user, agent

## Context

The user develops on Linux and personally uses Linux and Android. Friends use
Windows. Building all platforms at once multiplies QA, signing, and webview
differences. Building only Linux delays the audience that matters for feedback.

Format scope has a similar trade-off: EPUB is one rendering path and one locator
model; PDF is a fixed-layout engine with a page-based locator.

## Decision

**Platforms**

- v1 ships **Linux and Windows**.
- Development and primary testing happen on Linux (WebKitGTK). Windows
  (WebView2) gets a smoke build from Phase 1 and full packaging in Phase 4.
- macOS waits until signing and notarization are worth the cost.
- Android comes after desktop sync is stable, and the `storage` and `platform`
  interfaces are written to be SAF-compatible from day one.
- The web build is a development and testing aid, not a v1 release target
  (CORS and filesystem limits).

**Formats**

- Phase 1 supports **EPUB only**.
- PDF is the next format, built in Phase 2 as a parallel track behind the
  `engine` adapter. The locator model is a tagged union from day one so PDF does
  not change the schema.
- MOBI/AZW3, FB2, CBZ, TXT, and HTML come later, in that rough order of demand.

## Alternatives considered

- **Linux only:** smallest QA, but delays Windows feedback and hides
  Windows-specific path and font issues until late.
- **All three desktops:** adds macOS signing and a third webview before the
  product is proven.
- **Linux + Android first:** matches personal use but makes Android's storage
  model and device QA block the reader.
- **EPUB + PDF in v1:** covers Persian PDFs early, but doubles the rendering and
  progress work in the riskiest phase.

## Consequences

- Two webviews must be smoke-tested from Phase 1: WebKitGTK and WebView2.
- Path handling must be case-insensitivity and long-path aware from the start.
- The locator union and engine adapter are designed before PDF exists.
- Android storage decisions are constrained now (no bare absolute paths in
  public interfaces), even though Android ships later.
