import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CustomerInfo, PurchasesStoreProduct } from '@revenuecat/purchases-capacitor';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { clearedIslandsCount2D, isHeroUnlocked } from '../../src/render2d/heroes2d.ts';
import { availableChallenges, canPlayEndless, dailyForToday } from '../../src/render2d/ui/modes2d.ts';
import {
  createIapStore,
  createMockIapBackend,
  createPlatformAdapter,
  createRevenueCatBridge,
  extractEntitlementsFromCustomerInfo,
  FREE_ISLANDS,
  IAP_PRODUCT_IDS,
  IAP_PRODUCTS,
  IAP_SAVE_KEY,
  isIapMockEnabled,
  isUnlocked,
  MOBILE_APP_ID,
  setIapStore,
  setPlatformAdapter,
  type CloudStorageLike,
  type MobileBridge,
  type NativePurchasesBridge,
} from '../../src/platform/index.ts';
import { createDefaultProgress, resetProgressSave } from '../../src/platform/storage.ts';

const ROOT = resolve(import.meta.dirname, '../..');

function createMemStorage(): CloudStorageLike & {
  readonly map: Map<string, string>;
  deleteKey(key: string): void;
} {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    deleteKey: (k) => void map.delete(k),
  };
}

function createMobilePlatform(os: 'ios' | 'android' = 'android') {
  const mobile: MobileBridge = {
    isNative: true,
    platform: os,
    triggerHaptic: async () => true,
    onAppStateChange: () => () => undefined,
  };
  return createPlatformAdapter({ bridge: null, mobile });
}

describe('IAP store adapter: web & Steam no-op', () => {
  afterEach(() => {
    setPlatformAdapter(null);
    setIapStore(null);
  });

  it('is a complete no-op on web (without ?iapmock=1) and on Steam (even with ?iapmock=1)', async () => {
    const storage = createMemStorage();
    storage.setItem(IAP_SAVE_KEY, JSON.stringify({ version: 1, entitlements: ['full_unlock'], updatedAt: 1 }));

    const webPlatform = createPlatformAdapter({ bridge: null, mobile: null, storage });
    const webStore = createIapStore({ platform: webPlatform, storage, locationSearch: '' });
    expect(webStore.mode).toBe('noop');
    expect(await webStore.products()).toEqual([]);
    expect(webStore.owned('full_unlock')).toBe(false);
    expect(webStore.entitlements().size).toBe(0);
    expect(await webStore.purchase('full_unlock')).toEqual({
      ok: false,
      status: 'unavailable',
      productId: 'full_unlock',
      entitlements: [],
    });
    expect(await webStore.restore()).toEqual({ ok: true, restored: [], entitlements: [] });

    // Steam is a paid full game: ?iapmock=1 must never enable IAPs on Steam.
    const steamPlatform = createPlatformAdapter({
      storage,
      bridge: {
        isSteam: true,
        unlockAchievement: async () => true,
        cloudRead: async () => null,
        cloudWrite: async () => true,
      },
    });
    const steamStore = createIapStore({
      platform: steamPlatform,
      storage,
      locationSearch: '?iapmock=1',
    });
    expect(steamStore.mode).toBe('noop');
    expect(steamStore.owned('full_unlock')).toBe(false);

    // Standalone Electron desktop (Steam client closed -> isSteam=false, isDesktop=true) is also a paid full game.
    const standaloneDesktopPlatform = createPlatformAdapter({
      storage,
      bridge: {
        isSteam: false,
        unlockAchievement: async () => false,
        cloudRead: async () => null,
        cloudWrite: async () => false,
      },
    });
    const standaloneDesktopStore = createIapStore({
      platform: standaloneDesktopPlatform,
      storage,
      locationSearch: '?iapmock=1',
    });
    expect(standaloneDesktopStore.mode).toBe('noop');
    expect(standaloneDesktopStore.owned('full_unlock')).toBe(false);

    // Truncated legacy array IAP_SAVE_KEY still preserves earlier full_unlock entitlement on mobile.
    const legacyTruncStorage = createMemStorage();
    legacyTruncStorage.setItem(IAP_SAVE_KEY, '["full_unlock","starter_pa');
    const mobileStore = createIapStore({
      platform: createMobilePlatform('ios'),
      storage: legacyTruncStorage,
    });
    expect(mobileStore.owned('full_unlock')).toBe(true);
  });

  it('detects ?iapmock=1 in browser query strings and activates mock mode on web', async () => {
    expect(isIapMockEnabled('')).toBe(false);
    expect(isIapMockEnabled('?level=l1c')).toBe(false);
    expect(isIapMockEnabled('?iapmock=0')).toBe(false);
    expect(isIapMockEnabled('?level=l1c&iapmock=1')).toBe(true);

    const webPlatform = createPlatformAdapter({ bridge: null, mobile: null });
    const store = createIapStore({
      platform: webPlatform,
      storage: createMemStorage(),
      locationSearch: '?iapmock=1',
    });
    expect(store.mode).toBe('mock');
    expect((await store.products()).map((p) => p.id)).toEqual([...IAP_PRODUCT_IDS]);
  });
});

