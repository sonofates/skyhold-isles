import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerInfo, PurchasesStoreProduct, PurchasesStoreTransaction } from '@revenuecat/purchases-capacitor';
import { EventBus } from '../../src/core/eventBus.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { CRYSTAL_PACKS, ITEM_IDS, MARKET_RULES, winCrystals } from '../../src/data/market.ts';
import { buyItem, consumeItem, earnCrystals, marketWallet, mergeMarket, sanitizeMarket } from '../../src/game/market.ts';
import { createIapStore, crystalStoreEnabled, listCrystalPacks, purchaseCrystalPack, setIapStore, type NativePurchasesBridge } from '../../src/platform/iap.ts';
import { findIapProduct } from '../../src/platform/iapProducts.ts';
import { createPlatformAdapter, setPlatformAdapter } from '../../src/platform/platform.ts';
import { createDefaultProgress, hasAnyProgress, migrateProgress, PROGRESS_SAVE_VERSION } from '../../src/platform/storage.ts';
import { buyItem2D, readMarket2D, runItemBelt2D, setLoadout2D, spendItem2D } from '../../src/render2d/ui/market2d.ts';
import { resolveQueryRun2D } from '../../src/render2d/ui/modes2d.ts';
import { applyRunResult2D, exportSaveCode2D, hydrateProgress2DFromCloud, importSaveCode2D, loadProgress2D, PROGRESS_2D_KEY, recordRunResult2D, resetProgress2D } from '../../src/render2d/ui/progress2d.ts';
import { SimWorld } from '../../src/sim/world.ts';

