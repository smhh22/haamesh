# ADR-0007: RTL, bidi, and typography

- Status: Accepted
- Date: 2026-10-29
- Deciders: user, agent

## Context

Readest supports RTL, but as a retrofit: a `.ui-rtl` class plus per-component CSS
overrides for dropdowns and menus. That works, but every new component needs its
own fix. Hāmesh targets Persian readers first, so direction must be structural.

The user also raised the mixed-paragraph case: a Persian book can contain English
paragraphs. Direction must be resolved per document/paragraph, not guessed per
character.

## Decision

**UI direction**

- Active locale sets `dir` on `<html>`; a direction provider exposes it to
  components.
- Layout uses CSS logical properties exclusively
  (`margin-inline`, `padding-inline`, `inset-inline`, `border-inline`,
  `text-align: start|end`).
- CI rejects physical layout declarations (`margin-left`, `left:`, `right:`,
  `text-align: left|right`) with a small, commented allowlist.
- Directional icons mirror; others never do. Sliders, progress bars, tabs, and
  drag-and-drop read direction from context.
- Dynamic values inside mixed text use `<bdi>`; user titles/notes use
  `dir="auto"`.

**Book content**

- The book document gets a base `dir` from: OPF `page-progression-direction`,
  then book language, then per-document `dir`, then a text heuristic.
- Publisher-marked `dir`/`lang` on paragraphs and spans is preserved.
- `dir="auto"` is **not** applied to book paragraphs: a Persian paragraph
  starting with a Latin word or digit can flip to LTR.
- Pagination direction comes from the book level only.
- A per-book manual direction override is available for bad metadata.
- Navigation follows direction: next is visually left in RTL; arrow keys, swipe,
  click zones, progress bar fill, and TOC indentation follow.

**Typography**

- Font: Vazirmatn (OFL-1.1), bundled, used for both UI and book text.
- No second bundled font. XB Niloofar is not bundled because no authoritative
  license was found; it can be added later only through user font import with a
  verified license.
- No letter-spacing for Arabic-script text; line height 1.8–2.0; no hyphenation;
  ZWNJ/ZWJ preserved; no diacritic stripping.
- Book body text is justified by default in both directions, with a toggle to
  start-aligned.
- UI numbers use `Intl` with the active locale; book text is never transformed.

**Testing**

- Persian, Arabic, and mixed-direction EPUB fixtures.
- Playwright snapshots in LTR and RTL.
- Unit tests for direction resolution and key/gesture mapping.

## Alternatives considered

- **Class-based RTL overrides:** the Readest approach; rejected because every
  new component needs a patch.
- **`dir="auto"` per paragraph:** helps missing metadata but misdetects
  paragraphs that start with Latin text or digits.
- **Force book direction on every paragraph:** breaks English paragraphs inside
  Persian books.
- **Per-character detection:** not how the Unicode bidi algorithm works.

## Consequences

- Physical CSS is a CI failure, not a review comment.
- One bundled font: Vazirmatn (OFL-1.1); no serif fallback ships.
- Justification can produce uneven spacing; the toggle is the escape hatch.
- Direction resolution needs tests, including mixed-language fixtures.
- Verification note (2026-10-29): Vazirmatn was confirmed OFL-1.1 from its
  repository and package metadata. Noto Naskh Arabic was considered and
  rejected in favor of a single font. No authoritative XB Niloofar license text
  was found, so it is not bundled; user font import is the supported path until
  a license is verified.
