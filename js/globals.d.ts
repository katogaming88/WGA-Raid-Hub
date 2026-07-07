// Ambient window globals for the no-build frontend (#331). Type declarations
// only; nothing here ships or compiles. Runtime code stays plain .js.
interface Window {
  // supabase-js v2 UMD global from the CDN script tag on index.html and
  // officer.html; undefined when the CDN script fails to load (common.js
  // guards every use). Stays `any` until the generated Supabase types land
  // after the Phase 2 schema settles (#331).
  supabase?: any;
  // JSONP callbacks for the GAS core/heavy payload chunks (loadData in
  // common.js). The GAS response script calls them by name, so they must
  // live on window.
  _rosterCoreCallback?: (data: any) => void;
  _rosterHeavyCallback?: (heavy: any) => void;
}
