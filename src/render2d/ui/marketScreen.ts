/**
 * The Market (world map → crystal button): Sky Crystals buy belt items, and the player picks up to
 * three of them to carry into battle. Every rule and number comes from the market API
 * (docs/market.md, src/render2d/ui/market2d.ts); this module is the painted view only.
 *
 *   ┌ stall painting (header) with the wallet on its counter ──────────────────┐
 *   │ belt: three slots · "pick up to 3" · the per-island cap in one line       │
 *   │ six item cards: icon, name, rules, ×owned, belt toggle, price, Buy / ×5   │
 *   │ (mobile builds only) Sky Crystal packs from the store, Restore, status    │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *
 * The pack section exists only where `crystalStoreEnabled()` is true (iOS / Android); on web, Steam
 * and desktop it is never built.
 */
import { type CrystalPackId, isCrystalPack, MARKET_RULES, CRYSTAL_PACKS, type ItemId } from '../../data/market.ts';
import type { MarketWallet } from '../../game/market.ts';
import { crystalStoreEnabled, getIap, listCrystalPacks, purchaseCrystalPack, type IapPurchaseResult, type IapStoreProduct } from '../../platform/iap.ts';
import { itemDesc, itemName } from '../../i18n/data.ts';
import { t } from '../../i18n/index.ts';
import { el, img, openSheet, plank, type Sheet } from './dom.ts';
import { buyItem2D, readMarket2D, setLoadout2D } from './market2d.ts';
import { CRYSTAL_ICON, CRYSTAL_ICON_LARGE, itemIconUrl, MARKET_STALL, marketView, toggleLoadout, type MarketCard } from './marketModel.ts';
import { onProgress2DCloudHydrated } from './progress2d.ts';
import './market.css';

/** The mobile crystal store as the screen sees it (the real one is the iap.ts facade; QA injects a mock in dev builds). */
export interface CrystalShop {
  enabled(): boolean;
  list(): Promise<IapStoreProduct[]>;
  purchase(id: CrystalPackId): Promise<IapPurchaseResult>;
  restore(): Promise<{ readonly ok: boolean }>;
}

export const STORE_SHOP: CrystalShop = {
  enabled: () => crystalStoreEnabled(),
  list: () => listCrystalPacks(),
  purchase: (id) => purchaseCrystalPack(id),
  restore: () => getIap().restore(),
};

export interface MarketScreenOptions {
  /** After a purchase / loadout change: the map refreshes its wallet chip. */
  readonly onChange?: () => void;
  readonly onClose?: () => void;
  readonly shop?: CrystalShop;
}

const reduced = (): boolean => document.documentElement.classList.contains('pu-reduce-motion');

/** The crystal + number chip (the wallet on the header, prices on the Buy planks). */
export function crystalAmount(n: number | string, cls = ''): HTMLSpanElement {
  return el('span', `pu-crystal-amt${cls ? ` ${cls}` : ''}`, {}, img(CRYSTAL_ICON, '', 'pu-crystal-ico'), el('b', '', {}, String(n)));
}

/** The icon of an item in a round painted socket. */
export function itemSocket(id: ItemId | null, cls = ''): HTMLSpanElement {
  const s = el('span', `pu-item-socket${id ? '' : ' empty'}${cls ? ` ${cls}` : ''}`);
  if (id) {
    const pic = img(itemIconUrl(id), '', 'pu-item-ico');
    pic.srcset = `${itemIconUrl(id, 1)} 1x, ${itemIconUrl(id, 2)} 2x`;
    s.append(pic);
  }
  return s;
}

