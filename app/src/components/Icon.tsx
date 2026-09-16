// Stroke icons from the 2026-09-13 mockups, drawn on a 16px grid.
const PATHS = {
  home: '<path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5z"/><path d="M6.5 13.5v-4h3v4"/>',
  roster:
    '<circle cx="6" cy="5.5" r="2.3"/><path d="M1.8 13.5c.5-2.4 2.2-3.6 4.2-3.6s3.7 1.2 4.2 3.6"/><path d="M10.5 3.4a2.2 2.2 0 0 1 0 4.2M12 9.9c1.2.5 2 1.6 2.3 3.6"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
  loot: '<path d="M3 6h10l-1 7.5H4z"/><path d="M5.5 6V4.5a2.5 2.5 0 0 1 5 0V6"/>',
  user: '<circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/>',
  list: '<path d="M6 4h7.5M6 8h7.5M6 12h7.5"/><path d="M2.5 4h.5M2.5 8h.5M2.5 12h.5"/>',
  import: '<path d="M8 2.5v7M5 6.8 8 9.8l3-3"/><path d="M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11"/>',
  check: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="m5.5 8 1.8 1.8 3.4-3.6"/>',
  chart: '<path d="M2.5 13.5h11"/><path d="M4.5 11V8M8 11V4.5M11.5 11V6.5"/>',
  gear: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>',
  coin: '<ellipse cx="8" cy="5" rx="5" ry="2.2"/><path d="M3 5v6c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V5"/><path d="M3 8c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2"/>',
  tv: '<rect x="2" y="3.5" width="12" height="8.5" rx="1.5"/><path d="M5.5 14h5"/>',
  news: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 5.5h6M5 8h6M5 10.5h3.5"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/>',
  chevronDown: '<path d="m5 6.5 3 3 3-3"/>',
  chevronRight: '<path d="m6.5 4.5 3 3.5-3 3.5"/>',
  chevronLeft: '<path d="m9.5 4.5-3 3.5 3 3.5"/>',
  edit: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/>',
  sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  moon: '<path d="M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8z"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>'
} as const;

export type IconName = keyof typeof PATHS;

// Decorative by default: every icon sits next to text or inside a control
// that carries its own accessible name (#1101 checklist).
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

export function FlameMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 2c.6 3.2-1.2 5-2.8 6.8C7.7 10.5 6 12.4 6 15.2 6 18.9 8.7 22 12 22s6-3 6-6.6c0-2.6-1.3-4.3-2.6-5.6.1 1.6-.5 2.9-1.6 3.4.3-3.8-1-7.6-1.8-11.2Z" />
    </svg>
  );
}
