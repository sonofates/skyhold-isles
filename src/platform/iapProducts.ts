/**
 * Mobile IAP product catalogue — native store identifiers and product kinds.
 *
 * TODO(owner): Decide the final mobile product line-up, exact store SKUs in App Store Connect and
 * Google Play Console, and regional pricing tiers. Crystal grants live in data/market.ts.
 *
 * Rules enforced here:
 *  - All catalogue entries live in this single file.
 *  - Prices and localized store strings are NEVER hardcoded here; they come from the native store
 *    at runtime (`iap.products()`) or placeholders in injected test stores.
 *  - No ad SDKs are installed anywhere in the project (`remove_ads` is store plumbing only).
 */
import { CRYSTAL_PACK_IDS } from '../data/market.ts';
import { MOBILE_APP_ID } from './mobileConfig.ts';

export type IapProductKind = 'non_consumable' | 'consumable';

// TODO(owner): Confirm or revise placeholder product IDs before creating store entries.
export const IAP_PRODUCT_IDS = ['remove_ads', 'starter_pack', 'full_unlock', ...CRYSTAL_PACK_IDS] as const;

export type IapProductId = (typeof IAP_PRODUCT_IDS)[number];

/** Entitlement identifier that unlocks all campaign islands beyond `FREE_ISLANDS` on mobile. */
export const FULL_UNLOCK_ENTITLEMENT = 'full_unlock';

export interface IapProductDef {
  /** Canonical internal product identifier used by game code (`iap.purchase(id)`, `iap.owned(id)`). */
  readonly id: IapProductId;
  /** Store billing category (`non_consumable` entitlements persist and restore across devices). */
  readonly kind: IapProductKind;
  /**
   * Native App Store / Google Play product identifier (SKU).
   * TODO(owner): Match exact SKUs created in App Store Connect & Google Play Console.
   */
  readonly storeProductId: string;
  /**
   * Entitlement key cached in the save and mapped in RevenueCat.
   * TODO(owner): Match entitlement identifiers configured in the RevenueCat dashboard.
   */
  readonly entitlementId: string;
}

// TODO(owner): Register the SKUs after the app id and store tiers are final.
export const IAP_PRODUCTS: readonly IapProductDef[] = [
  {
    // TODO(owner): Decide whether the free mobile build displays ads at all (no ad SDK included).
    id: 'remove_ads',
    kind: 'non_consumable',
    storeProductId: `${MOBILE_APP_ID}.remove_ads`,
    entitlementId: 'remove_ads',
  },
  {
    // TODO(owner): Decide starter pack contents and whether it remains a one-time non-consumable.
    id: 'starter_pack',
    kind: 'non_consumable',
    storeProductId: `${MOBILE_APP_ID}.starter_pack`,
    entitlementId: 'starter_pack',
  },
  {
    // TODO(owner): Unlocks the full mobile island roster beyond `FREE_ISLANDS`.
    id: 'full_unlock',
    kind: 'non_consumable',
    storeProductId: `${MOBILE_APP_ID}.full_unlock`,
    entitlementId: FULL_UNLOCK_ENTITLEMENT,
  },
  ...CRYSTAL_PACK_IDS.map(id => ({
    id, kind: 'consumable' as const, storeProductId: `${MOBILE_APP_ID}.${id}`, entitlementId: '',
  })),
] as const;

/** Looks up a catalogue entry by internal `id`, `storeProductId`, or `entitlementId`. */
export function findIapProduct(idOrSku: string): IapProductDef | undefined {
  const clean = idOrSku.trim();
  if (!clean) return undefined;
  return IAP_PRODUCTS.find(
    (p) => p.id === clean || p.storeProductId === clean || p.entitlementId === clean,
  );
}
