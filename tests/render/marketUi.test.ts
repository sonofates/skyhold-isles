import { describe, expect, it } from 'vitest';
import { ITEM_IDS, ITEMS, MARKET_RULES, type ItemId } from '../../src/data/market.ts';
import type { MarketWallet } from '../../src/game/market.ts';
import { hudDock, itemGroupLong, trayLong } from '../../src/render2d/hudDock.ts';
import { dockCost, fullBleedFit, fullBleedFitItems, hardShapes } from '../../src/render2d/fullBleed.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import {
  beltIds,
  beltKeyIndex,
  beltPress,
  beltSlotState,
  beltStateKey,
  beltView,
  buyBlock,
  ITEM_KEYS,
  marketView,
  placeInSlot,
  toggleLoadout,
  usesFor,
  type BeltRunState,
} from '../../src/render2d/ui/marketModel.ts';
import { ABILITY_KEYS } from '../../src/render2d/ui/abilities2d.ts';
import { HERO_KEYS } from '../../src/render2d/ui/heroKeys.ts';
import { EN } from '../../src/i18n/en.ts';
import { TR } from '../../src/i18n/tr.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS } from '../../src/render2d/uiLayout.ts';

const all = (n: number): Record<ItemId, number> => Object.fromEntries(ITEM_IDS.map((id) => [id, n])) as Record<ItemId, number>;
const wallet = (crystals: number, inv: Partial<Record<ItemId, number>> = {}, loadout: ItemId[] = []): MarketWallet => ({ crystals, inventory: { ...all(0), ...inv }, loadout });
const RUN: BeltRunState = { disabled: false, preFirstWave: false, ended: false, paused: false, replaying: false, lives: 15, livesUntilNextUse: 0, heartstoneCeiling: 20, enemies: 4 };

describe('Market view-model', () => {
  it('prices, stock and the belt come from the wallet and src/data/market.ts', () => {
    const v = marketView(wallet(30, { emberPot: 2 }, ['emberPot', 'heartstone']));
    expect(v.crystals).toBe(30);
    expect(v.cards.map((c) => c.id)).toEqual([...ITEM_IDS]);
    for (const c of v.cards) expect(c.price).toBe(ITEMS[c.id].price);
    expect(v.cards[0]).toMatchObject({ id: 'emberPot', owned: 2, slot: 0, canEquip: false });
    expect(v.slots).toEqual(['emberPot', 'heartstone', null]);
    expect(v.slotCount).toBe(MARKET_RULES.slots);
    expect(v.useCap).toEqual(MARKET_RULES.useCap);
    expect(v.cards.find((c) => c.id === 'frostLantern')!.canEquip).toBe(true);
  });

  it('Buy is off when crystals are short or the pack is at the cap; ×5 needs both for five', () => {
    const price = ITEMS.galeBell.price;
    expect(buyBlock(wallet(price - 1), 'galeBell')).toBe('short');
    expect(buyBlock(wallet(price), 'galeBell')).toBeNull();
    expect(buyBlock(wallet(9999, { galeBell: MARKET_RULES.inventoryCap }), 'galeBell')).toBe('full');
    const v = marketView(wallet(price * 4, { emberPot: MARKET_RULES.inventoryCap - 2 }));
    expect(v.cards.find((c) => c.id === 'galeBell')!.canBuy5).toBe(false);
    expect(marketView(wallet(price * 5)).cards.find((c) => c.id === 'galeBell')!.canBuy5).toBe(true);
    expect(v.cards.find((c) => c.id === 'emberPot')).toMatchObject({ block: null, canBuy5: false });
  });

  it('the loadout toggles in and out, keeps its order and never takes a fourth item', () => {
    expect(toggleLoadout([], 'galeBell')).toEqual(['galeBell']);
    expect(toggleLoadout(['emberPot', 'heartstone'], 'galeBell')).toEqual(['emberPot', 'heartstone', 'galeBell']);
    expect(toggleLoadout(['emberPot', 'heartstone', 'galeBell'], 'heartstone')).toEqual(['emberPot', 'galeBell']);
    expect(toggleLoadout(['emberPot', 'heartstone', 'galeBell'], 'skyPurse')).toBeNull();
    expect(marketView(wallet(0, {}, ['emberPot', 'heartstone', 'galeBell'])).beltFull).toBe(true);
    expect(placeInSlot(['emberPot', 'heartstone'], 2, 'galeBell')).toEqual(['emberPot', 'heartstone', 'galeBell']);
    expect(placeInSlot(['emberPot', 'heartstone', 'galeBell'], 0, 'galeBell')).toEqual(['galeBell', 'heartstone']);
    expect(placeInSlot(['emberPot', 'heartstone'], 0, null)).toEqual(['heartstone']);
  });

  it('uses per run follow the difficulty cap (Hard: 1)', () => {
    expect(usesFor('normal', 7)).toBe(MARKET_RULES.useCap.normal);
    expect(usesFor('hard', 7)).toBe(MARKET_RULES.useCap.hard);
    expect(usesFor('easy', 1)).toBe(1);
    expect(usesFor('normal', 0)).toBe(0);
  });
});

