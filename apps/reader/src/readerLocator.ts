import type { Locator } from '@hamesh/core';

export interface RelocateDetail {
  fraction?: number;
  cfi?: string;
  section?: { current?: number; total?: number };
}

/**
 * PDFs use page locators; EPUBs use CFI. The fraction is kept in both cases so
 * progress display and a cross-format fallback always exist.
 */
export const locatorFromRelocate = (detail: RelocateDetail, isPdf: boolean): Locator | null => {
  if (typeof detail.fraction !== 'number' || !Number.isFinite(detail.fraction)) {
    return null;
  }
  const fraction = Math.min(1, Math.max(0, detail.fraction));

  if (isPdf) {
    const current = detail.section?.current;
    if (typeof current !== 'number') return null;
    return { kind: 'page', page: current + 1, fraction };
  }

  return detail.cfi ? { kind: 'cfi', cfi: detail.cfi, fraction } : null;
};
