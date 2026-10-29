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
      'const pdfjsPath = path => `/vendor/pdfjs/${path}`',
    );
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), foliatePdfPathFix],
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@hamesh/core': fromRoot('../../packages/core/src'),
      '@hamesh/engine': fromRoot('../../packages/engine/src'),
      '@hamesh/ui': fromRoot('../../packages/ui/src'),
      'foliate-js/view.js': fromRoot('../../vendor/foliate-js/view.js'),
      'foliate-js/overlayer.js': fromRoot('../../vendor/foliate-js/overlayer.js'),
    },
  },
});