describe('item belt rules', () => {
  it('slots follow the loadout order of the run belt; a run without items shows the saved loadout', () => {
    expect(beltIds({ heartstone: 3, emberPot: 1 }, ['emberPot', 'galeBell', 'heartstone'])).toEqual(['emberPot', 'heartstone']);
    expect(beltIds({ skyPurse: 2 }, [])).toEqual(['skyPurse']);
    expect(beltIds({}, ['frostLantern', 'cloudguard'])).toEqual(['frostLantern', 'cloudguard']);
    expect(beltIds({}, [])).toEqual([]);
  });

  it('state: off modes and replays, the end, used up, before the first horn, pointless casts', () => {
    expect(beltSlotState('emberPot', 1, { ...RUN, livesUntilNextUse: 1 })).toBe('reserve');
    expect(beltSlotState('emberPot', 3, { ...RUN, disabled: true })).toBe('disabled');
    expect(beltSlotState('emberPot', 3, { ...RUN, replaying: true })).toBe('disabled');
    expect(beltSlotState('emberPot', 3, { ...RUN, ended: true })).toBe('over');
    expect(beltSlotState('emberPot', 0, RUN)).toBe('empty');
    expect(beltSlotState('emberPot', 2, { ...RUN, preFirstWave: true })).toBe('waiting');
    expect(beltSlotState('emberPot', 2, { ...RUN, paused: true })).toBe('paused');
    expect(beltSlotState('heartstone', 2, { ...RUN, lives: 20 })).toBe('full');
    expect(beltSlotState('heartstone', 2, RUN)).toBe('ready');
    expect(beltSlotState('galeBell', 1, { ...RUN, enemies: 0 })).toBe('noFoes');
    // Ember Pot may be thrown on an empty patch ahead of a wave.
    expect(beltSlotState('emberPot', 1, { ...RUN, enemies: 0 })).toBe('ready');
  });

  it('targeted items aim (Meteor-style), instant items cast on press, anything not ready refuses', () => {
    const v = beltView(['emberPot', 'frostLantern', 'cloudguard'], { emberPot: 2, frostLantern: 1, cloudguard: 0 }, { cloudguard: 0 }, RUN);
    expect(v.map(beltPress)).toEqual(['aim', 'aim', 'refuse']);
    expect(v.map((s) => s.key)).toEqual(['Z', 'X', 'C']);
    expect(beltStateKey(v[2])).toBe('item.outOfStock');
    const self = beltView(['heartstone', 'skyPurse', 'galeBell'], { heartstone: 1, skyPurse: 1, galeBell: 1 }, {}, RUN);
    expect(self.map(beltPress)).toEqual(['cast', 'cast', 'cast']);
    expect(beltView(['emberPot'], { emberPot: 3 }, {}, { ...RUN, disabled: true })[0]).toMatchObject({ uses: 0, state: 'disabled' });
    for (const s of ['ready', 'disabled', 'waiting', 'reserve', 'empty', 'full', 'noFoes', 'over', 'paused'] as const) {
      const key = beltStateKey({ state: s, owned: 1 });
      expect(EN[key as keyof typeof EN], key).toBeTruthy();
      expect(TR[key as keyof typeof TR], key).toBeTruthy();
    }
  });

  it('keys Z / X / C pick slots and clash with no other run key', () => {
    expect(beltKeyIndex('z', 3)).toBe(0);
    expect(beltKeyIndex('X', 3)).toBe(1);
    expect(beltKeyIndex('c', 2)).toBe(-1);
    expect(beltKeyIndex('q', 3)).toBe(-1);
    const taken = new Set([...Object.values(ABILITY_KEYS), ...Object.values(HERO_KEYS), 'N', '1', '2', '3', 'W', 'A', 'S', 'D'].map((k) => k.toUpperCase()));
    for (const k of ITEM_KEYS) expect(taken.has(k), k).toBe(false);
  });
});

