import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
