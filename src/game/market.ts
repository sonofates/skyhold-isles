import { CRYSTAL_PACKS, ITEMS, ITEM_IDS, MARKET_RULES, cleanItemCounts, isItemId, winCrystals, type CrystalPackId, type ItemCounts, type ItemId } from '../data/market.ts';
import type { DifficultyId } from '../data/difficulty.ts';

// Grow-only counters per installation. A cloud merge can retain both purchases and spending
// without restoring used items or double-counting a shared ancestor.
interface MarketCounters {
  earned: number;
  spent: number;
  bought: ItemCounts;
  used: ItemCounts;
}
export interface MarketSave {
  counters: Record<string, MarketCounters>;
  purchaseLedger: Record<string, number>;
  winBonuses: Record<string, number>;
  loadout: ItemId[];
  loadoutRevision: number;
}
export interface MarketWallet {
  crystals: number;
  inventory: Record<ItemId, number>;
  loadout: ItemId[];
}
const MAX_PLAUSIBLE_PRICE_PER_UNIT = 100;
const integer = (n: unknown): number => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n))) : 0;
const record = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
const safeKey = (id: string): boolean =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= 256 &&
  id.trim() === id &&
  id !== '__proto__' &&
  id !== 'prototype' &&
  !Object.hasOwn(Object.prototype, id);
const validBonusKey = (key: string): boolean =>
  (key.startsWith('island:') && key.length > 7) || /^daily:-?\d+$/.test(key);
const emptyCounters = (): MarketCounters => ({ earned: 0, spent: 0, bought: {}, used: {} });

export function sanitizeMarket(raw?: unknown): MarketSave {
  const data = record(raw);
  const loadout = Array.isArray(data.loadout) ? [...new Set(data.loadout.filter(isItemId))].slice(0, MARKET_RULES.slots) : ITEM_IDS.slice(0, MARKET_RULES.slots);
  const counters: MarketSave['counters'] = {};
  for (const [key, value] of Object.entries(record(data.counters))) {
    if (!safeKey(key)) continue;
    const c = record(value);
    const earned = integer(c.earned);
    const bought = cleanItemCounts(c.bought);
    const used = cleanItemCounts(c.used);
    let totalUnitsBought = 0;
    for (const id of ITEM_IDS) totalUnitsBought += bought[id] ?? 0;
    const maxPlausibleSpent = Math.min(Number.MAX_SAFE_INTEGER, totalUnitsBought * MAX_PLAUSIBLE_PRICE_PER_UNIT);
    const spent = Math.min(integer(c.spent), maxPlausibleSpent);
    if (earned === 0 && spent === 0 && totalUnitsBought === 0 && Object.keys(used).length === 0) continue;
    counters[key] = { earned, spent, bought, used };
  }
  const purchaseLedger: Record<string, number> = {};
  for (const [key, amount] of Object.entries(record(data.purchaseLedger))) {
    if (safeKey(key) && typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0) purchaseLedger[key] = amount;
  }
  const winBonuses: Record<string, number> = {};
  for (const [key, value] of Object.entries(record(data.winBonuses))) {
    if (!safeKey(key) || !validBonusKey(key)) continue;
    const cleanVal = integer(value);
    if (cleanVal > 0) winBonuses[key] = cleanVal;
  }
  return { counters, purchaseLedger, winBonuses, loadout, loadoutRevision: integer(data.loadoutRevision) };
}

export function hasMarketActivity(save: MarketSave | undefined): boolean {
  if (!save || typeof save !== 'object' || Array.isArray(save)) return false;
  const clean = sanitizeMarket(save);
  return clean.loadoutRevision > 0 || Object.keys(clean.counters).length > 0 ||
    Object.keys(clean.purchaseLedger).length > 0 || Object.keys(clean.winBonuses).length > 0;
}

export function mergeMarket(a: unknown, b: unknown): MarketSave {
  const left = sanitizeMarket(a);
  const right = sanitizeMarket(b);
  if (right.loadoutRevision > left.loadoutRevision || (right.loadoutRevision === left.loadoutRevision && right.loadout.join() > left.loadout.join())) {
    left.loadout = right.loadout;
    left.loadoutRevision = right.loadoutRevision;
  }
  for (const [writer, c] of Object.entries(right.counters)) {
    const dest = left.counters[writer] ??= emptyCounters();
    dest.earned = Math.max(dest.earned, c.earned);
    dest.spent = Math.max(dest.spent, c.spent);
    for (const key of ['bought', 'used'] as const) {
      for (const id of ITEM_IDS) {
        const count = c[key][id] ?? 0;
        if (count > 0) dest[key][id] = Math.max(dest[key][id] ?? 0, count);
      }
    }
  }
  for (const [tx, amount] of Object.entries(right.purchaseLedger)) {
    // A zero is a receipt retained after an explicit progress reset.
    left.purchaseLedger[tx] = Math.min(left.purchaseLedger[tx] ?? amount, amount);
  }
  for (const [key, bonus] of Object.entries(right.winBonuses)) {
    left.winBonuses[key] = Math.max(left.winBonuses[key] ?? 0, bonus);
  }
  return left;
}