describe('HUD dock: the item group', () => {
  const OPTS = { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true };
  it('without items the tray is unchanged', () => {
    for (const [w, h] of [[1920, 1080], [844, 390]] as const) {
      const a = hudDock(w, h, NO_INSETS, OPTS);
      const b = hudDock(w, h, NO_INSETS, { ...OPTS, items: 0 });
      expect(b.tray).toEqual(a.tray);
      expect(b.items.n).toBe(0);
      expect(a.tray.w).toBe(trayLong(a.d, a.gap, true));
    }
  });

  it('three items sit in a row on desktops and phones, a pouch where the bottom line is too short', () => {
    for (const [w, h, ins, mode] of [
      [1512, 982, NO_INSETS, 'row'],
      [1920, 1080, NO_INSETS, 'row'],
      [1024, 768, NO_INSETS, 'row'],
      [844, 390, NO_INSETS, 'row'],
      [844, 390, { top: 0, right: 47, bottom: 21, left: 47 }, 'pouch'],
    ] as const) {
      const k = hudDock(w, h, ins, { ...OPTS, items: 3 });
      expect(k.items.mode, `${w}x${h}`).toBe(mode);
      expect(k.tray.w).toBe(trayLong(k.d, k.gap, true, 3, mode));
      expect(k.items.d).toBeGreaterThanOrEqual(40);
      // In its row between the plaque and the banner.
      expect(k.tray.x).toBeGreaterThanOrEqual(k.plaque.x + k.plaque.w);
      expect(k.tray.x + k.tray.w).toBeLessThanOrEqual(k.banner.x + 0.5);
      expect(itemGroupLong(k.d, k.gap, 3, mode)).toBeGreaterThan(0);
    }
  });
});

describe('full-bleed fit with the item belt', () => {
  const OPTS = { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true };
  it('the row is kept only where it covers no more of the island than the pouch', () => {
    for (const [w, h] of [[1920, 1080], [1512, 982], [844, 390]] as const) {
      for (const lv of LEVELS_2D.slice(0, 8)) {
        const L = lv.layout2d!;
        const sh = hardShapes(L);
        const dockFor = (itemMode: 'row' | 'pouch') => hudDock(w, h, NO_INSETS, { ...OPTS, items: 3, itemMode });
        const best = fullBleedFitItems(w, h, L, dockFor, sh);
        const pouch = fullBleedFit(w, h, L, dockFor('pouch'), sh);
        expect(dockCost(sh, best), `${w}x${h} ${lv.id}`).toBeLessThanOrEqual(dockCost(sh, pouch));
        expect(best.dock.items.n).toBe(3);
      }
    }
  });
});
