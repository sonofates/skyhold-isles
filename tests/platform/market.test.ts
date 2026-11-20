import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerInfo, PurchasesStoreProduct, PurchasesStoreTransaction } from '@revenuecat/purchases-capacitor';
import { EventBus } from '../../src/core/eventBus.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { CRYSTAL_PACKS, ITEM_IDS, ITEMS, MARKET_RULES, winCrystals } from '../../src/data/market.ts';
import { WORKSHOP_UPGRADES } from '../../src/data/workshop.ts';
import {
  buyItem,
  consumeItem,
  earnCrystals,
  grantCrystalPack,
  hasMarketActivity,
  marketWallet,
  mergeMarket,
  sanitizeMarket,
} from '../../src/game/market.ts';
import {
  createIapStore,
  crystalStoreEnabled,
  listCrystalPacks,
  purchaseCrystalPack,
  setIapStore,
  type NativePurchasesBridge,
} from '../../src/platform/iap.ts';
import { findIapProduct } from '../../src/platform/iapProducts.ts';
import { createPlatformAdapter, setPlatformAdapter } from '../../src/platform/platform.ts';
import { decodeSaveCode, encodeSaveCode } from '../../src/platform/saveCode.ts';
import { createDefaultProgress, hasAnyProgress, migrateProgress, PROGRESS_SAVE_VERSION } from '../../src/platform/storage.ts';
import { buyItem2D, deliverPacks2D, readMarket2D, runItemBelt2D, setLoadout2D, spendItem2D } from '../../src/render2d/ui/market2d.ts';
import { resolveQueryRun2D } from '../../src/render2d/ui/modes2d.ts';
import {
  applyRunResult2D,
  exportSaveCode2D,
  hydrateProgress2DFromCloud,
  importSaveCode2D,
  loadProgress2D,
  PROGRESS_2D_KEY,
  recordRunResult2D,
  remapProgress,
  resetProgress2D,
} from '../../src/render2d/ui/progress2d.ts';
import { SimWorld } from '../../src/sim/world.ts';

const disk = new Map<string, string>();
const storage = {
  getItem: (k: string) => disk.get(k) ?? null,
  setItem: (k: string, v: string) => disk.set(k, v),
  removeItem: (k: string) => disk.delete(k),
};
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

