// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Tauri CSP is the desktop app's security boundary; these directives are
 * also functional requirements:
 * - connect-src 'self': foliate's PDF loader fetches its text-layer CSS from
 *   the app itself; without 'self' every PDF import fails under tauri://.
 * - worker-src blob: pdf.js may wrap its worker in a blob URL.
 */
const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'),
) as { app?: { security?: { csp?: string } } };

const csp = config.app?.security?.csp ?? '';

describe('Tauri CSP', () => {
  it('allows same-origin fetches for book assets', () => {
    expect(csp).toMatch(/connect-src[^;]*'self'/);
  });

  it('allows blob workers for the PDF engine', () => {
    expect(csp).toContain('worker-src');
    expect(csp).toMatch(/worker-src[^;]*blob:/);
  });
});
