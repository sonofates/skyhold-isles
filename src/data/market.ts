import type { DifficultyId } from './difficulty.ts';

export const ITEM_IDS = ['emberPot', 'frostLantern', 'heartstone', 'skyPurse', 'cloudguard', 'galeBell'] as const;
export type ItemId = typeof ITEM_IDS[number];
export type ItemCounts = Partial<Record<ItemId, number>>;
export const isItemId = (value: unknown): value is ItemId => ITEM_IDS.some(id => id === value);

export const ITEMS = {
  emberPot: { price: 12, target: 'point', radius: 3.4, meteorFraction: 0.80, burnSeconds: 2, burnDamage: 16 },
  frostLantern: { price: 11, target: 'point', radius: 3.6, seconds: 4, eliteSlow: 0.5, markVuln: 0.30 },
  heartstone: { price: 22, target: 'self', lives: 5 },
  skyPurse: { price: 16, target: 'self', startingGoldFraction: 0.15, goldPerWave: 5 },
  cloudguard: {
    price: 11,
    target: 'road',
    soldiers: 3,
    seconds: 15,
    snapRadius: 1.4,
    soldierHp: 170,
    soldierDamage: 20,
    soldierArmor: 3,
    soldierHoldCap: 2,
    waveScale: 0.05,
  },
  galeBell: { price: 14, target: 'self', distance: 6.5, bossDistance: 2.2 },
} as const;

export const MARKET_RULES = {
  starterCrystals: 28, starterCount: 1, inventoryCap: 99, slots: 3,
  useCap: { easy: 3, normal: 3, hard: 1 },
  baseWin: 14, perStar: 4, firstClear: 20, repeatMultiplier: 0.35, dailyBonus: 18,
  difficulty: { easy: 0.75, normal: 1, hard: 1.35 },
} as const;

export function winCrystals(stars: number, firstClear: boolean, difficulty: DifficultyId, countedDaily = false): number {
  const awarded = Number.isFinite(stars) ? Math.min(3, Math.max(1, Math.floor(stars))) : 1;
  const base = MARKET_RULES.baseWin + MARKET_RULES.perStar * awarded;
  const regular = firstClear ? base + MARKET_RULES.firstClear : base * MARKET_RULES.repeatMultiplier;
  return Math.round(regular * MARKET_RULES.difficulty[difficulty]) + (countedDaily ? MARKET_RULES.dailyBonus : 0);
}

export const CRYSTAL_PACK_IDS = ['crystals_small', 'crystals_medium', 'crystals_large'] as const;
export type CrystalPackId = typeof CRYSTAL_PACK_IDS[number];
export const CRYSTAL_PACKS: Record<CrystalPackId, number> = { crystals_small: 80, crystals_medium: 260, crystals_large: 600 };
export const isCrystalPack = (value: unknown): value is CrystalPackId => CRYSTAL_PACK_IDS.some(id => id === value);

export function cleanItemCounts(raw: unknown, cap = Number.MAX_SAFE_INTEGER): ItemCounts {
  const out: ItemCounts = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of ITEM_IDS) {
    const n = (raw as ItemCounts)[id];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 1) out[id] = Math.min(cap, Math.floor(n));
  }
  return out;
}