describe('Market progression & exploit QA', () => {
  it('migrates v1/v2 at the normal 2D entry point, with the same one-time supplies as a fresh save', () => {
    const gift = readMarket2D();
    expect(gift.crystals).toBe(MARKET_RULES.starterCrystals);
    expect(Object.values(gift.inventory)).toEqual(ITEM_IDS.map(() => MARKET_RULES.starterCount));
    for (const version of [1, 2]) {
      storage.setItem(PROGRESS_2D_KEY, JSON.stringify({ version, bestStars: [3], unlockedLevelIndex: 1 }));
      const migrated = loadProgress2D();
      expect(migrated.version).toBe(PROGRESS_SAVE_VERSION);
      expect(migrated.bestStars[0]).toBe(3);
      expect(readMarket2D()).toEqual(gift);
      expect(buyItem2D('emberPot')).toBe(true);
      expect(readMarket2D().crystals).toBe(MARKET_RULES.starterCrystals - ITEMS.emberPot.price);
      expect(readMarket2D().inventory.emberPot).toBe(2);
    }
    expect(hasAnyProgress(createDefaultProgress(5))).toBe(false);
    expect(hasAnyProgress(loadProgress2D())).toBe(true);
  });

  it('migrates v2->v3 with odd, corrupt, prototype-polluting, or impossible-debt Market payloads cleanly', () => {
    // 1. Authentic rich v2 save without market key preserves all stars, Workshop, heroes, daily, difficultyWins.
    const wsId = WORKSHOP_UPGRADES[0].id;
    const v2Save = {
      version: 2,
      unlockedLevelIndex: 3,
      bestStars: [3, 2, 1],
      bestLives: [20, 15, 8],
      clears: [2, 1, 1],
      workshop: { [wsId]: 1 },
      daily: { lastDay: 500, streak: 3, bestStreak: 4, total: 5 },
      difficultyWins: { easy: [0, 0, 0], normal: [3, 2, 1], hard: [2, 0, 0] },
      heroes: { selectedHero: 'bran', roster: { bran: { xp: 250, skills: [] } } },
    };
    const migratedV2 = migrateProgress(v2Save, 5);
    expect(migratedV2.version).toBe(PROGRESS_SAVE_VERSION);
    expect(migratedV2.bestStars.slice(0, 3)).toEqual([3, 2, 1]);
    expect(migratedV2.workshop).toEqual({ [wsId]: 1 });
    expect(migratedV2.daily.total).toBe(5);
    expect(marketWallet(migratedV2.market!)).toEqual({
      crystals: MARKET_RULES.starterCrystals,
      inventory: Object.fromEntries(ITEM_IDS.map((id) => [id, MARKET_RULES.starterCount])),
      loadout: [...ITEM_IDS.slice(0, MARKET_RULES.slots)],
    });

    // 2. Non-object market fields (null, primitives, arrays) sanitize to starter wallet with 0 false activity.
    for (const badMarket of [null, undefined, 0, -42, 'corrupt', true, [1, 2, 3]]) {
      const m = migrateProgress({ version: 2, market: badMarket }, 3);
      expect(hasMarketActivity(m.market)).toBe(false);
      expect(hasAnyProgress(m)).toBe(false);
      expect(marketWallet(m.market!).crystals).toBe(MARKET_RULES.starterCrystals);
    }

    // 3. Adversarial keys, NaNs, infinities, negative numbers, impossible spent-without-bought debt, and bogus bonuses.
    const adversarialRaw = JSON.parse(
      '{"version":2,"market":{' +
        '"loadoutRevision":-99,' +
        '"loadout":["unknown","__proto__","heartstone","emberPot","heartstone","galeBell","skyPurse"],' +
        '"counters":{' +
          '"__proto__":{"earned":999999},' +
          '"constructor":{"earned":999999},' +
          '"prototype":{"earned":999999},' +
          '" padded ":{"earned":500},' +
          '"corruptDebt":{"earned":-50,"spent":999999999,"bought":{"skyPurse":null},"used":{"emberPot":-3}},' +
          '"realDevice":{"earned":40.9,"spent":999999,"bought":{"emberPot":1.8},"used":{"skyPurse":0.4}}' +
        '},' +
        '"purchaseLedger":{"__proto__":9999,"neg":-80,"float":12.5,"str":"80","resetTx":0,"validTx":80},' +
        '"winBonuses":{"island:":999,"daily:abc":999,"other:1":999,"island:l1c":26.7,"daily:1000":18,"island:zero":0}' +
      '}}',
    );
    const cleaned = migrateProgress(adversarialRaw, 4);
    expect(({} as Record<string, unknown>).earned).toBeUndefined();
    expect(cleaned.market!.loadout).toEqual(['heartstone', 'emberPot', 'galeBell']);
    expect(cleaned.market!.loadoutRevision).toBe(0);
    // corruptDebt had 0 items bought, so its impossible spent=999999999 was clamped to 0 and pruned!
    expect(cleaned.market!.counters.corruptDebt).toBeUndefined();
    // realDevice bought 1 emberPot, so its corrupt spent=999999 was clamped to plausible ceiling (100).
    expect(cleaned.market!.counters.realDevice.earned).toBe(40);
    expect(cleaned.market!.counters.realDevice.spent).toBe(100);
    expect(cleaned.market!.counters.realDevice.bought).toEqual({ emberPot: 1 });
    expect(cleaned.market!.counters.realDevice.used).toEqual({});
    expect(cleaned.market!.purchaseLedger).toEqual({ resetTx: 0, validTx: 80 });
    expect(cleaned.market!.winBonuses).toEqual({ 'island:l1c': 26, 'daily:1000': 18 });

    // Valid empty loadout [] stays empty through sanitize, save code, and island remap.
    const emptyLoadoutSave = migrateProgress({ version: 3, market: { loadout: [], loadoutRevision: 2 } }, 3);
    expect(emptyLoadoutSave.market!.loadout).toEqual([]);
    const roundTripCode = decodeSaveCode(encodeSaveCode(emptyLoadoutSave), 3);
    expect(roundTripCode.ok && roundTripCode.progress.market!.loadout).toEqual([]);
    expect(remapProgress(emptyLoadoutSave, ['a', 'b', 'c'], LEVELS_2D.slice(0, 3)).market!.loadout).toEqual([]);
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
    expect(wallet.crystals).toBe(MARKET_RULES.starterCrystals + 46 + 9 + 12 + 5 + 27 + 9);
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
    expect(setLoadout2D(['emberPot', 'galeBell'])).toBe(true);
    expect(buyItem2D('emberPot')).toBe(true);
    expect(buyItem2D('emberPot')).toBe(true);
    expect(buyItem2D('galeBell')).toBe(false);
    expect(runItemBelt2D('hard', false)).toEqual({ emberPot: 1, galeBell: 1 });
    expect(runItemBelt2D('normal', false)).toEqual({ emberPot: 3, galeBell: 1 });
    expect(runItemBelt2D('hard', true)).toEqual({});
    const save = sanitizeMarket();
    earnCrystals(save, 'writer', 100000);
    for (let i = 1; i < MARKET_RULES.inventoryCap; i++) expect(buyItem(save, 'writer', 'skyPurse')).toBe(true);
    const before = marketWallet(save);
    expect(before.inventory.skyPurse).toBe(99);
    expect(buyItem(save, 'writer', 'skyPurse')).toBe(false);
    expect(marketWallet(save)).toEqual(before);
  });

  it('snapshots the belt, spends only accepted casts, keeps consumption across quit/restart, and blocks skyPurse restart farming', () => {
    // Stock 2 skyPurses (1 starter + 1 bought) and 1 heartstone + 1 emberPot.
    expect(buyItem2D('skyPurse')).toBe(true);
    const crystalsAfterBuy = readMarket2D().crystals;
    expect(setLoadout2D(['skyPurse', 'heartstone', 'emberPot'])).toBe(true);

    const run = () =>
      new SimWorld(LEVELS_2D[0], new EventBus(), {
        itemBelt: runItemBelt2D('normal', false),
        spendItem: spendItem2D,
      });

    // Run 1: rejected heartstone (full HP) & off-map emberPot cost nothing; skyPurse grants run gold & debits save.
    const w1 = run();
    w1.startNextWave();
    const baseStartingGold = w1.gold;
    expect(w1.useItem('heartstone')).toBe(false);
    expect(w1.useItem('emberPot', 9999, 9999)).toBe(false);
    expect(w1.useItem('skyPurse')).toBe(true);
    expect(w1.gold).toBeGreaterThan(baseStartingGold);

    // Player quits / restarts (records loss/abort): skyPurse stays spent, unused items remain, 0 crystals earned, next run starts back at base gold!
    recordRunResult2D({
      levelId: LEVELS_2D[0].id,
      won: false,
      stars: 0,
      livesRemaining: w1.lives,
      waveReached: 1,
    });
    w1.dispose();
    expect(readMarket2D().crystals).toBe(crystalsAfterBuy);
    expect(readMarket2D().inventory.skyPurse).toBe(1);
    expect(readMarket2D().inventory.heartstone).toBe(1);
    expect(readMarket2D().inventory.emberPot).toBe(1);

    // Run 2 (restart): gold is NOT carried over; spending last skyPurse drains inventory to 0.
    const w2 = run();
    expect(w2.gold).toBe(baseStartingGold);
    expect(w2.itemSystem.belt()).toEqual({ skyPurse: 1, heartstone: 1, emberPot: 1 });
    w2.startNextWave();
    expect(w2.useItem('skyPurse')).toBe(true);
    w2.dispose();
    expect(readMarket2D().inventory.skyPurse).toBe(0);
    expect(readMarket2D().crystals).toBe(crystalsAfterBuy);

    // Run 3 (restart with 0 skyPurses): belt shows 0 charges and cast is rejected.
    const w3 = run();
    expect(w3.itemSystem.belt()).toEqual({ skyPurse: 0, heartstone: 1, emberPot: 1 });
    w3.startNextWave();
    expect(w3.useItem('skyPurse')).toBe(false);
    expect(w3.gold).toBe(baseStartingGold);
    w3.dispose();

    // Storage write failure aborts the cast cleanly without debiting belt or healing lives.
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    const failed = run();
    failed.startNextWave();
    failed.lives--;
    expect(failed.useItem('heartstone')).toBe(false);
    expect(failed.itemSystem.belt().heartstone).toBe(1);
    expect(failed.lives).toBe(failed.startingLives - 1);
  });

  it('imports old codes without restoring spent inventory, merges cloud spending idempotently, and delivers +1 stock after offline double-spend', () => {
    buyItem2D('emberPot');
    const before = exportSaveCode2D();
    spendItem2D('emberPot');
    expect(importSaveCode2D(before).ok).toBe(true);
    expect(readMarket2D().inventory.emberPot).toBe(1);

    const a = sanitizeMarket(),
      b = sanitizeMarket();
    buyItem(a, 'desktop', 'emberPot');
    consumeItem(b, 'phone', 'skyPurse');
    const merged = mergeMarket(a, b);
    expect(mergeMarket(b, a)).toEqual(merged);
    expect(mergeMarket(merged, a)).toEqual(merged);
    expect(marketWallet(merged)).toMatchObject({
      crystals: MARKET_RULES.starterCrystals - ITEMS.emberPot.price,
      inventory: { emberPot: 2, skyPurse: 0 },
    });

    // Offline double-spend of the same starter unit: both debits kept (floors at 0), and a subsequent purchase still delivers 1 usable item!
    const devA = sanitizeMarket();
    const devB = sanitizeMarket();
    expect(consumeItem(devA, 'devA', 'emberPot')).toBe(true);
    expect(consumeItem(devB, 'devB', 'emberPot')).toBe(true);
    const overdrawn = mergeMarket(devA, devB);
    expect(marketWallet(overdrawn).inventory.emberPot).toBe(0);
    expect(buyItem(overdrawn, 'devA', 'emberPot')).toBe(true);
    expect(marketWallet(overdrawn).inventory.emberPot).toBe(1);

    const corrupt = migrateProgress(
      {
        market: {
          counters: { device: { spent: -5, bought: { skyPurse: Infinity } } },
          loadout: ['bad', 'heartstone', 'heartstone'],
        },
      },
      1,
    );
    expect(marketWallet(corrupt.market!)).toMatchObject({
      crystals: MARKET_RULES.starterCrystals,
      inventory: { skyPurse: 1 },
      loadout: ['heartstone'],
    });
  });

  it('folds a live purchase and overlapping first/daily wins into a pending Steam Cloud read', async () => {
    const cfg = { daily: 1000, endless: false, challenges: [] };
    const win = {
      levelId: LEVELS_2D[0].id,
      won: true,
      stars: 3,
      livesRemaining: 20,
      waveReached: 10,
      runConfig: cfg,
      nowMs: 1000 * 86400000,
    };
    const remote = createDefaultProgress(LEVELS_2D.length);
    applyRunResult2D(remote, win, LEVELS_2D, 'phone');
    let finishRead!: (value: string) => void;
    let cloudBlob = '';
    const adapter = {
      ...web(),
      isSteam: true,
      cloudSave: {
        read: () =>
          new Promise<string>((resolve) => {
            finishRead = resolve;
          }),
        write: async (_slot: string, data: string) => {
          cloudBlob = data;
          return true;
        },
      },
    };
    const hydration = hydrateProgress2DFromCloud(undefined, LEVELS_2D, adapter);
    recordRunResult2D(win);
    expect(buyItem2D('emberPot')).toBe(true);
    finishRead(JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: remote }));
    await hydration;
    const wallet = readMarket2D();
    expect(wallet.crystals).toBe(MARKET_RULES.starterCrystals + 46 + 9 + 18 - ITEMS.emberPot.price);
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
    expect(resolveQueryRun2D(new URLSearchParams('diff=easy'), p).modifiers.itemsDisabled).toBe(false);
  });
});

