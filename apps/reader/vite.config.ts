import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Upstream foliate-js builds PDF asset URLs with a dynamic `new URL`, which
 * Vite 8 turns into a directory glob (including source maps). Point it at the
 * copied public assets instead; `scripts/copy-pdfjs.mjs` populates them.
 */
const foliatePdfPathFix = {
  name: 'foliate-pdf-path-fix',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.endsWith('/vendor/foliate-js/pdf.js')) return null;
    return code.replace(
      /const pdfjsPath = path => new URL\(`(?:\.\/)?vendor\/pdfjs\/\$\{path\}`, import\.meta\.url\)\.toString\(\)/,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the replacement writes upstream source code
      'const pdfjsPath = path => `/vendor/pdfjs/${path}`',
    );
  },
};

/**
 * Upstream foliate-js ResizeObserver callbacks fire once after a reader is
 * torn down, when the section iframe is already detached and its
 * contentDocument is null. Guard the two render entry points instead of
 * patching the pinned submodule.
 */
const foliateUpstreamGuards = {
  name: 'foliate-upstream-null-doc-guards',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (id.endsWith('/vendor/foliate-js/paginator.js')) {
      return code.replace(
        'render(layout) {\n        if (!layout) return',
        'render(layout) {\n        if (!layout || !this.document) return',
      );
    }
    if (id.endsWith('/vendor/foliate-js/fixed-layout.js')) {
      return code.replace(
        '#render(side = this.#side) {\n        if (!side) return',
        '#render(side = this.#side) {\n        if (!side || !this.isConnected) return',
      );
    }
    return null;
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), foliatePdfPathFix, foliateUpstreamGuards],
  server: {
    // Pin IPv4: Playwright (and the Tauri dev URL) use 127.0.0.1, while some
    // CI runners resolve "localhost" to ::1 first, which silently times out.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@hamesh/core': fromRoot('../../packages/core/src'),
      '@hamesh/engine': fromRoot('../../packages/engine/src'),
      '@hamesh/ui': fromRoot('../../packages/ui/src'),
      '@hamesh/sync': fromRoot('../../packages/sync/src'),
      'foliate-js/view.js': fromRoot('../../vendor/foliate-js/view.js'),
      'foliate-js/overlayer.js': fromRoot('../../vendor/foliate-js/overlayer.js'),
    },
  },
});