describe('IAP store adapter: mock store (purchase, restore, owned, save cache survives reload)', () => {
  it('purchases products, caches entitlements in the save, and survives reload offline', async () => {
    const storage = createMemStorage();
    const backend = createMockIapBackend({ ledgerStorage: storage, now: () => 1700000000000 });
    const store1 = createIapStore({
      mode: 'mock',
      storage,
      mockBackend: backend,
      now: () => 1700000000000,
    });

    const products = await store1.products();
    expect(products.map((p) => p.id)).toEqual(['remove_ads', 'starter_pack', 'full_unlock']);
    // Catalogue must not invent real prices.
    for (const p of products) {
      expect(p.priceString).toBe('MOCK');
      expect(p.currencyCode).toBe('XXX');
    }

    expect(store1.owned('full_unlock')).toBe(false);
    expect(store1.owned('remove_ads')).toBe(false);

    const res = await store1.purchase('full_unlock');
    expect(res).toEqual({
      ok: true,
      status: 'purchased',
      productId: 'full_unlock',
      entitlements: ['full_unlock'],
    });
    expect(store1.owned('full_unlock')).toBe(true);
    expect(store1.owned(`${MOBILE_APP_ID}.full_unlock`)).toBe(true);
    expect(store1.owned('remove_ads')).toBe(false);

    // Simulate a fresh page reload / cold offline boot with a brand-new mock backend (empty remote)
    // sharing only the persisted local save storage: cached entitlement survives reload immediately.
    const freshOfflineBackend = createMockIapBackend();
    const storeAfterReload = createIapStore({
      mode: 'mock',
      storage,
      mockBackend: freshOfflineBackend,
    });
    expect(storeAfterReload.owned('full_unlock')).toBe(true);
    expect([...storeAfterReload.entitlements()]).toEqual(['full_unlock']);
  });

  it('restores remote entitlements when local save cache was cleared (reinstall / new device)', async () => {
    const storage = createMemStorage();
    const backend = createMockIapBackend({
      initialOwned: ['remove_ads', 'starter_pack'],
    });

    // Fresh install: local save has nothing yet, so owned() is false before restore().
    const store = createIapStore({ mode: 'mock', storage, mockBackend: backend });
    expect(store.owned('remove_ads')).toBe(false);
    expect(store.owned('starter_pack')).toBe(false);

    const restored = await store.restore();
    expect(restored).toEqual({
      ok: true,
      restored: ['remove_ads', 'starter_pack'],
      entitlements: ['remove_ads', 'starter_pack'],
    });
    expect(store.owned('remove_ads')).toBe(true);
    expect(store.owned('starter_pack')).toBe(true);

    // Second restore reports 0 newly restored items since they are already cached.
    const secondRestore = await store.restore();
    expect(secondRestore).toEqual({
      ok: true,
      restored: [],
      entitlements: ['remove_ads', 'starter_pack'],
    });

    // Wipe the local entitlement save key and reload with ?iapmock=1 ledger storage.
    const sharedStorage = createMemStorage();
    const browserMock1 = createIapStore({
      mode: 'mock',
      storage: sharedStorage,
    });
    await browserMock1.purchase('full_unlock');
    sharedStorage.deleteKey(IAP_SAVE_KEY);

    const browserMock2 = createIapStore({
      mode: 'mock',
      storage: sharedStorage,
    });
    expect(browserMock2.owned('full_unlock')).toBe(false);
    const browserRestored = await browserMock2.restore();
    expect(browserRestored.ok).toBe(true);
    expect(browserRestored.restored).toEqual(['full_unlock']);
    expect(browserMock2.owned('full_unlock')).toBe(true);
  });

  it('handles unknown products, user cancellation, billing errors, corrupted saves, and progress resets', async () => {
    const storage = createMemStorage();
    storage.setItem(IAP_SAVE_KEY, '{not-valid-json');
    const backend = createMockIapBackend();
    const store = createIapStore({ mode: 'mock', storage, mockBackend: backend });

    expect(store.owned('full_unlock')).toBe(false);

    // Unknown product ID rejected cleanly.
    const unknown = await store.purchase('nonexistent_gem_pack');
    expect(unknown.ok).toBe(false);
    expect(unknown.status).toBe('unknown_product');

    // User cancellation does not grant entitlement.
    backend.setNextPurchaseOutcome('cancelled');
    const cancelled = await store.purchase('starter_pack');
    expect(cancelled).toEqual({
      ok: false,
      status: 'cancelled',
      productId: 'starter_pack',
      entitlements: [],
    });
    expect(store.owned('starter_pack')).toBe(false);

    // Store error surfaces error message without mutating entitlements.
    backend.setNextPurchaseOutcome('error', 'Billing service disconnected');
    const failed = await store.purchase('starter_pack');
    expect(failed.ok).toBe(false);
    expect(failed.status).toBe('error');
    expect(failed.error).toBe('Billing service disconnected');

    // Successful purchase persists and survives Settings -> Reset Progress.
    await store.purchase('full_unlock');
    const g = globalThis as unknown as { localStorage?: Storage };
    const prevLs = g.localStorage;
    g.localStorage = {
      getItem: (k) => storage.getItem(k),
      setItem: (k, v) => storage.setItem(k, v),
      removeItem: (k) => storage.deleteKey(k),
      clear: () => storage.map.clear(),
      key: () => null,
      length: 0,
    };
    try {
      resetProgressSave(16);
      const reloaded = createIapStore({ mode: 'mock', storage, mockBackend: createMockIapBackend() });
      expect(reloaded.owned('full_unlock')).toBe(true);
    } finally {
      g.localStorage = prevLs;
    }
  });
});

