/**
 * Free-version scope + the store card (mobile builds only).
 *
 * On the iOS / Android builds the Prologue and Chapter 1 (`FREE_ISLANDS`) are free and Chapter 2
 * onward needs the `full_unlock` purchase (`platform/iap.ts`). The world map shows those islands with a "full
 * adventure" lock (a chest seal and a red ribbon, unlike the grey padlock of an island not yet
 * reached) and opens this card: the store's products with their names and prices as the store
 * adapter gives them, Buy, and Restore purchases.
 *
 * Web and Steam never show any of it (`storeEnabled()` is false: every island is playable).
 */
import { CHAPTERS } from '../../data/chapters.ts';
import { getIap, getPlatform, isUnlocked, type IapStoreAdapter, type IapStoreProduct } from '../../platform/index.ts';
import { FULL_UNLOCK_ENTITLEMENT } from '../../platform/iapProducts.ts';
import { t } from '../../i18n/index.ts';
import { el, glyph, img, KIT, openSheet, plank, type Sheet } from './dom.ts';
import { SEAL_GLYPHS, type IconName } from './paintedIcons.ts';

/** The free version is the Prologue + Chapter 1 (`FREE_ISLANDS`); the full adventure opens the rest. */
const FREE_CHAPTER = CHAPTERS[0];
const FIRST_PAID_CHAPTER = CHAPTERS[1];

/** Is the free-version scope (and the store) in force on this build? */
export function storeEnabled(iap: IapStoreAdapter = getIap()): boolean {
  const p = getPlatform();
  return p.isMobile && !p.isDesktop && !p.isSteam && iap.mode !== 'noop';
}

/** Can the island be played on this build (always on web / Steam; free isles or full unlock on mobile)? */
export function canPlayIsland(levelId: string, iap: IapStoreAdapter = getIap()): boolean {
  return !storeEnabled(iap) || isUnlocked(levelId, iap.entitlements());
}

/** Is the island one the full adventure opens (on a build where the scope applies, not owned yet)? */
export function needsFullAdventure(levelId: string, iap: IapStoreAdapter = getIap()): boolean {
  return !canPlayIsland(levelId, iap);
}

/** Does the player own the full adventure (only meaningful when `storeEnabled()`)? */
export function ownsFullAdventure(iap: IapStoreAdapter = getIap()): boolean {
  return iap.owned(FULL_UNLOCK_ENTITLEMENT);
}

/** URL of the world map with the store card open for `levelId` (deep links into a paid island). */
export function storeHref(levelId: string, search: string = location.search): string {
  const mock = new URLSearchParams(search).get('iapmock') === '1' ? '&iapmock=1' : '';
  return `${location.pathname}?store=${encodeURIComponent(levelId)}${mock}`;
}

const PRODUCT_ICON: Readonly<Record<string, IconName>> = { full_unlock: 'chest', starter_pack: 'medal', remove_ads: 'islands' };

/** The full adventure first (it is what the lock asks for), then the catalogue order. */
export function storeOrder(products: readonly IapStoreProduct[]): IapStoreProduct[] {
  return [...products].sort((a, b) => Number(b.id === FULL_UNLOCK_ENTITLEMENT) - Number(a.id === FULL_UNLOCK_ENTITLEMENT));
}

export interface StoreCardOptions {
  /** Name of the island the player tapped (null when opened from Settings or for a hidden island). */
  readonly islandName?: string | null;
  /** Total islands on the route (for the intro line). */
  readonly totalIslands: number;
  /** After a purchase / restore changed what is owned: refresh the map. */
  readonly onOwnedChange?: () => void;
  readonly onClose?: () => void;
  readonly iap?: IapStoreAdapter;
}

