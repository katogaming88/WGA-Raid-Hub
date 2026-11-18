/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Source maps go to Sentry from the deploy build, so a report's stack trace
// reads as the real files (#1161). Only where SENTRY_AUTH_TOKEN is set: a
// local or pull request build makes no maps and needs no token. The maps are
// deleted after the upload, so they are not published with the app, and a
// failed upload is a warning, not a failed deploy.
const sentryToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
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
