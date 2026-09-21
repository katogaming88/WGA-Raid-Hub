/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

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

// Source maps go to Sentry from the deploy build, so a report's stack trace
// reads as the real files (#1161). Only where SENTRY_AUTH_TOKEN is set: a
// local or pull request build makes no maps and needs no token. The maps are
// deleted after the upload, so they are not published with the app, and a
// failed upload is a warning, not a failed deploy.
const sentryToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    siteNews(),
    ...(sentryToken
      ? [
          sentryVitePlugin({
            org: 'katorri',
            project: 'javascript-react',
            authToken: sentryToken,
            release: { name: process.env.GITHUB_SHA ?? 'local' },
            sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] },
            telemetry: false,
            errorHandler: (error) => console.warn('Sentry source map upload failed:', error.message)
          })
        ]
      : [])
  ],
  build: { sourcemap: sentryToken ? 'hidden' : false },
  server: { port: 5174, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false
  }
});
