/**
 * Login colour palettes. One hue family per palette (tonal, matte) plus a primary that is used
 * sparingly (focus ring, approved chip) and one small accent. Accents sit on white, so each
 * keeps >= 4.5:1 contrast there.
 */
export interface Palette {
  readonly id: string;
  readonly name: string;
  /** Background, then two slightly lighter tones for the matte shapes. */
  readonly bg: string;
  readonly bg2: string;
  readonly bg3: string;
  /** Form panel and its filled inputs. */
  readonly surface: string;
  readonly field: string;
  readonly onDark: string;
  readonly mutedOnDark: string;
  /** Light panel and its soft organic shape. */
  readonly light: string;
  readonly blob: string;
  readonly ink: string;
  readonly mutedInk: string;
  readonly primary: string;
  readonly primarySoft: string;
  readonly accent: string;
  readonly mark: string;
  readonly danger: string;
}

export const PALETTES: readonly Palette[] = [
  {
    // Measured from Juan Pablo Bueno's "QA Platform" mockup (Claude Design).
    id: 'jp',
    name: 'JP',
    bg: '#0c3a37',
    bg2: '#0f4541',
    bg3: '#13504b',
    surface: '#104440',
    field: '#0a2f2c',
    onDark: '#ffffff',
    mutedOnDark: '#a9c7c3',
    light: '#f7f7f9',
    blob: '#e7f4f2',
    ink: '#18181b',
    mutedInk: '#5b5a66',
    primary: '#0f766e',
    primarySoft: '#d7f2ef',
    accent: '#b45309',
    mark: '#ba8cfa',
    danger: '#fca5a5',
  },
  {
    // cgiar.org: deep green with a mint accent, kept for small details only.
    id: 'cgiar',
    name: 'CGIAR',
    bg: '#033529',
    bg2: '#064033',
    bg3: '#0a4b3c',
    surface: '#053d30',
    field: '#022a20',
    onDark: '#ffffff',
    mutedOnDark: '#a4c7bc',
    light: '#f6f8f6',
    blob: '#e2f3ec',
    ink: '#10201b',
    mutedInk: '#52615c',
    primary: '#0b7a5a',
    primarySoft: '#d3f4e8',
    accent: '#b45309',
    mark: '#18f2be',
    danger: '#fca5a5',
  },
  {
    id: 'navy',
    name: 'Navy',
    bg: '#1b1c3f',
    bg2: '#22244a',
    bg3: '#2a2d56',
    surface: '#25274d',
    field: '#33365e',
    onDark: '#ffffff',
    mutedOnDark: '#b3b5d6',
    light: '#f5f5fa',
    blob: '#e7e8f4',
    ink: '#191a33',
    mutedInk: '#575874',
    primary: '#4651c2',
    primarySoft: '#e0e3fb',
    accent: '#0369a1',
    mark: '#a5b4fc',
    danger: '#fda4af',
  },
  {
    id: 'sage',
    name: 'Sage',
    bg: '#2d5444',
    bg2: '#335d4c',
    bg3: '#3a6755',
    surface: '#305846',
    field: '#22443a',
    onDark: '#ffffff',
    mutedOnDark: '#bcd5ca',
    light: '#f7faf8',
    blob: '#e3efe8',
    ink: '#16241e',
    mutedInk: '#53625b',
    primary: '#3f7f73',
    primarySoft: '#dcefe9',
    accent: '#a16207',
    mark: '#9fd3c7',
    danger: '#fecaca',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    bg: '#1e2225',
    bg2: '#252a2e',
    bg3: '#2d3338',
    surface: '#262b2f',
    field: '#181b1e',
    onDark: '#ffffff',
    mutedOnDark: '#b4bbc0',
    light: '#f6f6f3',
    blob: '#ebebe5',
    ink: '#1b1d1f',
    mutedInk: '#5a5f63',
    primary: '#2f6f68',
    primarySoft: '#dcece9',
    accent: '#c2410c',
    mark: '#e7c39a',
    danger: '#fca5a5',
  },
];

export const DEFAULT_PALETTE = PALETTES[0];

/** CSS custom properties for a palette, plus the spartan tokens they drive inside the login. */
export function paletteStyle(palette: Palette): Record<string, string> {
  return {
    '--qa-bg': palette.bg,
    '--qa-bg-2': palette.bg2,
    '--qa-bg-3': palette.bg3,
    '--qa-surface': palette.surface,
    '--qa-field': palette.field,
    '--qa-on-dark': palette.onDark,
    '--qa-muted-on-dark': palette.mutedOnDark,
    '--qa-light': palette.light,
    '--qa-blob': palette.blob,
    '--qa-ink': palette.ink,
    '--qa-muted-ink': palette.mutedInk,
    '--qa-primary': palette.primary,
    '--qa-primary-soft': palette.primarySoft,
    '--qa-accent': palette.accent,
    '--qa-mark': palette.mark,
    '--qa-danger': palette.danger,
  };
}

/** The few colours a person picks for a custom palette; every other tone is derived. */
export interface CustomColors {
  readonly bg: string;
  readonly light: string;
  readonly ink: string;
  readonly primary: string;
  readonly accent: string;
}

export const CUSTOM_ID = 'custom';

export function customColorsFrom(palette: Palette): CustomColors {
  const { bg, light, ink, primary, accent } = palette;
  return { bg, light, ink, primary, accent };
}

const mix = (a: string, b: string, percentOfB: number) =>
  `color-mix(in oklab, ${a}, ${b} ${percentOfB}%)`;

/** Builds a full palette from five colours with the same tonal steps as the built-in ones. */
export function customPalette(colors: CustomColors): Palette {
  const { bg, light, ink, primary, accent } = colors;
  return {
    id: CUSTOM_ID,
    name: 'Custom',
    bg,
    bg2: mix(bg, '#ffffff', 5),
    bg3: mix(bg, '#ffffff', 10),
    surface: mix(bg, '#ffffff', 4),
    field: mix(bg, '#000000', 22),
    onDark: '#ffffff',
    mutedOnDark: mix(bg, '#ffffff', 68),
    light,
    blob: mix(light, primary, 9),
    ink,
    mutedInk: mix(ink, light, 35),
    primary,
    primarySoft: mix(primary, '#ffffff', 82),
    accent,
    mark: mix(primary, '#ffffff', 45),
    danger: '#fca5a5',
  };
}
