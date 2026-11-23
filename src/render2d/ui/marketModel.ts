/**
 * Pure view-models of the Market screen and the in-run item belt (no DOM, no save access): the
 * screens read the wallet / the live belt through the market API (docs/market.md) and turn it into
 * these rows. Every number (prices, caps, slot count) comes from src/data/market.ts.
 */
import type { DifficultyId } from '../../data/difficulty.ts';
import { ITEM_IDS, ITEMS, MARKET_RULES, type ItemCounts, type ItemId } from '../../data/market.ts';
import type { MarketWallet } from '../../game/market.ts';

/** Keyboard keys of the belt slots, in slot order (free in the run: 1/2/3 speed, Q/W abilities, E/R/H hero, N horn). */
export const ITEM_KEYS = ['Z', 'X', 'C'] as const;

export type ItemTarget = (typeof ITEMS)[ItemId]['target'];

export function itemTarget(id: ItemId): ItemTarget {
  return ITEMS[id].target;
}

/** Item icon (`@2x` for the HUD / cards; the art is 128² / 256²). */
export function itemIconUrl(id: ItemId, density: 1 | 2 = 2): string {
  return `/art2d/items/${id}@${density}x.webp`;
}

export const CRYSTAL_ICON = '/art2d/market/skyCrystal.webp';
export const CRYSTAL_ICON_LARGE = '/art2d/market/skyCrystal-large.webp';
export const MARKET_STALL = '/art2d/market/stall.webp';

// --- Market screen ----------------------------------------------------------------------------

export type BuyBlock = 'short' | 'full' | null;

export interface MarketCard {
  readonly id: ItemId;
  readonly price: number;
  readonly owned: number;
  readonly target: ItemTarget;
  /** Why Buy ×1 is off (null = can buy). */
  readonly block: BuyBlock;
  /** Buy ×5 possible (crystals and room for five). */
  readonly canBuy5: boolean;
  /** Belt slot index (0-based) or -1. */
  readonly slot: number;
  /** Can be put on the belt now (not equipped, a slot free). */
  readonly canEquip: boolean;
}

export interface MarketView {
  readonly crystals: number;
  readonly cards: readonly MarketCard[];
  /** Belt slots in order (null = empty), always `MARKET_RULES.slots` long. */
  readonly slots: readonly (ItemId | null)[];
  readonly slotCount: number;
  readonly beltFull: boolean;
  readonly useCap: typeof MARKET_RULES.useCap;
}

export function buyBlock(wallet: Pick<MarketWallet, 'crystals' | 'inventory'>, id: ItemId, n = 1): BuyBlock {
  if ((wallet.inventory[id] ?? 0) + n > MARKET_RULES.inventoryCap) return 'full';
  if (wallet.crystals < ITEMS[id].price * n) return 'short';
  return null;
}

export function marketView(wallet: MarketWallet): MarketView {
  const slotCount = MARKET_RULES.slots;
  const loadout = wallet.loadout.slice(0, slotCount);
  const beltFull = loadout.length >= slotCount;
  const cards = ITEM_IDS.map((id): MarketCard => {
    const slot = loadout.indexOf(id);
    return {
      id,
      price: ITEMS[id].price,
      owned: wallet.inventory[id] ?? 0,
      target: ITEMS[id].target,
      block: buyBlock(wallet, id),
      canBuy5: buyBlock(wallet, id, 5) === null,
      slot,
      canEquip: slot === -1 && !beltFull,
    };
  });
  const slots: (ItemId | null)[] = [];
  for (let i = 0; i < slotCount; i++) slots.push(loadout[i] ?? null);
  return {
    crystals: wallet.crystals,
    cards,
    slots,
    slotCount,
    beltFull,
    useCap: MARKET_RULES.useCap,
  };
}

/**
 * The loadout after tapping an item: off the belt if on it (the others close up), else onto the
 * first free slot. Null when the belt is full (the screen says so instead of swapping silently).
 */
export function toggleLoadout(loadout: readonly ItemId[], id: ItemId, slots: number = MARKET_RULES.slots): ItemId[] | null {
  const cur = loadout.slice(0, slots);
  if (cur.includes(id)) return cur.filter((x) => x !== id);
  if (cur.length >= slots) return null;
  return [...cur, id];
}

/** Puts `id` into slot `i` (briefing slot picker): replaces what was there, moves `id` if it was elsewhere, null clears. */
export function placeInSlot(loadout: readonly ItemId[], i: number, id: ItemId | null, slots: number = MARKET_RULES.slots): ItemId[] {
  const cells: (ItemId | null)[] = [];
  for (let k = 0; k < slots; k++) cells.push(loadout[k] ?? null);
  if (i < 0 || i >= slots) return loadout.slice(0, slots);
  if (id) {
    const from = cells.indexOf(id);
    if (from !== -1) cells[from] = null;
  }
  cells[i] = id;
  return cells.filter((x): x is ItemId => x !== null);
}

