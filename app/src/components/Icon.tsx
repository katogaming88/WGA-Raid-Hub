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
  grid: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
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
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  shield: '<path d="M8 2 13 4v4c0 3.6-2.2 6-5 7-2.8-1-5-3.4-5-7V4z"/>',
  info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.2v3.6"/><circle cx="8" cy="5.1" r="0.9" fill="currentColor" stroke="none"/>',
  help: '<circle cx="8" cy="8" r="5.5"/><path d="M6.1 6.3a2 2 0 1 1 2.9 1.8c-.7.4-1 .8-1 1.5"/><circle cx="8" cy="11.2" r="0.9" fill="currentColor" stroke="none"/>',
  mail: '<rect x="2" y="4" width="12" height="8.5" rx="1.2"/><path d="M2.5 4.8 8 9l5.5-4.2"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.4 1.6"/>',
  link: '<path d="M6.5 9.5a3 3 0 0 0 4.2 0l1.6-1.6a3 3 0 0 0-4.2-4.2L7 4.8"/><path d="M9.5 6.5a3 3 0 0 0-4.2 0L3.7 8.1a3 3 0 0 0 4.2 4.2L9 11.2"/>',
  more: '<circle cx="3.5" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor" stroke="none"/>'
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

// The real Battle.net and Discord marks (#1360), in currentColor so a page
// can light or grey them. Decorative like Icon: text beside them names them.
const BRANDS = {
  battlenet:
    'M18.94 8.296C15.9 6.892 11.534 6 7.426 6.332c.206-1.36.714-2.308 1.548-2.508 1.148-.275 2.4.48 3.594 1.854.782.102 1.71.28 2.355.429C12.747 2.013 9.828-.282 7.607.565c-1.688.644-2.553 2.97-2.448 6.094-2.2.468-3.915 1.3-5.013 2.495-.056.065-.181.227-.137.305.034.058.146-.008.194-.04 1.274-.89 2.904-1.373 5.027-1.676.303 3.333 1.713 7.56 4.055 10.952-1.28.502-2.356.536-2.946-.087-.812-.856-.784-2.318-.19-4.04a26.764 26.764 0 0 1-.807-2.254c-2.459 3.934-2.986 7.61-1.143 9.11 1.402 1.14 3.847.725 6.502-.926 1.505 1.672 3.083 2.74 4.667 3.094.084.015.287.043.332-.034.034-.06-.08-.124-.131-.149-1.408-.657-2.64-1.828-3.964-3.515 2.735-1.929 5.691-5.263 7.457-8.988 1.076.86 1.64 1.773 1.398 2.595-.336 1.131-1.615 1.84-3.403 2.185a27.697 27.697 0 0 1-1.548 1.826c4.634.16 8.08-1.22 8.458-3.565.286-1.786-1.295-3.696-4.053-5.17.696-2.139.832-4.04.346-5.588-.029-.08-.106-.27-.196-.27-.068 0-.067.13-.063.187.135 1.547-.263 3.2-1.062 5.19zm-8.533 9.869c-1.96-3.145-3.09-6.849-3.082-10.594 3.702-.124 7.474.748 10.714 2.627-1.743 3.269-4.385 6.1-7.633 7.966h.001z',
  discord:
    'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z'
} as const;

export function BrandLogo({ brand, size = 14 }: { brand: keyof typeof BRANDS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={BRANDS[brand]} />
    </svg>
  );
}
