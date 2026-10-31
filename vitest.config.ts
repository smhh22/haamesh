import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'foliate-js/view.js': fromRoot('./vendor/foliate-js/view.js'),
      'foliate-js/vendor/pdfjs/pdf.worker.mjs': fromRoot(
        './vendor/foliate-js/vendor/pdfjs/pdf.worker.mjs',
      ),
      'foliate-js/overlayer.js': fromRoot('./vendor/foliate-js/overlayer.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/*/src/**/*.test.{ts,tsx}'],
    css: true,
  },
});