/** Uses per item a run on `difficulty` starts with (the smaller of stock and the cap). */
export function usesFor(difficulty: DifficultyId, owned: number): number {
  return Math.max(0, Math.min(owned, MARKET_RULES.useCap[difficulty]));
}

// --- in-run belt -------------------------------------------------------------------------------

export type BeltState = 'ready' | 'disabled' | 'waiting' | 'reserve' | 'empty' | 'full' | 'noFoes' | 'over' | 'paused';

export interface BeltRunState {
  /** Items off for this run (challenges, Daily, Endless; or abilities off). */
  readonly disabled: boolean;
  /** Before the first horn. */
  readonly preFirstWave: boolean;
  readonly ended: boolean;
  readonly paused: boolean;
  readonly replaying: boolean;
  readonly lives: number;
  readonly livesUntilNextUse: number;
  readonly heartstoneCeiling: number;
  /** Living enemies on the field (Gale Bell needs one). */
  readonly enemies: number;
}

export interface BeltSlotView {
  readonly id: ItemId;
  readonly key: string;
  /** Uses left on this island. */
  readonly uses: number;
  /** Stock in the save (pack). */
  readonly owned: number;
  readonly target: ItemTarget;
  readonly state: BeltState;
}

/**
 * The slots the belt shows: the run's starting belt (its order is the loadout's), or the saved
 * loadout greyed when the run allows no items (so the player sees why).
 */
export function beltIds(initial: ItemCounts, loadout: readonly ItemId[]): ItemId[] {
  const fromRun = ITEM_IDS.filter((id) => initial[id] !== undefined);
  const ordered = loadout.filter((id) => fromRun.includes(id));
  for (const id of fromRun) if (!ordered.includes(id)) ordered.push(id);
  return (ordered.length > 0 ? ordered : loadout.slice()).slice(0, MARKET_RULES.slots);
}

export function beltSlotState(id: ItemId, uses: number, run: BeltRunState): BeltState {
  if (run.disabled || run.replaying) return 'disabled';
  if (run.ended) return 'over';
  if (uses <= 0) return 'empty';
  if (run.preFirstWave) return 'waiting';
  if (run.paused) return 'paused';
  if (run.livesUntilNextUse > 0) return 'reserve';
  if (id === 'heartstone' && run.lives >= run.heartstoneCeiling) return 'full';
  if (id === 'galeBell' && run.enemies <= 0) return 'noFoes';
  return 'ready';
}

export function beltView(ids: readonly ItemId[], belt: ItemCounts, inventory: Partial<Record<ItemId, number>>, run: BeltRunState): BeltSlotView[] {
  return ids.map((id, i) => {
    const uses = run.disabled ? 0 : (belt[id] ?? 0);
    const owned = inventory[id] ?? 0;
    return { id, key: ITEM_KEYS[i] ?? '', uses, owned, target: ITEMS[id].target, state: beltSlotState(id, uses, run) };
  });
}

/** i18n key of a slot's state line (tooltip / aria). */
export function beltStateKey(s: Pick<BeltSlotView, 'state' | 'owned'>): string {
  switch (s.state) {
    case 'ready':
      return 'item.ready';
    case 'disabled':
      return 'market.disabled';
    case 'waiting':
      return 'item.waiting';
    case 'reserve':
      return 'item.reserve';
    case 'empty':
      return s.owned <= 0 ? 'item.outOfStock' : 'item.empty';
    case 'full':
      return 'item.full';
    case 'noFoes':
      return 'item.noFoes';
    case 'over':
      return 'item.over';
    case 'paused':
      return 'item.paused';
  }
}

/** Does pressing the slot start aiming (targeted), cast at once (self) or refuse (nudge)? */
export function beltPress(s: Pick<BeltSlotView, 'state' | 'target'>): 'aim' | 'cast' | 'refuse' {
  if (s.state !== 'ready') return 'refuse';
  return s.target === 'self' ? 'cast' : 'aim';
}

/** Which slot a key press picks (Z / X / C), or -1. */
export function beltKeyIndex(key: string, count: number): number {
  const i = (ITEM_KEYS as readonly string[]).indexOf(key.toUpperCase());
  return i >= 0 && i < count ? i : -1;
}

// --- dock -----------------------------------------------------------------------------------------

/** First-time "new: Market" badge on the world map (shown until the Market is opened once). */
export const MARKET_SEEN_KEY = 'skyhold_market_seen_v1';

export function marketSeen(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(MARKET_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markMarketSeen(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(MARKET_SEEN_KEY, '1');
  } catch {
    /* private mode: the badge shows again next time, nothing else */
  }
}