describe('IAP store adapter: native RevenueCat bridge', () => {
  it('degrades gracefully when RevenueCat public SDK keys are still blank (TODO owner)', async () => {
    const platform = createMobilePlatform('ios');
    const unconfiguredBridge = createRevenueCatBridge({
      mobilePlatform: 'ios',
      apiKeys: { ios: '', android: '' },
    });
    const store = createIapStore({
      platform,
      storage: createMemStorage(),
      nativeBridge: unconfiguredBridge,
    });

    expect(store.mode).toBe('native');
    expect(unconfiguredBridge.isConfigured()).toBe(false);
    expect(await store.products()).toEqual([]);
    const res = await store.purchase('full_unlock');
    expect(res.ok).toBe(false);
    expect(res.status).toBe('unavailable');
    const restoreRes = await store.restore();
    expect(restoreRes.ok).toBe(false);
  });

  it('maps native StoreProducts, CustomerInfo entitlements, user cancellation, and restorePurchases', async () => {
    const storage = createMemStorage();
    const platform = createMobilePlatform('android');
    let throwCancelNext = false;

    const fakeStoreProduct = {
      identifier: `${MOBILE_APP_ID}.full_unlock`,
      title: 'Full Campaign Unlock',
      description: 'All Skyhold Isles maps',
      price: 4.99,
      priceString: '$4.99',
      currencyCode: 'USD',
    } as unknown as PurchasesStoreProduct;

    const makeCustomerInfo = (entIds: string[]): CustomerInfo =>
      ({
        entitlements: {
          active: Object.fromEntries(
            entIds.map((id) => [id, { identifier: id, isActive: true }]),
          ),
          all: {},
        },
        allPurchasedProductIdentifiers: entIds.map((id) => `${MOBILE_APP_ID}.${id}`),
      }) as unknown as CustomerInfo;

    const nativeBridge: NativePurchasesBridge = {
      isConfigured: () => true,
      ensureConfigured: async () => ({ ok: true }),
      getProducts: async () => [fakeStoreProduct],
      purchaseStoreProduct: async () => {
        if (throwCancelNext) {
          throwCancelNext = false;
          throw { userCancelled: true, message: 'User pressed back' };
        }
        return { customerInfo: makeCustomerInfo(['full_unlock']) };
      },
      restorePurchases: async () => ({
        customerInfo: makeCustomerInfo(['remove_ads', 'full_unlock']),
      }),
    };

    const store = createIapStore({ platform, storage, nativeBridge });
    const prods = await store.products();
    expect(prods).toEqual([
      {
        id: 'full_unlock',
        storeProductId: `${MOBILE_APP_ID}.full_unlock`,
        kind: 'non_consumable',
        title: 'Full Campaign Unlock',
        description: 'All Skyhold Isles maps',
        priceString: '$4.99',
        currencyCode: 'USD',
      },
    ]);

    // User cancellation maps to status='cancelled' (not 'error').
    throwCancelNext = true;
    const cancelled = await store.purchase('full_unlock');
    expect(cancelled.status).toBe('cancelled');
    expect(store.owned('full_unlock')).toBe(false);

    // Purchase succeeds and caches entitlement in save storage.
    const bought = await store.purchase('full_unlock');
    expect(bought.ok).toBe(true);
    expect(bought.status).toBe('purchased');
    expect(store.owned('full_unlock')).toBe(true);

    // Restore pulls additional native entitlements ('remove_ads') into the save cache.
    const restored = await store.restore();
    expect(restored.ok).toBe(true);
    expect(restored.restored).toEqual(['remove_ads']);
    expect(store.owned('remove_ads')).toBe(true);
    expect(store.owned('full_unlock')).toBe(true);
  });

  it('normalizes stored SKU caches, honors custom catalogues, and rejects malformed entitlement tokens in memory', async () => {
    const storage = createMemStorage();
    // Simulate an older cache that stored the full store SKU instead of canonical entitlementId.
    storage.setItem(
      IAP_SAVE_KEY,
      JSON.stringify({ version: 1, entitlements: [`${MOBILE_APP_ID}.full_unlock`, 'bad token!'], updatedAt: 1 }),
    );
    const customCatalogue = [
      ...IAP_PRODUCTS,
      {
        id: 'full_unlock' as const,
        kind: 'non_consumable' as const,
        storeProductId: 'custom.sku.expansion',
        entitlementId: 'custom_expansion_ent',
      },
    ];
    const mockBackend = createMockIapBackend({
      catalogue: customCatalogue,
      initialOwned: ['custom.sku.expansion', 'unsafe spaces!'],
      ledgerStorage: storage,
    });
    const store = createIapStore({
      mode: 'mock',
      storage,
      catalogue: customCatalogue,
      mockBackend,
    });

    // Stored SKU was normalized on boot to 'full_unlock', and 'bad token!' was rejected.
    expect(store.owned('full_unlock')).toBe(true);
    expect(store.owned('bad token!')).toBe(false);

    // Custom catalogue SKU mapped cleanly to 'custom_expansion_ent' and unsafe token was rejected in memory too.
    const res = await store.restore();
    expect(res.ok).toBe(true);
    expect(store.owned('custom_expansion_ent')).toBe(true);
    expect(store.entitlements().has('unsafe spaces!')).toBe(false);

    const extracted = extractEntitlementsFromCustomerInfo(
      {
        entitlements: {
          active: {
            'custom.sku.expansion': { isActive: true } as never,
            'bad id!': { isActive: true } as never,
          },
          all: {},
          verification: 'NOT_REQUESTED' as never,
        },
        allPurchasedProductIdentifiers: ['custom.sku.expansion'],
      },
      customCatalogue,
    );
    expect(extracted).toEqual(['custom_expansion_ent']);
  });
});