export function openMarket(opts: MarketScreenOptions = {}): Sheet {
  const shop = opts.shop ?? STORE_SHOP;
  let unhydrate: () => void = () => undefined;
  const sheet = openSheet(t('market.title'), {
    cls: 'pu-meta pu-market',
    testid: 'market2d',
    onClose: () => {
      unhydrate();
      opts.onClose?.();
    },
  });
  let wallet: MarketWallet = readMarket2D();
  let shownCrystals = wallet.crystals;
  let lastBought: ItemId | null = null;
  let lastBoughtN = 0;
  let note: { text: string; tone: '' | 'bad' } | null = null;

  // --- header: the stall with the wallet on its counter -----------------------------------------
  const walletNum = el('b', '', { 'data-testid': 'market2d-crystals' }, String(wallet.crystals));
  const walletBox = el('div', 'pu-tally pu-letter pu-market-wallet', { 'data-testid': 'market2d-wallet', role: 'status' }, img(CRYSTAL_ICON, '', 'pu-crystal-ico'), walletNum, el('small', '', {}, t('market.currency')));
  const stall = el('div', 'pu-market-stall', {}, img(MARKET_STALL, '', 'pu-market-stall-art'), walletBox);

  // --- belt ---------------------------------------------------------------------------------------
  const beltSlots = el('div', 'pu-market-slots', { role: 'list', 'aria-label': t('market.loadout') });
  const beltNote = el('div', 'pu-market-beltnote pu-ink-soft', { 'aria-live': 'polite' });
  const belt = el(
    'section',
    'pu-market-belt pu-card',
    { 'data-testid': 'market2d-belt' },
    el('div', 'pu-market-belthead', {}, el('h3', 'pu-letter', {}, t('market.loadout')), beltSlots),
    el(
      'div',
      'pu-market-beltrules pu-ink-soft',
      {},
      el('span', '', {}, t('market.loadoutHint', { n: MARKET_RULES.slots })),
      ' ',
      el('span', 'pu-market-cap', { 'data-testid': 'market2d-cap' }, t('market.capLine', MARKET_RULES.useCap)),
    ),
    beltNote,
  );

  const grid = el('div', 'pu-market-grid', { 'data-testid': 'market2d-items' });
  // The stall + wallet stay put above the scrolling body: the wallet is always in view.
  sheet.sheet.insertBefore(stall, sheet.body);
  sheet.body.append(belt, grid);

  const setLoadout = (next: ItemId[] | null): void => {
    if (!next) {
      note = { text: t('market.beltFull'), tone: 'bad' };
      render();
      return;
    }
    if (setLoadout2D(next)) {
      note = null;
      wallet = readMarket2D();
      render();
      opts.onChange?.();
    }
  };

  const tickWallet = (to: number): void => {
    const from = shownCrystals;
    shownCrystals = to;
    if (from === to || reduced()) {
      walletNum.textContent = String(to);
      return;
    }
    walletBox.classList.remove('spent');
    void walletBox.offsetWidth;
    walletBox.classList.add('spent');
    const t0 = performance.now();
    const step = (): void => {
      const k = Math.min(1, (performance.now() - t0) / 320);
      walletNum.textContent = String(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const buy = (id: ItemId, n: number): void => {
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (!buyItem2D(id)) break;
      got++;
    }
    wallet = readMarket2D();
    if (got > 0) {
      lastBought = id;
      lastBoughtN = got;
      note = null;
      opts.onChange?.();
    }
    render();
  };

  const buyFull5 = (c: MarketCard): boolean => c.owned + 5 > MARKET_RULES.inventoryCap;
  const card = (c: MarketCard): HTMLElement => {
    const name = itemName(c.id);
    const on = c.slot !== -1;
    const fresh = lastBought === c.id;
    const root = el('article', `pu-market-item pu-card${on ? ' equipped' : ''}${fresh ? ' just-bought' : ''}`, { 'data-item': c.id, 'data-testid': `market2d-item-${c.id}` });
    const icon = itemSocket(c.id, 'big');
    const owned = el('span', 'pu-market-owned pu-letter', { title: t('market.owned', { n: c.owned }), 'aria-label': t('market.owned', { n: c.owned }), 'data-testid': `market2d-owned-${c.id}` }, t('market.ownedShort', { n: c.owned }));
    icon.append(owned);
    if (fresh && !reduced()) icon.append(el('span', 'pu-market-plus pu-letter', { 'aria-hidden': 'true' }, `+${lastBoughtN}`));
    // The belt toggle: a painted check seal on the card's corner, gold when the item is carried.
    const equip = el('button', `pu-market-equip${on ? ' on' : ''}`, {
      type: 'button',
      role: 'switch',
      'aria-checked': String(on),
      'aria-label': on ? t('market.unequipAria', { name }) : t('market.equipAria', { name }),
      title: on ? t('market.unequip') : c.canEquip ? t('market.equip') : t('market.beltFull'),
      'data-testid': `market2d-equip-${c.id}`,
    });
    equip.append(img('/art2d/ui/icon-confirm.webp', '', 'pu-market-check'), el('span', 'pu-letter', {}, on ? String(c.slot + 1) : '+'));
    equip.addEventListener('click', () => setLoadout(toggleLoadout(wallet.loadout, c.id)));
    const head = el('div', 'pu-market-itemhead', {}, icon, el('div', 'pu-market-itemtext', {}, el('div', 'pu-ws-name', {}, name), on ? el('div', 'pu-market-tag pu-ink', {}, t('market.equipped')) : null), equip);
    const desc = el('div', 'pu-market-desc pu-ink-soft', {}, itemDesc(c.id));
    const why = c.block === 'short' ? t('market.insufficient') : c.block === 'full' ? t('market.full') : '';
    const whyShort = c.block === 'short' ? t('market.short') : c.block === 'full' ? t('market.fullShort') : '';
    const b1 = plank(t('market.buy'), { kind: 'small', testid: `market2d-buy-${c.id}` });
    b1.append(crystalAmount(c.price, 'on-plank'));
    b1.disabled = c.block !== null;
    b1.setAttribute('aria-label', t('market.buyAria', { name, n: c.price }));
    if (why) b1.title = why;
    b1.addEventListener('click', () => buy(c.id, 1));
    const b5 = plank(t('market.buy5'), { kind: 'small', testid: `market2d-buy5-${c.id}` });
    b5.classList.add('pu-market-buy5');
    b5.disabled = !c.canBuy5;
    b5.setAttribute('aria-label', t('market.buyAria', { name: `${name} ×5`, n: c.price * 5 })); // i18n-ignore (count suffix)
    if (!c.canBuy5) b5.title = c.block === 'full' || buyFull5(c) ? t('market.full') : t('market.insufficient');
    b5.addEventListener('click', () => buy(c.id, 5));
    // Why Buy is off sits on the left of the planks (the price is on the Buy plank itself).
    const row = el('div', 'pu-market-row', {}, el('span', 'pu-market-why pu-ink-soft', { title: why }, whyShort), el('span', 'pu-market-buys', {}, b5, b1));
    if (c.block === 'short') b1.classList.add('short');
    root.append(head, desc, row);
    return root;
  };
  const render = (): void => {
    const v = marketView(wallet);
    tickWallet(v.crystals);
    walletBox.setAttribute('aria-label', t('market.walletAria', { n: v.crystals }));
    beltSlots.replaceChildren(
      ...v.slots.map((id, i) => {
        const s = el('button', `pu-market-slot${id ? '' : ' empty'}`, {
          type: 'button',
          role: 'listitem',
          'data-testid': `market2d-slot-${i}`,
          'aria-label': id ? t('market.unequipAria', { name: itemName(id) }) : t('market.slotEmpty'),
          title: id ? itemName(id) : t('market.slotEmpty'),
        });
        s.append(itemSocket(id), el('span', 'pu-market-slotn pu-letter', { 'aria-hidden': 'true' }, String(i + 1)));
        if (id) s.addEventListener('click', () => setLoadout(toggleLoadout(wallet.loadout, id)));
        else s.disabled = true;
        return s;
      }),
    );
    beltNote.textContent = note?.text ?? '';
    beltNote.className = `pu-market-beltnote pu-ink-soft${note?.tone === 'bad' ? ' bad' : ''}`;
    grid.replaceChildren(...v.cards.map(card));
    lastBought = null;
  };

  // --- mobile crystal packs (iOS / Android only) ------------------------------------------------
  if (shop.enabled()) sheet.body.append(packSection(shop, () => {
    wallet = readMarket2D();
    render();
    opts.onChange?.();
  }));

  unhydrate = onProgress2DCloudHydrated(() => {
    wallet = readMarket2D();
    render();
  });
  render();
  return sheet;
}

/** "Sky Crystal packs": the store's own titles and prices, Buy (disabled while pending), Restore, status. */
function packSection(shop: CrystalShop, refresh: () => void): HTMLElement {
  const list = el('div', 'pu-market-packs', { 'data-testid': 'market2d-packs' });
  const status = el('div', 'pu-store-status pu-ink', { role: 'status', 'aria-live': 'polite', 'data-testid': 'market2d-pack-status' });
  const restore = plank(t('market.restore'), { kind: 'small', testid: 'market2d-restore' });
  const box = el(
    'section',
    'pu-market-packbox',
    { 'data-testid': 'market2d-packbox' },
    el('h3', 'pu-letter', {}, t('market.packs')),
    list,
    el('div', 'pu-store-foot', {}, restore, status),
  );
  let products: IapStoreProduct[] = [];
  let pending: string | null = null;
  const say = (msg: string, tone: '' | 'ok' | 'bad' = ''): void => {
    status.textContent = msg;
    status.className = `pu-store-status pu-ink${tone ? ` ${tone}` : ''}`;
  };
  const paint = (): void => {
    list.replaceChildren(
      ...products.map((p) => {
        const grant = isCrystalPack(p.id) ? CRYSTAL_PACKS[p.id] : 0;
        const buy = plank(p.priceString, { kind: 'small', testid: `market2d-pack-buy-${p.id}` });
        buy.disabled = pending !== null;
        buy.setAttribute('aria-label', t('market.packAria', { name: p.title || p.id, price: p.priceString }));
        if (pending === p.id) buy.classList.add('pending');
        buy.addEventListener('click', () => void purchase(p));
        return el(
          'div',
          `pu-market-pack pu-card${pending === p.id ? ' pending' : ''}`,
          { 'data-pack': p.id },
          img(CRYSTAL_ICON_LARGE, '', 'pu-market-pack-ico'),
          el('div', 'pu-market-packtext', {}, el('div', 'pu-ws-name', {}, p.title || p.id), crystalAmount(`+${grant}`, 'big')),
          buy,
        );
      }),
    );
    restore.disabled = pending !== null;
  };
  const load = async (): Promise<void> => {
    list.replaceChildren(el('div', 'pu-store-empty pu-ink-soft', {}, t('market.packsLoading')));
    products = (await shop.list().catch((): IapStoreProduct[] => [])).filter((p) => isCrystalPack(p.id));
    if (products.length === 0) {
      const retry = plank(t('market.retry'), { kind: 'small', testid: 'market2d-pack-retry' });
      retry.addEventListener('click', () => void load());
      list.replaceChildren(el('div', 'pu-store-empty pu-ink-soft', {}, t('market.packsEmpty'), retry));
      return;
    }
    paint();
  };
  const purchase = async (p: IapStoreProduct): Promise<void> => {
    if (pending || !isCrystalPack(p.id)) return;
    pending = p.id;
    paint();
    say(t('market.packBusy'));
    const res = await shop.purchase(p.id).catch((): null => null);
    pending = null;
    if (res?.ok) {
      say(t('market.packOk', { n: CRYSTAL_PACKS[p.id] }), 'ok');
      refresh();
      paint();
      return;
    }
    const st = res?.status ?? 'error';
    if (st === 'pending_delivery') {
      say(t('market.pendingDelivery'), 'bad');
      // Reconcile the completed charge (the store adapter redelivers on listing).
      await load();
      refresh();
      return;
    }
    say(st === 'cancelled' ? t('market.packCancelled') : t('market.packFailed'), st === 'cancelled' ? '' : 'bad');
    paint();
  };
  restore.addEventListener('click', async () => {
    if (pending) return;
    pending = 'restore';
    paint();
    say(t('market.packBusy'));
    const res = await shop.restore().catch(() => null);
    pending = null;
    say(res?.ok ? t('market.restored') : t('market.restoreFailed'), res?.ok ? 'ok' : 'bad');
    refresh();
    paint();
  });
  void load();
  return box;
}
