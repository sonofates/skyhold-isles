import { afterEach, describe, expect, it } from 'vitest';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { createIapStore, createPlatformAdapter, FREE_ISLANDS, listCrystalPacks, MOBILE_STORE_LIVE, setIapStore, setPlatformAdapter, type IapStoreProduct, type PlatformAdapter } from '../../src/platform/index.ts';
import { canPlayIsland, needsFullAdventure, storeEnabled, storeOrder } from '../../src/render2d/ui/store2d.ts';

const web = (): PlatformAdapter => createPlatformAdapter({ bridge: null, mobile: null, storage: null });
const mobile = (): PlatformAdapter =>
  ({ ...createPlatformAdapter({ bridge: null, mobile: null, storage: null }), isMobile: true, mobilePlatform: 'android' }) as PlatformAdapter;
const steam = (): PlatformAdapter =>
  ({ ...createPlatformAdapter({ bridge: null, mobile: null, storage: null }), isSteam: true }) as PlatformAdapter;

afterEach(() => {
  setPlatformAdapter(null);
  setIapStore(null);
});

describe('free-version scope (store2d)', () => {
  const paidId = LEVELS_2D[FREE_ISLANDS.length].id;

  it('web and Steam: no store, every island playable', () => {
    for (const p of [web(), steam()]) {
      setPlatformAdapter(p);
      const iap = createIapStore({ platform: p, storage: null, locationSearch: '' });
      expect(iap.mode).toBe('noop');
      expect(storeEnabled(iap)).toBe(false);
      for (const l of LEVELS_2D) expect(canPlayIsland(l.id, iap)).toBe(true);
    }
  });

  it('mobile release default: the game is entirely free (MOBILE_STORE_LIVE off) — no store, every island playable, no packs', async () => {
    expect(MOBILE_STORE_LIVE).toBe(false);
    const p = mobile();
    setPlatformAdapter(p);
    const iap = createIapStore({ platform: p, storage: null, locationSearch: '' });
    setIapStore(iap);
    expect(iap.mode).toBe('noop');
    expect(storeEnabled(iap)).toBe(false);
    for (const l of LEVELS_2D) expect(canPlayIsland(l.id, iap)).toBe(true);
    expect(await listCrystalPacks()).toEqual([]);
  });

  it('Steam ignores ?iapmock=1', () => {
    const p = steam();
    setPlatformAdapter(p);
    const iap = createIapStore({ platform: p, storage: null, locationSearch: '?iapmock=1' });
    expect(storeEnabled(iap)).toBe(false);
  });

  it('mobile (mock store): free islands play, the rest need the full adventure until it is bought', async () => {
    const p = mobile();
    setPlatformAdapter(p);
    const iap = createIapStore({ platform: p, mode: 'mock', storage: null });
    expect(storeEnabled(iap)).toBe(true);
    for (const id of FREE_ISLANDS) expect(canPlayIsland(id, iap)).toBe(true);
    expect(needsFullAdventure(paidId, iap)).toBe(true);
    const res = await iap.purchase('full_unlock');
    expect(res.ok).toBe(true);
    expect(canPlayIsland(paidId, iap)).toBe(true);
    for (const l of LEVELS_2D) expect(needsFullAdventure(l.id, iap)).toBe(false);
  });

  it('a desktop browser with ?iapmock=1 keeps all islands and has no store', () => {
    const p = web();
    setPlatformAdapter(p);
    const iap = createIapStore({ platform: p, storage: null, locationSearch: '?iapmock=1' });
    expect(iap.mode).toBe('noop');
    expect(storeEnabled(iap)).toBe(false);
    expect(canPlayIsland(paidId, iap)).toBe(true);
  });

  it('lists the full adventure first, then the catalogue order', () => {
    const mk = (id: string): IapStoreProduct => ({ id, storeProductId: id, kind: 'non_consumable', title: id, description: '', priceString: '1', currencyCode: 'X' });
    expect(storeOrder([mk('remove_ads'), mk('starter_pack'), mk('full_unlock')]).map((p) => p.id)).toEqual(['full_unlock', 'remove_ads', 'starter_pack']);
  });
});