describe('mobile crystal receipts & IAP grant idempotency', () => {
  const pack = 'crystals_small';
  const sku = findIapProduct(pack)!.storeProductId;
  const sp = {
    identifier: sku,
    title: 'Crystal pack',
    priceString: 'Store price',
    currencyCode: 'USD',
  } as PurchasesStoreProduct;
  function bridge() {
    const history: PurchasesStoreTransaction[] = [];
    const info = () =>
      ({
        entitlements: { active: {} },
        allPurchasedProductIdentifiers: [],
        nonSubscriptionTransactions: history,
      }) as unknown as CustomerInfo;
    const native: NativePurchasesBridge = {
      ensureConfigured: async () => ({ ok: true }),
      isConfigured: () => true,
      getProducts: vi.fn(async () => [sp]),
      getCustomerInfo: async () => ({ customerInfo: info() }),
      purchaseStoreProduct: vi.fn(async () => ({ customerInfo: info(), transaction: history.at(-1) })),
      restorePurchases: async () => ({ customerInfo: info() }),
    };
    const tx = (id: string) =>
      history.push({ productIdentifier: sku, transactionIdentifier: id } as PurchasesStoreTransaction);
    return { native, tx };
  }

  it('enforces pure grantCrystalPack & deliverPacks2D idempotency and rejects malformed receipts', () => {
    const save = sanitizeMarket();
    for (const badTx of ['', '  tx ', '__proto__', 'constructor', 'prototype', 'x'.repeat(257)]) {
      expect(grantCrystalPack(save, 'crystals_small', badTx)).toBe(false);
    }
    expect(grantCrystalPack(save, 'unknown_pack' as never, 'tx-valid')).toBe(false);
    expect(marketWallet(save).crystals).toBe(MARKET_RULES.starterCrystals);

    // Repeating the same transactionId (even with a larger pack id) grants once and never mutates the recorded credit.
    expect(grantCrystalPack(save, 'crystals_small', 'tx-100')).toBe(true);
    expect(grantCrystalPack(save, 'crystals_small', 'tx-100')).toBe(true);
    expect(grantCrystalPack(save, 'crystals_large', 'tx-100')).toBe(true);
    expect(marketWallet(save).crystals).toBe(MARKET_RULES.starterCrystals + CRYSTAL_PACKS.crystals_small);

    // Same-batch duplicate receipts in deliverPacks2D credit once.
    expect(
      deliverPacks2D([
        { pack: 'crystals_medium', transactionId: 'batch-dup-1' },
        { pack: 'crystals_medium', transactionId: 'batch-dup-1' },
        { pack: 'crystals_large', transactionId: 'batch-dup-2' },
      ]),
    ).toBe(true);
    expect(readMarket2D().crystals).toBe(
      MARKET_RULES.starterCrystals + CRYSTAL_PACKS.crystals_medium + CRYSTAL_PACKS.crystals_large,
    );
    // Re-delivering the exact same batch is a persisted no-op.
    expect(
      deliverPacks2D([
        { pack: 'crystals_medium', transactionId: 'batch-dup-1' },
        { pack: 'crystals_large', transactionId: 'batch-dup-2' },
      ]),
    ).toBe(true);
    expect(readMarket2D().crystals).toBe(
      MARKET_RULES.starterCrystals + CRYSTAL_PACKS.crystals_medium + CRYSTAL_PACKS.crystals_large,
    );
  });

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
    vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
      throw Error('disk full');
    });
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
    // Merging pre-reset backup with post-reset save keeps 0-credit tombstones (min rule), preventing receipt resurrection via restore!
    const resetSave = loadProgress2D().market!;
    expect(resetSave.purchaseLedger).toEqual({ 'receipt-1': 0, 'receipt-2': 0 });
  });
});
