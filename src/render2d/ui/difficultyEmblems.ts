/**
 * Difficulty emblems (sprout / sword / skull) as SVG strings in the kit's palette. Kept apart from
 * difficulty2d.ts (DOM + CSS) so the canvas end panel can draw them without pulling in the DOM UI.
 */
import type { DifficultyId } from '../../data/difficulty.ts';

const O = '#3a2412';
const G = '#f2b33d';
const svg = (body: string): string =>
  `<svg viewBox="0 0 48 48" aria-hidden="true" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const DIFFICULTY_EMBLEMS: Readonly<Record<DifficultyId, string>> = {
  // A sprouting sprig.
  easy: svg(
    `<path d="M24 43 C24 34 23 27 24 18" fill="none" stroke="${O}" stroke-width="6"/>` +
      `<path d="M24 43 C24 34 23 27 24 18" fill="none" stroke="#6aa84f" stroke-width="2.6"/>` +
      `<path d="M23.5 28 C13 29 7 22 6.5 12.5 C16.5 12 23.5 18 23.5 28 Z" fill="#7cc35a" stroke="${O}" stroke-width="3"/>` +
      `<path d="M24.5 22 C26 13 33 7.5 41.5 8 C41.5 17 35 23 24.5 22 Z" fill="#a3d977" stroke="${O}" stroke-width="3"/>` +
      `<path d="M10 15.5 C15 18 19 22 22 26.5 M38 11 C33.5 13.5 29.5 16.5 26.5 20" fill="none" stroke="#4f8a3a" stroke-width="1.6"/>`,
  ),
  // A short sword with a gold guard.
  normal: svg(
    `<path d="M24 4.5 L28.6 10 L28.6 29 L19.4 29 L19.4 10 Z" fill="#eef1f3" stroke="${O}" stroke-width="3"/>` +
      `<path d="M24 9 V27" stroke="#b9c3cc" stroke-width="2"/>` +
      `<rect x="12" y="28.5" width="24" height="5.4" rx="2.4" fill="${G}" stroke="${O}" stroke-width="3"/>` +
      `<rect x="21.3" y="33.8" width="5.4" height="7.6" fill="#8a4a22" stroke="${O}" stroke-width="2.8"/>` +
      `<circle cx="24" cy="43.4" r="3" fill="${G}" stroke="${O}" stroke-width="2.4"/>`,
  ),
  // A bone-white skull.
  hard: svg(
    `<path d="M24 5.5 C13 5.5 7.5 12.5 7.5 21 C7.5 27 10.5 30.5 14 32.5 L14 38.5 C14 40.5 15.8 42 17.8 42 L30.2 42 C32.2 42 34 40.5 34 38.5 L34 32.5 C37.5 30.5 40.5 27 40.5 21 C40.5 12.5 35 5.5 24 5.5 Z" fill="#f4ead2" stroke="${O}" stroke-width="3.2"/>` +
      `<path d="M13.5 21.5 C13.5 17.5 20.5 17.5 21 21.5 C21 25.5 14 26.5 13.5 21.5 Z" fill="${O}"/>` +
      `<path d="M34.5 21.5 C34.5 17.5 27.5 17.5 27 21.5 C27 25.5 34 26.5 34.5 21.5 Z" fill="${O}"/>` +
      `<path d="M24 26.5 L21.6 31 L26.4 31 Z" fill="${O}"/>` +
      `<path d="M19.5 35.5 V41.5 M24 35.5 V41.5 M28.5 35.5 V41.5" stroke="${O}" stroke-width="2.2"/>`,
  ),
};
