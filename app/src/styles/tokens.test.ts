// @vitest-environment node
// Contrast gate for the design tokens (#1101 accessibility checklist): every
// color used for text reaches 4.5:1 on every surface it can sit on, in both
// themes, so a later tweak to tokens.css cannot quietly drop below it.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens[m[1]!] = m[2]!.toLowerCase();
  }
  return tokens;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SURFACES = ['page', 'sidebar', 'panel', 'raised'];
const TEXT = ['text', 'text-muted', 'text-dim', 'brand', 'good', 'warn', 'bad', 'heroic', 'mythic', 'epic'];

const dark = block(":root[data-theme='dark']");
const themes: [string, Record<string, string>][] = [
  ['dark', dark],
  ['light', { ...dark, ...block(":root[data-theme='light']") }]
];

describe.each(themes)('%s theme', (_name, tokens) => {
  const classColors = Object.keys(tokens).filter((k) => k.startsWith('class-'));

  it('defines every surface, text color and all 13 class colors', () => {
    for (const k of [...SURFACES, ...TEXT]) expect(tokens[k], k).toMatch(/^#/);
    expect(classColors).toHaveLength(13);
  });

  it.each([...TEXT, ...classColors])('%s reaches 4.5:1 on every surface', (fg) => {
    for (const bg of SURFACES) {
      expect(contrast(tokens[fg]!, tokens[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the current-page bar in the sidebar reaches 3:1 against the sidebar', () => {
    expect(contrast(tokens['brand']!, tokens['sidebar']!)).toBeGreaterThanOrEqual(3);
  });

  it('text on the current-page highlight reaches 4.5:1', () => {
    expect(tokens['nav-selected']).toMatch(/^#/);
    for (const fg of ['text', 'brand']) {
      expect(contrast(tokens[fg]!, tokens['nav-selected']!), fg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the main button and notification badge text reach 4.5:1', () => {
    expect(contrast(tokens['button-text']!, tokens['button']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens['badge-text']!, tokens['badge']!)).toBeGreaterThanOrEqual(4.5);
  });
});
