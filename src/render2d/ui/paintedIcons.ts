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
  /** Restart: a cream circular arrow (no painted equivalent in the kit). */
  restart: svg(
    `<path d="M36.5 17 A14 14 0 1 0 38 27" fill="none" stroke="${O}" stroke-width="9"/>` +
      `<path d="M36.5 17 A14 14 0 1 0 38 27" fill="none" stroke="#fff4dc" stroke-width="4.5"/>` +
      `<path d="M41 7 L40 21 L27 18 Z" fill="#fff4dc" stroke="${O}" stroke-width="3"/>`,
  ),
  /** Replay: a little picture frame on a stand with a red play triangle (matches the end panel). */
  replay: svg(
    `<path d="M18 37 L15 43 M30 37 L33 43" stroke="${O}" stroke-width="4"/>` +
      `<rect x="6" y="9" width="36" height="28" rx="4" fill="#fff4dc" stroke="${O}" stroke-width="3.4"/>` +
      `<path d="M20 16 L31 23 L20 30 Z" fill="#c8341f" stroke="${O}" stroke-width="2.4"/>`,
  ),
  /** Pause bars (cream on the wooden button). */
  pause: svg(
    `<rect x="12" y="9" width="9" height="30" rx="2.5" fill="#fff4dc" stroke="${O}" stroke-width="3.2"/>` +
      `<rect x="27" y="9" width="9" height="30" rx="2.5" fill="#fff4dc" stroke="${O}" stroke-width="3.2"/>`,
  ),
  /** Flyer mark (colour-blind-safe cue next to the sky-blue backdrop): a cream feathered wing. */
  wing: svg(
    `<path d="M6 30 C10 16 22 9 42 8 C38 13 36 16 31 18 C36 18 38 19 40 20 C35 24 31 25 26 25 C30 27 31 28 32 30 C25 33 16 33 6 30 Z" fill="#fff4dc" stroke="${O}" stroke-width="3.2"/>` +
      `<path d="M13 28 C19 22 26 18 34 14 M15 30 C21 27 25 26 29 24" fill="none" stroke="#7cb4dc" stroke-width="2.4"/>`,
  ),
  /** Armour mark (foes with heavy armour): an iron shield with a gold rim and boss. */
  shield: svg(
    `<path d="M24 5 L40 11 C40 26 34 37 24 43 C14 37 8 26 8 11 Z" fill="#9aa4ad" stroke="${O}" stroke-width="3.4"/>` +
      `<path d="M24 10 L35 14.5 C35 26 30.5 33.5 24 38 C17.5 33.5 13 26 13 14.5 Z" fill="#c9d1d8" stroke="${G}" stroke-width="2.4"/>` +
      `<circle cx="24" cy="22" r="4" fill="${G}" stroke="${O}" stroke-width="2.2"/>`,
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
