// Spike config for the React-swap test (calendar grid only, see
// web/calendar/). Builds one self-executing bundle that js/calendar.js loads
// as a plain <script> alongside the site's existing unbundled scripts --
// deliberately not restructuring the rest of the site's build/deploy story,
// since the point of this pass is to see how one page's interop feels before
// deciding whether a real build step is worth adopting site-wide.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // React reads process.env.NODE_ENV at runtime for its dev/prod branches.
  // Vite's normal (non-library) build mode replaces that automatically;
  // build.lib mode does not, so the shipped IIFE hit a bare, undefined
  // `process` global and threw before ever reaching the
  // window.mountCalendarGridReact assignment at the bottom of the file --
  // this define is what a plain <script> tag needs in its place.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: 'dist/calendar-widget',
    emptyOutDir: true,
    lib: {
      entry: 'web/calendar/mount.jsx',
      formats: ['iife'],
      name: 'CalendarWidgetReact',
      fileName: () => 'calendar-widget.js'
    }
  }
});