const disk = new Map<string, string>();
const storage = { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => disk.set(k, v), removeItem: (k: string) => disk.delete(k) };
const web = () => createPlatformAdapter({ bridge: null, mobile: null, storage });
const mobile = () => ({ ...web(), isMobile: true, mobilePlatform: 'android' as const });
beforeEach(() => {
  disk.clear();
  vi.stubGlobal('localStorage', storage);
  setPlatformAdapter(web());
});
afterEach(() => {
  setIapStore(null);
  setPlatformAdapter(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Market progression', () => {
  it('migrates v1/v2 at the normal 2D entry point, with the same one-time supplies as a fresh save', () => {
    const gift = readMarket2D();
    expect(gift.crystals).toBe(28);
    expect(Object.values(gift.inventory)).toEqual(ITEM_IDS.map(() => 1));
    for (const version of [1, 2]) {
      storage.setItem(PROGRESS_2D_KEY, JSON.stringify({ version, bestStars: [3], unlockedLevelIndex: 1 }));
      const migrated = loadProgress2D();
      expect(migrated.version).toBe(PROGRESS_SAVE_VERSION);
      expect(migrated.bestStars[0]).toBe(3);
      expect(readMarket2D()).toEqual(gift);
      expect(buyItem2D('emberPot')).toBe(true);
      expect(readMarket2D().crystals).toBe(16);
      expect(readMarket2D().inventory.emberPot).toBe(2);
    }
    expect(hasAnyProgress(createDefaultProgress(5))).toBe(false);
    expect(hasAnyProgress(loadProgress2D())).toBe(true);
  });

  it('pays each first clear once across difficulties, replays less, and a counted daily bonus only once', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    const outcome = { levelId: LEVELS_2D[0].id, won: true, stars: 3, waveReached: 10, livesRemaining: 20 };
    expect(applyRunResult2D(p, outcome).crystalsEarned).toBe(46);
    expect(applyRunResult2D(p, outcome).crystalsEarned).toBe(9);
    const config = { daily: null, challenges: [], endless: false };
    expect(applyRunResult2D(p, { ...outcome, runConfig: { ...config, difficulty: 'hard' } }).crystalsEarned).toBe(12);
    expect(applyRunResult2D(p, { ...outcome, runConfig: { ...config, difficulty: 'easy' } }).crystalsEarned).toBe(5);
    const daily = { ...outcome, nowMs: 1000 * 86400000, runConfig: { ...config, daily: 1000 } };
    expect(applyRunResult2D(p, daily).crystalsEarned).toBe(27);
    expect(applyRunResult2D(p, daily).crystalsEarned).toBe(9);
    const wallet = marketWallet(p.market!);
    expect(wallet.crystals).toBe(28 + 46 + 9 + 12 + 5 + 27 + 9);
    applyRunResult2D(p, { ...outcome, won: false });
    applyRunResult2D(p, { ...outcome, levelId: 'missing' });
    applyRunResult2D(p, { ...outcome, runConfig: { ...config, endless: true } });
    expect(marketWallet(p.market!)).toEqual(wallet);
    expect(winCrystals(1, true, 'easy')).toBe(29);
    expect(winCrystals(3, true, 'hard')).toBe(62);
  });

  it('enforces stock, affordability, distinct slots and charges per island and difficulty', () => {
    expect(setLoadout2D(['skyPurse', 'skyPurse'])).toBe(false);
    expect(setLoadout2D(ITEM_IDS.slice(0, 4))).toBe(false);
    expect(setLoadout2D(['skyPurse', 'galeBell'])).toBe(true);
    expect(buyItem2D('skyPurse')).toBe(true);
    expect(buyItem2D('skyPurse')).toBe(true);
    expect(buyItem2D('galeBell')).toBe(false);
    expect(runItemBelt2D('hard', false)).toEqual({ skyPurse: 1, galeBell: 1 });
    expect(runItemBelt2D('normal', false)).toEqual({ skyPurse: 3, galeBell: 1 });
    expect(runItemBelt2D('hard', true)).toEqual({});
    const save = sanitizeMarket();
    earnCrystals(save, 'writer', 10000);
    for (let i = 1; i < MARKET_RULES.inventoryCap; i++) expect(buyItem(save, 'writer', 'skyPurse')).toBe(true);
    const before = marketWallet(save);
    expect(before.inventory.skyPurse).toBe(99);
    expect(buyItem(save, 'writer', 'skyPurse')).toBe(false);
    expect(marketWallet(save)).toEqual(before);
  });

  it('snapshots the belt, spends only accepted casts, and keeps consumption across quit and restart', () => {
    setLoadout2D(['skyPurse', 'heartstone']);
    const run = () => new SimWorld(LEVELS_2D[0], new EventBus(), { itemBelt: runItemBelt2D('normal', false), spendItem: spendItem2D });
    const w = run();
    w.startNextWave();
    expect(w.useItem('heartstone')).toBe(false);
    expect(w.useItem('skyPurse')).toBe(true);
    w.dispose();
    expect(readMarket2D().inventory.skyPurse).toBe(0);
    expect(readMarket2D().inventory.heartstone).toBe(1);
    expect(run().itemSystem.belt()).toEqual({ skyPurse: 0, heartstone: 1 });
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw Error('quota'); });
    const failed = run();
    failed.startNextWave();
    failed.lives--;
    expect(failed.useItem('heartstone')).toBe(false);
    expect(failed.itemSystem.belt().heartstone).toBe(1);
    expect(failed.lives).toBe(failed.startingLives - 1);
  });

  it('imports old codes without restoring spent inventory and merges independent cloud spending idempotently', () => {
    buyItem2D('emberPot');
    const before = exportSaveCode2D();
    spendItem2D('emberPot');
    expect(importSaveCode2D(before).ok).toBe(true);
    expect(readMarket2D().inventory.emberPot).toBe(1);
    const a = sanitizeMarket(), b = sanitizeMarket();
    buyItem(a, 'desktop', 'emberPot');
    consumeItem(b, 'phone', 'skyPurse');
    const merged = mergeMarket(a, b);
    expect(mergeMarket(b, a)).toEqual(merged);
    expect(mergeMarket(merged, a)).toEqual(merged);
    expect(marketWallet(merged)).toMatchObject({ crystals: 16, inventory: { emberPot: 2, skyPurse: 0 } });
    const corrupt = migrateProgress({ market: { counters: { device: { spent: -5, bought: { skyPurse: Infinity } } }, loadout: ['bad', 'heartstone', 'heartstone'] } }, 1);
    expect(marketWallet(corrupt.market!)).toMatchObject({ crystals: 28, inventory: { skyPurse: 1 }, loadout: ['heartstone'] });
  });

  it('folds a live purchase and overlapping first/daily wins into a pending Steam Cloud read', async () => {
    const cfg = { daily: 1000, endless: false, challenges: [] };
    const win = { levelId: LEVELS_2D[0].id, won: true, stars: 3, livesRemaining: 20, waveReached: 10, runConfig: cfg, nowMs: 1000 * 86400000 };
    const remote = createDefaultProgress(LEVELS_2D.length);
    applyRunResult2D(remote, win, LEVELS_2D, 'phone');
    let finishRead!: (value: string) => void;
    let cloudBlob = '';
    const adapter = { ...web(), isSteam: true, cloudSave: {
      read: () => new Promise<string>(resolve => { finishRead = resolve; }),
      write: async (_slot: string, data: string) => { cloudBlob = data; return true; },
    } };
    const hydration = hydrateProgress2DFromCloud(undefined, LEVELS_2D, adapter);
    recordRunResult2D(win);
    expect(buyItem2D('emberPot')).toBe(true);
    finishRead(JSON.stringify({ ids: LEVELS_2D.map(l => l.id), progress: remote }));
    await hydration;
    const wallet = readMarket2D();
    expect(wallet.crystals).toBe(28 + 46 + 9 + 18 - 12);
    expect(wallet.inventory.emberPot).toBe(2);
    expect(marketWallet(JSON.parse(cloudBlob).progress.market)).toEqual(wallet);
  });

  it('disables every challenge, Daily and Endless while leaving ordinary Workshop/difficulty runs playable', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    p.clears[0] = p.bestStars[0] = 1;
    for (const q of ['challenge=bowless', 'challenge=silentSkies', 'daily=1', 'endless=1']) {
      expect(resolveQueryRun2D(new URLSearchParams(q), p).modifiers.itemsDisabled).toBe(true);
    }
    expect(resolveQueryRun2D(new URLSearchParams('diff=hard'), p).modifiers.itemsDisabled).toBe(false);
  });
});