/** Opens the painted store card. */
export function openStore(opts: StoreCardOptions): Sheet {
  const iap = opts.iap ?? getIap();
  const sheet = openSheet(t('store.title'), { cls: 'pu-meta pu-store', testid: 'store2d', onClose: opts.onClose });
  const intro = el(
    'div',
    'pu-meta-note pu-ink-soft pu-store-intro',
    {},
    opts.islandName ? el('b', 'pu-ink', {}, t('store.introIsland', { name: opts.islandName }) + ' ') : null,
    t('store.intro', { free: FREE_CHAPTER.n, n: FIRST_PAID_CHAPTER.n, total: opts.totalIslands }),
  );
  const list = el('div', 'pu-store-list', { 'data-testid': 'store2d-list' });
  const status = el('div', 'pu-store-status pu-ink', { role: 'status', 'aria-live': 'polite', 'data-testid': 'store2d-status' });
  const restore = plank(t('store.restore'), { kind: 'small', testid: 'store2d-restore' });
  const foot = el('div', 'pu-store-foot', {}, restore, status);
  sheet.body.append(intro, list, foot);

  let products: IapStoreProduct[] = [];
  let busy = false;
  const say = (msg: string, tone: 'ok' | 'bad' | '' = ''): void => {
    status.textContent = msg;
    status.className = `pu-store-status pu-ink${tone ? ` ${tone}` : ''}`;
  };
  const setBusy = (v: boolean): void => {
    busy = v;
    sheet.sheet.classList.toggle('busy', v);
    sheet.body.querySelectorAll<HTMLButtonElement>('button[data-store-action]').forEach((b) => {
      b.disabled = v;
    });
  };

  const card = (p: IapStoreProduct): HTMLElement => {
    const owned = p.kind === 'non_consumable' && iap.owned(p.id);
    const main = p.id === FULL_UNLOCK_ENTITLEMENT;
    const iconName = PRODUCT_ICON[p.id] ?? 'medal';
    // Painted wax seals bring their own backing; the chest (still SVG) sits on the round button.
    const icon = el('span', `pu-store-icon${SEAL_GLYPHS.has(iconName) ? ' seal' : ''}`);
    icon.append(glyph(iconName));
    // Name and price exactly as the store adapter gives them (store-localised on the phone).
    const name = el('div', 'pu-ws-name pu-store-name', {}, p.title || p.id);
    const blurb = main ? t('store.blurbFull', { n: FIRST_PAID_CHAPTER.n }) : p.description;
    const price = el('span', 'pu-store-price pu-ink', { 'data-testid': `store2d-price-${p.id}` }, img(KIT.gold, '', 'pu-store-price-coin'), p.priceString);
    let action: HTMLElement;
    if (owned) {
      action = el('span', 'pu-store-owned pu-letter', { 'data-testid': `store2d-owned-${p.id}` });
      action.append(glyph('crown'), t('store.owned'));
    } else {
      const buy = plank(t('store.buy'), { kind: main ? undefined : 'small', testid: `store2d-buy-${p.id}` });
      buy.dataset.storeAction = 'buy';
      buy.setAttribute('aria-label', t('store.buyAria', { name: p.title || p.id, price: p.priceString }));
      buy.addEventListener('click', () => void buyProduct(p));
      action = buy;
    }
    return el(
      'div',
      `pu-store-item pu-card${main ? ' main' : ''}${owned ? ' owned' : ''}`,
      { 'data-product': p.id },
      el('div', 'pu-store-top', {}, icon, name),
      blurb ? el('div', 'pu-store-blurb pu-ink-soft', {}, blurb) : null,
      el('div', 'pu-store-row', {}, owned ? null : price, action),
    );
  };

  const render = (): void => {
    list.replaceChildren(...storeOrder(products).map(card));
    setBusy(busy);
  };

  const load = async (): Promise<void> => {
    list.replaceChildren(el('div', 'pu-store-empty pu-ink-soft', {}, t('store.loading')));
    products = (await iap.products().catch((): IapStoreProduct[] => [])).filter(product => product.kind === 'non_consumable');
    if (products.length === 0) {
      const retry = plank(t('store.retry'), { kind: 'small', testid: 'store2d-retry' });
      retry.addEventListener('click', () => void load());
      list.replaceChildren(el('div', 'pu-store-empty pu-ink-soft', {}, t('store.empty'), retry));
      return;
    }
    render();
  };

  const buyProduct = async (p: IapStoreProduct): Promise<void> => {
    if (busy) return;
    setBusy(true);
    say(t('store.busy'));
    const res = await iap.purchase(p.id).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      say(p.id === FULL_UNLOCK_ENTITLEMENT ? t('store.thanks') : t('store.thanksOther'), 'ok');
      render();
      opts.onOwnedChange?.();
      return;
    }
    const st = res?.status ?? 'error';
    say(st === 'cancelled' ? t('store.cancelled') : st === 'unavailable' ? t('store.unavailable') : t('store.failed'), st === 'cancelled' ? '' : 'bad');
  };

  restore.dataset.storeAction = 'restore';
  restore.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    say(t('store.busy'));
    const res = await iap.restore().catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      say(t('store.restoreFailed'), 'bad');
      return;
    }
    say(res.restored.length > 0 ? t('store.restored', { n: res.restored.length }) : t('store.nothingToRestore'), res.restored.length > 0 ? 'ok' : '');
    if (products.length > 0) render();
    if (res.restored.length > 0) opts.onOwnedChange?.();
  });

  void load();
  return sheet;
}