function rawStockOf(save: MarketSave, id: ItemId): number {
  let stock: number = MARKET_RULES.starterCount;
  for (const c of Object.values(save.counters)) {
    stock += (c.bought[id] ?? 0) - (c.used[id] ?? 0);
  }
  return stock;
}

export function marketWallet(save: MarketSave): MarketWallet {
  let crystals: number = MARKET_RULES.starterCrystals;
  const inventory = Object.fromEntries(ITEM_IDS.map(id => [id, MARKET_RULES.starterCount])) as Record<ItemId, number>;
  for (const c of Object.values(save.counters)) {
    crystals += c.earned - c.spent;
    for (const id of ITEM_IDS) inventory[id] += (c.bought[id] ?? 0) - (c.used[id] ?? 0);
  }
  for (const bonus of Object.values(save.winBonuses)) crystals += bonus;
  for (const amount of Object.values(save.purchaseLedger)) crystals += amount;
  for (const id of ITEM_IDS) inventory[id] = Math.min(MARKET_RULES.inventoryCap, integer(inventory[id]));
  return { crystals: integer(crystals), inventory, loadout: [...save.loadout] };
}

export function earnCrystals(save: MarketSave, writer: string, amount: number): void {
  if (!safeKey(writer)) return;
  const gain = integer(amount);
  if (gain <= 0) return;
  (save.counters[writer] ??= emptyCounters()).earned += gain;
}

function awardBonus(save: MarketSave, key: string, amount: number): number {
  const before = save.winBonuses[key] ?? 0;
  save.winBonuses[key] = Math.max(before, integer(amount));
  return save.winBonuses[key] - before;
}

export function awardDailyBonus(save: MarketSave, day: number): number {
  if (!Number.isFinite(day)) return 0;
  return awardBonus(save, `daily:${Math.floor(day)}`, MARKET_RULES.dailyBonus);
}

/** Count each actual win, but deduplicate first-clear and Daily premiums across offline forks. */
export function awardMarketWin(save: MarketSave, writer: string, island: string, stars: number,
  difficulty: DifficultyId, first: boolean, dailyDay: number | null = null): number {
  const repeat = winCrystals(stars, false, difficulty);
  earnCrystals(save, writer, repeat);
  let total = repeat;
  if (first && safeKey(island)) total += awardBonus(save, `island:${island}`, winCrystals(stars, true, difficulty) - repeat);
  if (dailyDay !== null && Number.isFinite(dailyDay)) total += awardDailyBonus(save, dailyDay);
  return total;
}

export function buyItem(save: MarketSave, writer: string, id: ItemId): boolean {
  if (!safeKey(writer) || !isItemId(id)) return false;
  const wallet = marketWallet(save);
  if (wallet.crystals < ITEMS[id].price || wallet.inventory[id] >= MARKET_RULES.inventoryCap) return false;
  const rawStock = rawStockOf(save, id);
  const c = save.counters[writer] ??= emptyCounters();
  c.spent += ITEMS[id].price;
  c.bought[id] = (c.bought[id] ?? 0) + (rawStock < 0 ? 1 - rawStock : 1);
  return true;
}

export function setLoadout(save: MarketSave, ids: readonly ItemId[]): boolean {
  if (!Array.isArray(ids) || ids.length > MARKET_RULES.slots || new Set(ids).size !== ids.length || !ids.every(isItemId)) return false;
  save.loadout = [...ids];
  save.loadoutRevision++;
  return true;
}

export function startItemBelt(wallet: MarketWallet, difficulty: DifficultyId, disabled: boolean): ItemCounts {
  if (disabled) return {};
  return Object.fromEntries(wallet.loadout.map(id => [id, Math.min(wallet.inventory[id], MARKET_RULES.useCap[difficulty])]));
}

export function consumeItem(save: MarketSave, writer: string, id: ItemId): boolean {
  if (!safeKey(writer) || !isItemId(id) || marketWallet(save).inventory[id] < 1) return false;
  const c = save.counters[writer] ??= emptyCounters();
  c.used[id] = (c.used[id] ?? 0) + 1;
  return true;
}

/** Returns false for malformed receipts; duplicate store deliveries are successful no-ops. */
export function grantCrystalPack(save: MarketSave, pack: CrystalPackId, transactionId: string): boolean {
  if (!safeKey(transactionId) || !Object.hasOwn(CRYSTAL_PACKS, pack)) return false;
  save.purchaseLedger[transactionId] ??= CRYSTAL_PACKS[pack];
  return true;
}
