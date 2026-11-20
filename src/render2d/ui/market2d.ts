import type { DifficultyId } from '../../data/difficulty.ts';
import type { CrystalPackId, ItemCounts, ItemId } from '../../data/market.ts';
import { buyItem, consumeItem, grantCrystalPack, marketWallet, sanitizeMarket, setLoadout, startItemBelt, type MarketSave, type MarketWallet } from '../../game/market.ts';
import { marketWriter } from '../../platform/marketWriter.ts';
import { loadProgress2D, saveProgress2D } from './progress2d.ts';

export function readMarket2D(): MarketWallet {
  return marketWallet(loadProgress2D().market ?? sanitizeMarket());
}

function updateMarket(change: (save: MarketSave) => boolean): boolean {
  const progress = loadProgress2D();
  const market = progress.market ??= sanitizeMarket();
  return change(market) && saveProgress2D(progress);
}

export function buyItem2D(id: ItemId): boolean {
  return updateMarket(save => buyItem(save, marketWriter(), id));
}

export function setLoadout2D(ids: readonly ItemId[]): boolean {
  return updateMarket(save => setLoadout(save, ids));
}

export function runItemBelt2D(difficulty: DifficultyId, disabled: boolean): ItemCounts {
  return startItemBelt(readMarket2D(), difficulty, disabled);
}

export function spendItem2D(id: ItemId): boolean {
  return updateMarket(save => consumeItem(save, marketWriter(), id));
}

/** Applies verified store transactions together with their credit in one persisted write. */
export function deliverPacks2D(receipts: readonly { pack: CrystalPackId; transactionId: string }[]): boolean {
  const progress = loadProgress2D();
  const save = progress.market ??= sanitizeMarket();
  let changed = false;
  for (const { pack, transactionId } of receipts) {
    if (typeof transactionId !== 'string' || !transactionId) return false;
    if (Object.hasOwn(save.purchaseLedger, transactionId)) continue;
    if (!grantCrystalPack(save, pack, transactionId)) return false;
    changed = true;
  }
  return !changed || saveProgress2D(progress);
}
