/** Generated backdrop images for the glass UI (fal.ai, 2026-10-06). Served from `public/`. */
export interface Background {
  readonly id: string;
  readonly name: string;
  readonly src: string;
}

export const BACKGROUNDS: readonly Background[] = [
  { id: 'dunes', name: 'Dunes', src: '/backgrounds/dunes.webp' },
  { id: 'dunes-light', name: 'Light dunes', src: '/backgrounds/dunes-light.webp' },
  { id: 'silk', name: 'Silk', src: '/backgrounds/silk.webp' },
  { id: 'delta', name: 'Delta', src: '/backgrounds/delta.webp' },
  { id: 'stones', name: 'Stones', src: '/backgrounds/stones.webp' },
];

export const DEFAULT_BACKGROUND = BACKGROUNDS[0];
