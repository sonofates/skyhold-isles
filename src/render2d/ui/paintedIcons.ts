/**
 * Glyphs for the painted round buttons, drawn in the kit's lettering style: cream fill, thick
 * dark-brown outline, a touch of gold. Placeholders until painted icons exist (see
 * docs/p3-art-needs.md); they sit on the painted `button-round` disc, never on their own.
 */
const O = '#3a2412';
const C = '#fff4dc';
const G = '#f2b33d';

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 48 48" aria-hidden="true" ${extra} stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const ICONS = {
  workshop: svg(
    `<path d="M10 33 L27 16 L32 21 L15 38 Z" fill="${G}" stroke="${O}" stroke-width="3.4"/>` +
      `<path d="M23 9 C29 7 36 9 39 14 L34 19 L29 14 L26 17 L21 12 Z" fill="${C}" stroke="${O}" stroke-width="3.4"/>`,
  ),
  logbook: svg(
    `<path d="M9 10 C15 8 20 9 24 12 C28 9 33 8 39 10 V37 C33 35 28 36 24 39 C20 36 15 35 9 37 Z" fill="${C}" stroke="${O}" stroke-width="3.4"/>` +
      `<path d="M24 12 V39" stroke="${O}" stroke-width="3"/>` +
      `<path d="M13 17 H20 M13 22 H20 M28 17 H35 M28 22 H35" stroke="${O}" stroke-width="2.2" opacity=".55"/>` +
      `<path d="M30 8 V18 L32.5 15.5 L35 18 V8.6" fill="#c8341f" stroke="${O}" stroke-width="2.2"/>`,
  ),
  daily: svg(
    `<circle cx="18" cy="17" r="8.5" fill="${G}" stroke="${O}" stroke-width="3.2"/>` +
      `<path d="M12 37 H36 C40 37 42 34 42 31 C42 27.5 39 25 35.6 25.4 C34.6 21.4 31 19 27 19.6 C23 20.2 20.4 23.4 20.4 27 C17 26.6 14 28.8 14 32 C14 34.6 12.6 37 12 37 Z" fill="${C}" stroke="${O}" stroke-width="3.2"/>`,
  ),
  settings: svg(
    `<path d="M24 6 L28 6 L29 11.5 L33.4 13.6 L38 10.4 L40.8 13.2 L37.6 17.8 L39.6 22 L45 23 V27 L39.6 28 L37.6 32.4 L40.8 37 L38 39.8 L33.4 36.6 L29 38.6 L28 44 H24 L23 38.6 L18.6 36.6 L14 39.8 L11.2 37 L14.4 32.4 L12.4 28 L7 27 V23 L12.4 22 L14.4 17.8 L11.2 13.2 L14 10.4 L18.6 13.6 L23 11.5 Z" transform="translate(-2 -1)" fill="${C}" stroke="${O}" stroke-width="3"/>` +
      `<circle cx="24" cy="24" r="5.6" fill="${G}" stroke="${O}" stroke-width="3"/>`,
  ),
  codex: svg(
    `<path d="M11 8 H34 C36 8 37 9 37 11 V40 H14 C12 40 11 39 11 37 Z" fill="#8a3b1c" stroke="${O}" stroke-width="3.2"/>` +
      `<path d="M14 34 H37 V40 H14 C12.4 40 11 38.8 11 37 C11 35.2 12.4 34 14 34 Z" fill="${C}" stroke="${O}" stroke-width="2.8"/>` +
      `<path d="M18 14 C21 18 21 23 18 27 M24 13 C27 18 27 23 24 28 M30 14 C33 18 33 23 30 27" stroke="${G}" stroke-width="3.2" fill="none"/>`,
  ),
  close: svg(
    `<path d="M14 14 L34 34 M34 14 L14 34" stroke="${O}" stroke-width="10"/>` +
      `<path d="M14 14 L34 34 M34 14 L14 34" stroke="${C}" stroke-width="5"/>`,
  ),
  play: svg(`<path d="M16 10 L38 24 L16 38 Z" fill="${C}" stroke="${O}" stroke-width="3.6"/>`),
  lock: svg(
    `<path d="M16 22 V16 C16 11 19.6 8 24 8 C28.4 8 32 11 32 16 V22" fill="none" stroke="${O}" stroke-width="8"/>` +
      `<path d="M16 22 V16 C16 11 19.6 8 24 8 C28.4 8 32 11 32 16 V22" fill="none" stroke="#b9b2a4" stroke-width="3.6"/>` +
      `<rect x="11" y="21" width="26" height="20" rx="4" fill="${G}" stroke="${O}" stroke-width="3.4"/>` +
      `<path d="M24 28 V34" stroke="${O}" stroke-width="3.6"/>`,
  ),
  map: svg(
    `<path d="M7 12 L17 8 L31 12 L41 8 V36 L31 40 L17 36 L7 40 Z" fill="${C}" stroke="${O}" stroke-width="3.2"/>` +
      `<path d="M17 8 V36 M31 12 V40" stroke="${O}" stroke-width="2.6"/>` +
      `<path d="M11 30 C15 26 19 30 23 25 C26 21 30 24 34 18" stroke="#c8341f" stroke-width="2.6" stroke-dasharray="1 4" fill="none"/>`,
  ),
  next: svg(
    `<path d="M20 10 L34 24 L20 38" fill="none" stroke="${O}" stroke-width="10"/>` + `<path d="M20 10 L34 24 L20 38" fill="none" stroke="${C}" stroke-width="5"/>`,
  ),
  /** Treasure chest with a gold clasp and a blue gem: the "full adventure" lock and store item. */
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
  /** Speaker with a red slash: no sound. */
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
