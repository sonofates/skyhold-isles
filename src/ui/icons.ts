import type { EnemyType, TowerType } from '../core/types.ts';
import { PALETTE } from '../data/palette.ts';

export const TOWER_ICON_SVGS: Record<TowerType, string> = {
  archer: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M7 22C7 14.5 13 9 20.5 9" stroke="${PALETTE.indigo}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M7 22L20.5 9" stroke="${PALETTE.sand}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M10 22L24 8" stroke="${PALETTE.gold}" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M24 8L18.5 8.5L23.5 13.5L24 8Z" fill="${PALETTE.coral}"/>
  </svg>`,
  cannon: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="18" width="16" height="8" rx="2.5" fill="${PALETTE.stone}" stroke="${PALETTE.indigo}" stroke-width="2"/>
    <path d="M11 16L22 9L25.5 14L15 20.5Z" fill="${PALETTE.indigo}"/>
    <circle cx="13" cy="22" r="2.6" fill="${PALETTE.gold}"/>
    <circle cx="25.5" cy="9" r="2.5" fill="${PALETTE.coral}"/>
  </svg>`,
  frost: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M16 4L22 14L16 27L10 14L16 4Z" fill="${PALETTE.water}" stroke="${PALETTE.indigo}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M16 9V22M11 15H21" stroke="${PALETTE.cream}" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  tesla: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="11" y="19" width="10" height="7" rx="2" fill="${PALETTE.stone}" stroke="${PALETTE.indigo}" stroke-width="2"/>
    <path d="M17 4L11 15H17L14 23L22 12H16L17 4Z" fill="${PALETTE.gold}" stroke="${PALETTE.indigo}" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`,
  mortar: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="6" y="21" width="20" height="5" rx="2" fill="${PALETTE.stone}" stroke="${PALETTE.indigo}" stroke-width="2"/>
    <path d="M11 21L17 8L23 11L18 21Z" fill="${PALETTE.indigo}"/>
    <circle cx="21" cy="7" r="2.8" fill="${PALETTE.coral}"/>
  </svg>`,
  ballista: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M6 24L25 7" stroke="${PALETTE.indigo}" stroke-width="3" stroke-linecap="round"/>
    <path d="M25 7L19 7.8L24.2 13Z" fill="${PALETTE.coral}" stroke="${PALETTE.indigo}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M5 13C9 12 13 15 14 19M5 13L10 25" stroke="${PALETTE.gold}" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="6" y="24" width="12" height="3.5" rx="1.5" fill="${PALETTE.stone}" stroke="${PALETTE.indigo}" stroke-width="1.6"/>
  </svg>`,
  beacon: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M12 27L14.5 15H17.5L20 27Z" fill="${PALETTE.stone}" stroke="${PALETTE.indigo}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M16 4L21 10L16 16L11 10Z" fill="${PALETTE.gold}" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M6 9C4.6 11.4 4.6 14.2 6 16.6M26 9C27.4 11.4 27.4 14.2 26 16.6" stroke="${PALETTE.water}" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  barracks: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M10 26V12L16 7L22 12V26Z" fill="${PALETTE.stone}" stroke="${PALETTE.indigo}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M7 26L13 18M25 26L19 18" stroke="${PALETTE.gold}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M16 7V3L21 4.5L16 6" fill="${PALETTE.coral}" stroke="${PALETTE.indigo}" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`,
};

