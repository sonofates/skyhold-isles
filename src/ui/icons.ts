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
};

export const ENEMY_BADGE_META: Record<EnemyType, { label: string; color: string }> = {
  grunt: { label: 'Grunt', color: PALETTE.coral },
  runner: { label: 'Runner', color: PALETTE.gold },
  brute: { label: 'Brute', color: PALETTE.stone },
  flyer: { label: 'Flyer', color: PALETTE.water },
  healer: { label: 'Healer', color: PALETTE.grass },
  boss: { label: 'Boss', color: PALETTE.indigo },
};