describe('mobile crystal receipts', () => {
  const pack = 'crystals_small';
  const sku = findIapProduct(pack)!.storeProductId;
  const sp = { identifier: sku, title: 'Crystal pack', priceString: 'Store price', currencyCode: 'USD' } as PurchasesStoreProduct;
  function bridge() {
    const history: PurchasesStoreTransaction[] = [];
    const info = () => ({ entitlements: { active: {} }, allPurchasedProductIdentifiers: [], nonSubscriptionTransactions: history }) as unknown as CustomerInfo;
    const native: NativePurchasesBridge = {
      ensureConfigured: async () => ({ ok: true }), isConfigured: () => true,
      getProducts: vi.fn(async () => [sp]), getCustomerInfo: async () => ({ customerInfo: info() }),
      purchaseStoreProduct: vi.fn(async () => ({ customerInfo: info(), transaction: history.at(-1) })),
      restorePurchases: async () => ({ customerInfo: info() }),
    };
    const tx = (id: string) => history.push({ productIdentifier: sku, transactionIdentifier: id } as PurchasesStoreTransaction);
    return { native, tx };
  }

  it('gates listing and purchasing at both the UI facade and adapter, including mock flags or forced native mode', async () => {
    for (const p of [web(), { ...web(), isSteam: true }, { ...mobile(), isDesktop: true }]) {
      const { native } = bridge();
      setPlatformAdapter(p);
      const iap = createIapStore({ platform: p, mode: 'native', nativeBridge: native, locationSearch: '?iapmock=1' });
      setIapStore(iap);
      expect(crystalStoreEnabled()).toBe(false);
      expect(await listCrystalPacks()).toEqual([]);
      expect((await purchaseCrystalPack(pack)).status).toBe('unavailable');
      expect((await iap.purchase(sku)).status).toBe('unavailable');
      expect(native.getProducts).not.toHaveBeenCalled();
      expect(native.purchaseStoreProduct).not.toHaveBeenCalled();
    }
  });

  it('credits distinct repeat purchases once each, handles redelivery, reload, reset and portable saves', async () => {
    const { native, tx } = bridge();
    const p = mobile();
    setPlatformAdapter(p);
    const iap = createIapStore({ platform: p, nativeBridge: native, storage });
    setIapStore(iap);
    expect((await listCrystalPacks())[0]).toMatchObject({ id: pack, kind: 'consumable', priceString: 'Store price' });
    expect((await purchaseCrystalPack(pack)).status).toBe('pending_delivery');
    expect(readMarket2D().crystals).toBe(28);
    tx('receipt-1');
    expect((await purchaseCrystalPack(pack)).ok).toBe(true);
    await Promise.all([iap.purchase(sku), iap.restore()]);
    expect(readMarket2D().crystals).toBe(28 + CRYSTAL_PACKS[pack]);
    tx('receipt-2');
    vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw Error('disk full'); });
    expect((await purchaseCrystalPack(pack)).status).toBe('pending_delivery');
    expect(readMarket2D().crystals).toBe(108);
    await listCrystalPacks(); // opening the Market reconciles the completed store charge
    expect(readMarket2D().crystals).toBe(188);
    expect(iap.owned(pack)).toBe(false);
    const backup = exportSaveCode2D();
    disk.clear();
    expect(importSaveCode2D(backup).ok).toBe(true);
    await iap.restore();
    expect(readMarket2D().crystals).toBe(188);
    expect(Object.keys(loadProgress2D().market!.purchaseLedger)).toHaveLength(2);
    resetProgress2D();
    await iap.restore();
    expect(readMarket2D().crystals).toBe(28);
  });
});