export const UI_ICON_SVGS = {
  coin: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="${PALETTE.gold}" stroke="${PALETTE.indigo}" stroke-width="2"/>
    <circle cx="12" cy="12" r="4.5" stroke="${PALETTE.cream}" stroke-width="1.8"/>
  </svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 20.5S4.5 15.2 4.5 9.8C4.5 7 6.7 5 9.3 5C10.9 5 12 6 12 6S13.1 5 14.7 5C17.3 5 19.5 7 19.5 9.8C19.5 15.2 12 20.5 12 20.5Z" fill="${PALETTE.coral}" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>`,
  wave: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 4V20M6 5H17L14.5 9L17 13H6" stroke="${PALETTE.indigo}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="${PALETTE.grass}"/>
  </svg>`,
  play: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 6L19 12L8 18V6Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor"/>
    <rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor"/>
  </svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="2"/>
    <path d="M12 3V5.5M12 18.5V21M3 12H5.5M18.5 12H21M5.6 5.6L7.4 7.4M16.6 16.6L18.4 18.4M18.4 5.6L16.6 7.4M7.4 16.6L5.6 18.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  rotateLeft: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 7H5V3M5 7C7.5 4.2 12 3.8 15.5 5.8C19 7.8 20.4 12.1 18.6 15.8C17.2 18.6 14.3 20.2 11.2 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  rotateRight: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M15 7H19V3M19 7C16.5 4.2 12 3.8 8.5 5.8C5 7.8 3.6 12.1 5.4 15.8C6.8 18.6 9.7 20.2 12.8 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  star: `<svg viewBox="0 0 24 24" fill="${PALETTE.gold}" aria-hidden="true">
    <path d="M12 3L14.8 8.7L21 9.6L16.5 14L17.6 20.2L12 17.2L6.4 20.2L7.5 14L3 9.6L9.2 8.7L12 3Z" stroke="${PALETTE.indigo}" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`,
  starEmpty: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3L14.8 8.7L21 9.6L16.5 14L17.6 20.2L12 17.2L6.4 20.2L7.5 14L3 9.6L9.2 8.7L12 3Z" stroke="${PALETTE.stone}" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 7H19M5 12H19M5 17H19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,
  airGround: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 7.5C4.2 4 6.6 4.4 8 6.8C9.4 4.4 11.8 4 14 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M2.5 12.5H13.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
  groundOnly: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 12.5H13.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M4.8 12.5L6.2 8.2H9.8L11.2 12.5" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`,
  flyerAlert: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.8 9.2C4.2 4.6 6.8 5 8 7.8C9.2 5 11.8 4.6 14.2 9.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 10.5V13.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
  autoWave: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 6L12 12L5 18V6Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M13 6L20 12L13 18V6Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`,
  lanes: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 17C8 17 8 7 12 7C16 7 16 17 20 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="4" cy="17" r="2" fill="currentColor"/>
    <path d="M17.5 14.5L20 17L17.5 19.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  fast: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.5 6L11 12L3.5 18V6Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M12.5 6L20 12L12.5 18V6Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 11V8.2C8 5.9 9.7 4.2 12 4.2C14.3 4.2 16 5.9 16 8.2V11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M6 11H18L19 14V19L17.5 20.5H6.5L5 19V14L6 11Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    <circle cx="12" cy="15.5" r="1.5" fill="${PALETTE.indigo}"/>
  </svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6.5 6.5L17.5 17.5M17.5 6.5L6.5 17.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
  restart: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M18.5 6.5V11.5H13.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M18.2 11.5C17.6 8 14.9 5.5 11.6 5.5C7.9 5.5 5 8.4 5 12C5 15.6 7.9 18.5 11.6 18.5C14.1 18.5 16.2 17.2 17.4 15.2" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
  </svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.5 12L12 4.5L20.5 12M6 10.5V19.5H10V14.5H14V19.5H18V10.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  islands: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3.5L21 8.5L12 13.5L3 8.5L12 3.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M3 13L12 18L21 13M3 17L12 22L21 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  sound: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 9.5H8L13 5.5V18.5L8 14.5H4V9.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M16.5 9C18 10.6 18 13.4 16.5 15M19 6.5C21.7 9.5 21.7 14.5 19 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  meteor: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M19.5 5.5L26.5 12.5M14 8L20 14M20.5 18.5C20.5 22.9 16.9 26.5 12.5 26.5C8.1 26.5 4.5 22.9 4.5 18.5C4.5 14.1 8.1 10.5 12.5 10.5C16.9 10.5 20.5 14.1 20.5 18.5Z" stroke="${PALETTE.indigo}" stroke-width="2" stroke-linecap="round"/>
    <circle cx="12.5" cy="18.5" r="6" fill="${PALETTE.coral}"/>
    <circle cx="11.5" cy="19.5" r="3" fill="${PALETTE.gold}"/>
  </svg>`,
  overcharge: `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M17.5 4L9.5 17H16L13.5 28L23 14.5H16.5L17.5 4Z" fill="${PALETTE.gold}" stroke="${PALETTE.indigo}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M5 10L7.5 12.5M26.5 9L24 11.5M25.5 22.5L23 20" stroke="${PALETTE.coral}" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
};

export const ENEMY_BADGE_META: Record<EnemyType, { label: string; color: string }> = {
  grunt: { label: 'Grunt', color: PALETTE.coral },
  runner: { label: 'Runner', color: PALETTE.gold },
  brute: { label: 'Brute', color: PALETTE.stone },
  flyer: { label: 'Flyer', color: PALETTE.water },
  healer: { label: 'Healer', color: PALETTE.grass },
  splitter: { label: 'Splitter', color: '#e84a7f' },
  warden: { label: 'Warden', color: '#3d5bd9' },
  burrower: { label: 'Burrower', color: PALETTE.dirt },
  carrier: { label: 'Hauler', color: PALETTE.sand },
  blinker: { label: 'Blinker', color: '#2fc9be' },
  golem: { label: 'Golem', color: '#5a5560' },
  mite: { label: 'Mite', color: '#ff8a1f' },
  hexer: { label: 'Hexer', color: '#a63d8f' },
  tempest: { label: 'Colossus', color: '#2f4f86' },
  boss: { label: 'Boss', color: PALETTE.indigo },
  bellrunner: { label: 'Hare', color: '#c98a4b' },
  kilnback: { label: 'Kilnback', color: '#c0643a' },
  reedpiper: { label: 'Piper', color: '#6f8f3a' },
  draftwing: { label: 'Moth', color: '#7a68a0' },
};

/** Tiny faceted enemy glyphs for the wave preview strip (24px grid, ink outline, flat fills). */
export const ENEMY_ICON_SVGS: Record<EnemyType, string> = {
  grunt: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3L19 7L21 14L17 20H7L3 14L5 7L12 3Z" fill="${PALETTE.coral}" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="9" cy="12" r="1.7" fill="${PALETTE.cream}"/><circle cx="15" cy="12" r="1.7" fill="${PALETTE.cream}"/>
  </svg>`,
  runner: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 13L14 5L21 12L14 19L3 13Z" fill="${PALETTE.gold}" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M8 13L14 9M8 13L14 16" stroke="${PALETTE.indigo}" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  brute: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3.5 8L7 4H17L20.5 8V18.5H3.5V8Z" fill="${PALETTE.stone}" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M7.5 10.5H10.5M13.5 10.5H16.5" stroke="${PALETTE.indigo}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M8 15H16" stroke="${PALETTE.indigo}" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  flyer: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 9.5L8 6L12 11.5L16 6L22 9.5L17.5 15L12 19L6.5 15L2 9.5Z" fill="${PALETTE.water}" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="12" cy="12.5" r="1.6" fill="${PALETTE.cream}"/>
  </svg>`,
  healer: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 3.5H16L20.5 8V16L16 20.5H8L3.5 16V8L8 3.5Z" fill="${PALETTE.grass}" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 7.5V16.5M7.5 12H16.5" stroke="${PALETTE.cream}" stroke-width="2.6" stroke-linecap="round"/>
  </svg>`,
  splitter: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 12L10.5 4V20L2.5 12Z" fill="#e84a7f" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M13.5 4L21.5 12L13.5 20V4Z" fill="#e84a7f" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>`,
  warden: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.5L20 5.5V12C20 16.5 16.5 19.8 12 21.5C7.5 19.8 4 16.5 4 12V5.5L12 2.5Z" fill="#3d5bd9" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 6.5V17M8 10H16" stroke="${PALETTE.cream}" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  burrower: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 19L6 11L12 7.5L18 11L21.5 19H2.5Z" fill="${PALETTE.dirt}" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M9.5 12.5L12 9L14.5 12.5" stroke="${PALETTE.cream}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M6 16H8M16 16H18" stroke="${PALETTE.indigo}" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  carrier: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 9.5L8 4H16L18 9.5L16 13H8L6 9.5Z" fill="${PALETTE.sand}" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M9 13L10 16M15 13L14 16" stroke="${PALETTE.indigo}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M8 16H16L15 20.5H9L8 16Z" fill="${PALETTE.gold}" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>`,
  blinker: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.5L19 12L12 21.5L5 12L12 2.5Z" fill="#2fc9be" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M2.5 8.5L4 7M2.5 15.5L4 17M21.5 8.5L20 7M21.5 15.5L20 17" stroke="${PALETTE.indigo}" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="12" cy="12" r="2" fill="${PALETTE.cream}"/>
  </svg>`,
  golem: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 6L9 3H15L19 6L21 13L18 20.5H6L3 13L5 6Z" fill="#5a5560" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M9 3L11 10L8 14M15 3L13 9L17 13" stroke="${PALETTE.gold}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  mite: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 6L17 9V15L12 18L7 15V9L12 6Z" fill="#ff8a1f" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M7 10L3.5 8M7 14L3.5 16M17 10L20.5 8M17 14L20.5 16" stroke="${PALETTE.indigo}" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  hexer: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.5L17 10L19.5 20.5H4.5L7 10L12 2.5Z" fill="#a63d8f" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="12" cy="13.5" r="2.6" fill="${PALETTE.cream}"/><circle cx="12" cy="13.5" r="1.1" fill="${PALETTE.indigo}"/>
  </svg>`,
  tempest: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 20L3 9L8 4H16L21 9L20 20H4Z" fill="#2f4f86" stroke="${PALETTE.gold}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M13.5 6.5L9.5 13H13L10.5 18.5L15.5 11.5H12L13.5 6.5Z" fill="${PALETTE.gold}"/>
  </svg>`,
  boss: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 19L4.5 6L9 11L12 3.5L15 11L19.5 6L21 19H3Z" fill="${PALETTE.indigo}" stroke="${PALETTE.gold}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="9.5" cy="14.5" r="1.5" fill="${PALETTE.gold}"/><circle cx="14.5" cy="14.5" r="1.5" fill="${PALETTE.gold}"/>
  </svg>`,
  bellrunner: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 9L7 2.5L10.5 8M14 8L16 2.5L16.5 9" fill="#c98a4b" stroke="${PALETTE.indigo}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M5 15C5 10.5 8 8 12 8C16 8 19 10.5 19 15C19 18.5 16 20.5 12 20.5C8 20.5 5 18.5 5 15Z" fill="#c98a4b" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="12" cy="17" r="2" fill="${PALETTE.gold}" stroke="${PALETTE.indigo}" stroke-width="1.2"/>
  </svg>`,
  kilnback: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 16C2.5 9.5 7 5.5 12 5.5C17 5.5 21.5 9.5 21.5 16H2.5Z" fill="#c0643a" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M7 16L9 9.5M17 16L15 9.5M9 9.5H15" stroke="${PALETTE.cream}" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M5 16V19.5M19 16V19.5" stroke="${PALETTE.indigo}" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  reedpiper: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 7L18.5 21H5.5L12 7Z" fill="#6f8f3a" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M3.5 7.5H20.5L12 3L3.5 7.5Z" fill="${PALETTE.gold}" stroke="${PALETTE.indigo}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M6 15L19 11" stroke="${PALETTE.cream}" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  draftwing: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 7L3 4.5L4.5 14L12 16L19.5 14L21 4.5L12 7Z" fill="#7a68a0" stroke="${PALETTE.indigo}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 6V20.5" stroke="${PALETTE.cream}" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="7" cy="9" r="1.5" fill="${PALETTE.gold}"/><circle cx="17" cy="9" r="1.5" fill="${PALETTE.gold}"/>
  </svg>`,
};
