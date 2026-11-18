/** DOM button art. Secondary glyphs share the kit's cream, gold and brown palette. */
const O = '#3a2412';
const G = '#f2b33d';

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 48 48" aria-hidden="true" ${extra} stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

const painted = (name: string): string =>
  `<img src="/art2d/ui/icon-${name}.webp" style="display:block;width:100%;height:100%;object-fit:contain" alt="" draggable="false" aria-hidden="true"/>`;

/** A painted wax seal (`seal-<name>.webp`): carries its own backing, used as an inline badge. */
const sealArt = (name: string): string =>
  `<img src="/art2d/ui/seal-${name}.webp" style="display:block;width:100%;height:100%;object-fit:contain" alt="" draggable="false" aria-hidden="true"/>`;

/** The play triangle mirrored: the painted "back" arrow (there is no separate back icon). */
const paintedBack = (): string =>
  `<img src="/art2d/ui/icon-play.webp" style="display:block;width:100%;height:100%;object-fit:contain;transform:scaleX(-1)" alt="" draggable="false" aria-hidden="true"/>`;

export const ICONS = {
  workshop: painted('workshop'),
  logbook: painted('logbook'),
  daily: painted('daily'),
  settings: painted('settings'),
  codex: painted('codex'),
  close: painted('close'),
  play: painted('play'),
  lock: painted('lock'),
  map: painted('map'),
  next: painted('play'),
  back: paintedBack(),
  heart: `<img src="/art2d/icon-heart.webp" style="display:block;width:100%;height:100%;object-fit:contain" alt="" draggable="false" aria-hidden="true"/>`,
  crown: sealArt('crown'),
  medal: sealArt('medal'),
  islands: sealArt('islands'),
  endless: sealArt('endless'),
  trophy: sealArt('trophy'),
  /**
   * Treasure chest with a gold clasp and a blue gem: the "full adventure" lock and store item.
   * Still SVG: the painted kit has no chest yet (docs/handoff-opus-ui4.md lists the need).
   */
  chest: svg(
    `<path d="M8 22 C8 13.5 15 9.5 24 9.5 C33 9.5 40 13.5 40 22 Z" fill="#a8622e" stroke="${O}" stroke-width="3.2"/>` +
      `<rect x="8" y="22" width="32" height="17" rx="2.5" fill="#8a4a22" stroke="${O}" stroke-width="3.2"/>` +
      `<path d="M15 11.5 V39 M33 11.5 V39" stroke="${O}" stroke-width="6"/>` +
      `<path d="M15 11.5 V39 M33 11.5 V39" stroke="${G}" stroke-width="3"/>` +
      `<path d="M9.5 22 H38.5" stroke="${O}" stroke-width="2.4"/>` +
      `<rect x="19" y="18" width="10" height="12" rx="2.4" fill="${G}" stroke="${O}" stroke-width="2.8"/>` +
      `<circle cx="24" cy="23" r="2.4" fill="#3d7bd6" stroke="${O}" stroke-width="1.4"/>` +
      `<path d="M24 25.4 V28" stroke="${O}" stroke-width="2"/>`,
  ),
  /** Endless-record wave (no painted equivalent in the kit). */
  wave: svg(
    `<path d="M6 30 C10 24 14 24 18 30 C22 36 26 36 30 30 C34 24 38 24 42 30" fill="none" stroke="${O}" stroke-width="8"/>` +
      `<path d="M6 30 C10 24 14 24 18 30 C22 36 26 36 30 30 C34 24 38 24 42 30" fill="none" stroke="#7cc4e0" stroke-width="4"/>`,
  ),
} as const;

/** Glyphs that are painted wax seals (own backing: never set them on a round wooden button). */
export const SEAL_GLYPHS: ReadonlySet<string> = new Set(['crown', 'medal', 'islands', 'endless', 'trophy']);

export type IconName = keyof typeof ICONS;