describe('Free-version scope gate (FREE_ISLANDS + isUnlocked) & catalogue invariants', () => {
  it('sets FREE_ISLANDS to the first 6 islands of LEVELS_2D', () => {
    expect(FREE_ISLANDS).toHaveLength(6);
    expect(FREE_ISLANDS).toEqual(LEVELS_2D.slice(0, 6).map((l) => l.id));
    expect(FREE_ISLANDS).toEqual(['l1c', 'i01', 'i02', 'i03', 'i04', 'i05']);
  });

  it('gates non-free islands until full_unlock is present in entitlements', () => {
    const empty: readonly string[] = [];
    for (const id of FREE_ISLANDS) {
      expect(isUnlocked(id, empty)).toBe(true);
    }

    const lockedIslands = LEVELS_2D.slice(6).map((l) => l.id);
    expect(lockedIslands.length).toBeGreaterThan(0);
    for (const id of lockedIslands) {
      expect(isUnlocked(id, empty)).toBe(false);
      // Other IAPs (remove_ads, starter_pack) do not unlock paid campaign islands.
      expect(isUnlocked(id, ['remove_ads', 'starter_pack'])).toBe(false);
      // Owning full_unlock (via Set, Array, SKU, or Record) unlocks every island.
      expect(isUnlocked(id, ['full_unlock'])).toBe(true);
      expect(isUnlocked(id, new Set(['full_unlock']))).toBe(true);
      expect(isUnlocked(id, [`${MOBILE_APP_ID}.full_unlock`])).toBe(true);
      expect(isUnlocked(id, { full_unlock: true, remove_ads: false })).toBe(true);
      expect(isUnlocked(id, { full_unlock: false })).toBe(false);
    }

    expect(isUnlocked('   ', ['full_unlock'])).toBe(false);
  });

  it('keeps placeholder catalogue in one file with zero ad SDKs and single MOBILE_APP_ID source', () => {
    expect(IAP_PRODUCTS.map((p) => p.id)).toEqual(['remove_ads', 'starter_pack', 'full_unlock']);
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const dep of allDeps) {
      expect(dep).not.toMatch(/admob|adsense|unity-ads|applovin|ironsource/i);
    }

    // Verify `com.skyholdisles.game` literal only lives in `src/platform/mobileConfig.ts` across `src/`.
    const iapProductsSrc = readFileSync(resolve(ROOT, 'src/platform/iapProducts.ts'), 'utf8');
    expect(iapProductsSrc).not.toContain('com.skyholdisles.game');
    expect(iapProductsSrc).toContain('MOBILE_APP_ID');

    // Keep src/platform free of static `levels2d` imports so 25 2D island JSON layouts stay out of 3D chunks.
    for (const file of readdirSync(resolve(ROOT, 'src/platform'))) {
      if (!file.endsWith('.ts')) continue;
      const content = readFileSync(resolve(ROOT, 'src/platform', file), 'utf8');
      expect(content, `${file} must not statically import levels2d`).not.toMatch(/levels2d/);
    }
  });

  it('salvages truncated paid entitlement cache JSON and honors difficultyWins in 2D mode/hero gates', () => {
    const storage = createMemStorage();
    storage.setItem(IAP_SAVE_KEY, '{"version":1,"entitlements":["full_unlock"');
    const mobilePlatform = createMobilePlatform('ios');
    const store = createIapStore({ platform: mobilePlatform, storage });
    expect(store.owned('full_unlock')).toBe(true);
    expect(isUnlocked('i24', store.entitlements())).toBe(true);

    // Raw un-migrated progress carrying only difficultyWins still counts cleared islands consistently.
    const rawProg = createDefaultProgress(LEVELS_2D.length);
    rawProg.difficultyWins = {
      easy: new Array<number>(LEVELS_2D.length).fill(0),
      normal: new Array<number>(LEVELS_2D.length).fill(0),
      hard: new Array<number>(LEVELS_2D.length).fill(0),
    };
    rawProg.difficultyWins.hard[0] = 2;
    rawProg.difficultyWins.easy[1] = 1;
    rawProg.difficultyWins.normal[2] = 3;
    expect(clearedIslandsCount2D(rawProg, LEVELS_2D)).toBe(3);
    expect(isHeroUnlocked(rawProg, 'wren', LEVELS_2D)).toBe(true);
    expect(canPlayEndless('l1c', rawProg, LEVELS_2D)).toBe(true);
    expect(availableChallenges('l1c', rawProg, LEVELS_2D).length).toBeGreaterThan(0);
    expect(dailyForToday(Date.UTC(2026, 10, 20), rawProg, LEVELS_2D)).not.toBeNull();

    // Compact `{ e, n, h }` difficultyWins & malformed `[Symbol.iterator]` entitlement objects never throw:
    const compactRaw = {
      ...createDefaultProgress(0),
      difficultyWins: { h: [3, 3, 3] } as unknown as (typeof rawProg)['difficultyWins'],
    };
    expect(clearedIslandsCount2D(compactRaw, LEVELS_2D)).toBe(3);
    expect(canPlayEndless('l1c', compactRaw, LEVELS_2D)).toBe(true);
    expect(
      isUnlocked('i24', { [Symbol.iterator]: null, full_unlock: true } as unknown as Readonly<
        Record<string, boolean>
      >),
    ).toBe(true);
  });
});
