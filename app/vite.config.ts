/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The site's news.json lives at the repo root, where the current site reads
// it. The app serves the same file beside itself, so News and Guild home read
// it the way the current site does (#1102), and a test can answer it.
function siteNews(): Plugin {
  const file = fileURLToPath(new URL('../news.json', import.meta.url));
  return {
    name: 'site-news',
    configureServer(server) {
      server.middlewares.use('/news.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'news.json', source: readFileSync(file, 'utf8') });
    }
  };
}

export default defineConfig({
  plugins: [react(), siteNews()],
  server: { port: 5174, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false
  }
});
