/** DOM button art. Secondary glyphs share the kit's cream, gold and brown palette. */
const O = '#3a2412';
const C = '#fff4dc';
const G = '#f2b33d';

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 48 48" aria-hidden="true" ${extra} stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

const painted = (name: string): string =>
  `<img src="/art2d/ui/icon-${name}.webp" style="display:block;width:100%;height:100%;object-fit:contain" alt="" draggable="false" aria-hidden="true"/>`;

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
  next: svg(
    `<path d="M20 10 L34 24 L20 38" fill="none" stroke="${O}" stroke-width="10"/>` + `<path d="M20 10 L34 24 L20 38" fill="none" stroke="${C}" stroke-width="5"/>`,
  ),
  /** Speaker with a red slash: no sound (yet). */
  mute: svg(
    `<path d="M8 19 H15 L25 10 V38 L15 29 H8 Z" fill="${C}" stroke="${O}" stroke-width="3.2"/>` +
      `<path d="M30 17 C33 20 33 28 30 31 M35 13 C40 18 40 30 35 35" fill="none" stroke="${O}" stroke-width="3" opacity=".55"/>` +
      `<path d="M8 40 L40 8" stroke="${O}" stroke-width="8"/>` +
      `<path d="M8 40 L40 8" stroke="#c8341f" stroke-width="4"/>`,
  ),
  back: svg(
    `<path d="M28 10 L14 24 L28 38" fill="none" stroke="${O}" stroke-width="10"/>` + `<path d="M28 10 L14 24 L28 38" fill="none" stroke="${C}" stroke-width="5"/>`,
  ),
  heart: svg(
    `<path d="M24 40 C14 32 7 26 7 18 C7 12.5 11 9 15.5 9 C19 9 22 11 24 14 C26 11 29 9 32.5 9 C37 9 41 12.5 41 18 C41 26 34 32 24 40 Z" fill="#d8342a" stroke="${O}" stroke-width="3.2"/>`,
  ),
  wave: svg(
    `<path d="M6 30 C10 24 14 24 18 30 C22 36 26 36 30 30 C34 24 38 24 42 30" fill="none" stroke="${O}" stroke-width="8"/>` +
      `<path d="M6 30 C10 24 14 24 18 30 C22 36 26 36 30 30 C34 24 38 24 42 30" fill="none" stroke="#7cc4e0" stroke-width="4"/>`,
  ),
  crown: svg(
    `<path d="M7 17 L15 25 L24 11 L33 25 L41 17 L37 37 H11 Z" fill="${G}" stroke="${O}" stroke-width="3.2"/>`,
  ),
  medal: svg(
    `<path d="M15 5 L21 20 M33 5 L27 20" stroke="#2f5fae" stroke-width="6"/>` +
      `<circle cx="24" cy="29" r="12" fill="${G}" stroke="${O}" stroke-width="3.2"/>` +
      `<circle cx="24" cy="29" r="6" fill="none" stroke="${O}" stroke-width="2" opacity=".5"/>`,
  ),
  islands: svg(
    `<path d="M6 30 C12 22 18 20 24 22 C30 20 37 22 42 30 C34 33 14 33 6 30 Z" fill="#7cb84a" stroke="${O}" stroke-width="3"/>` +
      `<path d="M10 31 C16 38 32 38 38 31" fill="#9c6b49" stroke="${O}" stroke-width="3"/>` +
      `<path d="M24 22 V10 L33 14 L24 17" fill="#c8341f" stroke="${O}" stroke-width="2.6"/>`,
  ),
  endless: svg(
    `<path d="M14 18 C8 18 6 22 6 24 C6 26 8 30 14 30 C20 30 28 18 34 18 C40 18 42 22 42 24 C42 26 40 30 34 30 C28 30 20 18 14 18 Z" fill="none" stroke="${O}" stroke-width="8"/>` +
      `<path d="M14 18 C8 18 6 22 6 24 C6 26 8 30 14 30 C20 30 28 18 34 18 C40 18 42 22 42 24 C42 26 40 30 34 30 C28 30 20 18 14 18 Z" fill="none" stroke="${G}" stroke-width="4"/>`,
  ),
  trophy: svg(
    `<path d="M15 8 H33 V18 C33 24 29 28 24 28 C19 28 15 24 15 18 Z" fill="${G}" stroke="${O}" stroke-width="3.2"/>` +
      `<path d="M15 12 H9 C9 18 11 21 15.5 21 M33 12 H39 C39 18 37 21 32.5 21" fill="none" stroke="${O}" stroke-width="3"/>` +
      `<path d="M20 40 H28 L27 32 H21 Z M16 40 H32" fill="${G}" stroke="${O}" stroke-width="3"/>`,
  ),
} as const;

export type IconName = keyof typeof ICONS;
