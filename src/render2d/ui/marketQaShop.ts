/**
 * QA only (loaded from worldMap.ts behind `import.meta.env.DEV`, so production builds never contain
 * it): a stand-in crystal store for the Market's mobile section in a desktop browser.
 * `?iapqa=1` lists the three packs and delivers on Buy; `pending` / `cancel` / `error` / `empty`
 * force that outcome. Prices are labelled placeholders, never real store prices.
 */
import { CRYSTAL_PACK_IDS, type CrystalPackId } from '../../data/market.ts';
import type { IapPurchaseResult, IapStoreProduct } from '../../platform/iap.ts';
import { deliverPacks2D } from './market2d.ts';
import type { CrystalShop } from './marketScreen.ts';

const QA_PRICES: Record<CrystalPackId, string> = { crystals_small: '$0.99', crystals_medium: '$2.99', crystals_large: '$5.99' };
const QA_TITLES: Record<CrystalPackId, string> = { crystals_small: 'Pouch of Sky Crystals', crystals_medium: 'Chest of Sky Crystals', crystals_large: 'Hoard of Sky Crystals' }; // i18n-ignore (store-provided titles, QA stand-in)

export function qaShop(mode: string): CrystalShop {
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  return {
    enabled: () => true,
    async list(): Promise<IapStoreProduct[]> {
      await wait(150);
      if (mode === 'empty') return [];
      return CRYSTAL_PACK_IDS.map((id) => ({ id, storeProductId: `qa.${id}`, kind: 'consumable', title: QA_TITLES[id], description: '', priceString: QA_PRICES[id], currencyCode: 'USD' }));
    },
    async purchase(id: CrystalPackId): Promise<IapPurchaseResult> {
      await wait(mode === 'slow' ? 60000 : 400);
      const fail = (status: IapPurchaseResult['status']): IapPurchaseResult => ({ ok: false, status, productId: id, entitlements: [] });
      if (mode === 'pending') return fail('pending_delivery');
      if (mode === 'cancel') return fail('cancelled');
      if (mode === 'error') return fail('error');
      const ok = deliverPacks2D([{ pack: id, transactionId: `qa-${Date.now()}-${Math.random().toString(36).slice(2)}` }]);
      return ok ? { ok: true, status: 'purchased', productId: id, entitlements: [] } : fail('pending_delivery');
    },
    async restore() {
      await wait(300);
      return { ok: mode !== 'error' };
    },
  };
}
