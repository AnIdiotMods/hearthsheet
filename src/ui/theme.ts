// Appearance settings: light/dark mode, user colors, font and text size.
// Applied as attributes and CSS variables on <html>; stored per computer.

export type ThemeMode = 'system' | 'light' | 'dark';
/** "default", "dyslexic", or "custom:<id>" for a font the user imported. */
export type FontChoice = 'default' | 'dyslexic' | `custom:${string}`;
/** CSS font family name an imported font is registered under. */
export const customFontFamily = (id: string) => `HearthsheetUserFont-${id}`;

export interface Theme {
  mode: ThemeMode;
  /** Primary color: buttons, active tabs, highlights. null = built-in color. */
  accent: string | null;
  /** Text (lettering) color. */
  text: string | null;
  /** Secondary text: labels, headings, hints. */
  secondary: string | null;
  font: FontChoice;
  /** Text size as a percentage. */
  scale: number;
  /** Rounded corners (default) or sharp, square edges on every box, button and field. */
  corners: 'rounded' | 'sharp';
}

export const defaultTheme: Theme = { mode: 'system', accent: null, text: null, secondary: null, font: 'default', scale: 100, corners: 'rounded' };

export const PRESET_ACCENTS = ['#8a3b2a', '#2f6db5', '#2e7d4f', '#7b3fa0', '#b8860b', '#c2185b', '#00838f', '#455a64'];

const BACKGROUND = { light: '#f6f3ee', dark: '#1d1b19' };
const PANEL = { light: '#ffffff', dark: '#272421' };

export function effectiveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance and contrast ratio. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const mix = (a: string, b: string, t: number) => { const p = rgb(a), q = rgb(b); return toHex(p.map((v, i) => v + (q[i] - v) * t)); };

/** Black or white, whichever reads better on the given color. */
export const readableOn = (hex: string) => (contrast(hex, '#ffffff') >= contrast(hex, '#111111') ? '#ffffff' : '#111111');

/** Contrast of a chosen text color against the current background (4.5 is the usual minimum). */
export const textContrast = (hex: string, mode: ThemeMode) => contrast(hex, PANEL[effectiveMode(mode)]);

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  const mode = effectiveMode(t.mode);
  if (t.mode === 'system') delete root.dataset.theme; else root.dataset.theme = t.mode;
  if (t.font.startsWith('custom:')) {
    root.dataset.font = 'custom';
    root.style.setProperty('--custom-font', `"${customFontFamily(t.font.slice(7))}"`);
  } else {
    root.dataset.font = t.font;
    root.style.removeProperty('--custom-font');
  }
  const set = (k: string, v: string | null) => (v ? root.style.setProperty(k, v) : root.style.removeProperty(k));
  set('--accent', t.accent);
  set('--accent-ink', t.accent ? readableOn(t.accent) : null);
  set('--accent-soft', t.accent ? mix(BACKGROUND[mode], t.accent, mode === 'dark' ? 0.28 : 0.16) : null);
  set('--ink', t.text);
  set('--muted', t.secondary);
  root.dataset.corners = t.corners === 'sharp' ? 'sharp' : 'rounded';
  root.style.setProperty('--scale', String(Math.max(0.75, Math.min(1.6, t.scale / 100))));
}
