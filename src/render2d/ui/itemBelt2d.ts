/**
 * The item belt of a 2D run: up to three Market items behind the abilities in the HUD tray
 * (hudDock.ts `items`: a row, or one pouch button that opens them above the tray on a narrow
 * screen). Each slot shows the item's icon, pips for the uses left on this island, the stock in the
 * pack, a key chip on desktops (Z / X / C) and a parchment tooltip with the rules and why it is off.
 *
 * - Targeted items (Ember Pot, Frost Lantern: a point; Cloudguard: snapped to a road) aim like
 *   Meteor: a radius preview under the pointer (itemFx.ts), cast on click / release; a second press,
 *   Esc or a right click cancels. A refused cast (nothing to freeze, no road in reach) keeps the aim
 *   and says so; nothing is spent.
 * - Instant items (Heartstone, Sky Purse, Gale Bell) cast on the press.
 * - Off (greyed, reason in the tooltip) for challenge / Daily / Endless runs and replays, before the
 *   first horn, when used up, and while the rule makes the cast pointless (full lives, no foes).
 *
 * Casting goes through `game.useItem` (recorded, debits the belt and the save); the rules stay in the
 * sim (src/sim/itemSystem.ts). FX: itemFx.ts, from the sim's events.
 */
import { heartstoneCeiling, MARKET_RULES, type ItemCounts, type ItemId } from '../../data/market.ts';
import { itemDesc, itemName } from '../../i18n/data.ts';
import { t, type MsgKey } from '../../i18n/index.ts';
import { haptics } from '../../platform/haptics.ts';
import type { EventBus } from '../../core/eventBus.ts';
import type { Game2D } from '../game2d.ts';
import { ItemFx } from '../itemFx.ts';
import type { Rect } from '../uiLayout.ts';
import { anySheetOpen, el, img, KIT } from './dom.ts';
import { readMarket2D } from './market2d.ts';
import { beltIds, beltKeyIndex, beltPress, beltStateKey, beltView, itemIconUrl, itemKeys, type BeltRunState, type BeltSlotView } from './marketModel.ts';
import { badgeLabel, eventKey } from './keyBindings.ts';
import { tipKey } from './padBadges.ts';
import './itemBelt2d.css';

export interface ItemBelt2D {
  /** The group the ability bar lays out behind its buttons. */
  readonly el: HTMLElement;
  frame(dt: number): void;
  setVisible(visible: boolean): void;
  readonly aiming: ItemId | null;
  /** Aim / cast a slot as a press would (QA), or cancel (null). */
  press(id: ItemId | null): void;
  /** QA: preview the held aim at a screen point (css px on the canvas) and commit there. */
  castAt(x: number, y: number): boolean;
  debug(): Record<string, unknown>;
}

export interface ItemBeltOptions {
  readonly desktop: boolean;
  /** An item started aiming: the abilities / hero drop theirs. */
  readonly onAimStart?: () => void;
}

interface Slot {
  readonly id: ItemId;
  readonly btn: HTMLButtonElement;
  readonly frame: HTMLImageElement;
  readonly pips: HTMLSpanElement;
  readonly stock: HTMLSpanElement;
  readonly lock: HTMLSpanElement;
  readonly keyChip: HTMLSpanElement | null;
  view: BeltSlotView | null;
  key: string;
}

/**
 * Locked charge (Normal / Hard rescue rule: the belt's 2nd and 3rd casts open after 5 / 10 lost
 * lives): a heart chip on the medallion's face with the lives still to lose before it opens.
 */
function lockChip(): HTMLSpanElement {
  return el('span', 'pu-item-lock pu-letter', { 'aria-hidden': 'true', hidden: true }, img(KIT.heart, '', 'pu-item-lock-heart'), el('b'));
}

function setLock(lock: HTMLSpanElement, need: number): void {
  lock.hidden = need <= 0;
  const n = lock.querySelector('b');
  if (n) n.textContent = need > 0 ? String(need) : '';
}

export function mountItemBelt2D(game: Game2D, opts: ItemBeltOptions): ItemBelt2D {
  const canvas = game.app.canvas;
  const stage = canvas.parentElement ?? document.body;
  const fx = new ItemFx(game);
  const group = el('div', 'pu-items', { role: 'group', 'aria-label': t('market.loadout'), 'data-testid': 'item2d-belt' });
  const divider = el('span', 'pu-items-div', { 'aria-hidden': 'true' });
  const row = el('div', 'pu-items-row');
  // Pouch (narrow screens): one button; the slots open in a parchment strip above the tray.
  const pouch = el('button', 'pu-ab pu-item pu-items-pouch', { type: 'button', 'data-testid': 'item2d-pouch', 'aria-label': t('item.pouchAria'), 'aria-expanded': 'false' });
  const pouchIcon = el('span', 'pu-ab-icon');
  const pouchLock = lockChip();
  pouch.append(img(KIT.medallion, '', 'pu-ab-frame'), pouchIcon, el('span', 'pu-item-stock pu-letter pu-items-pouchn'), pouchLock);
  const pop = el('div', 'pu pu-items-pop', { 'data-testid': 'item2d-pop', hidden: true });
  group.append(divider, row, pouch);
  const tip = el('div', 'pu pu-ab-tip pu-item-tip', { role: 'tooltip', id: 'item2d-tip', hidden: true });
  const hint = el('div', 'pu pu-ab-hint', { 'data-testid': 'item2d-hint', hidden: true, 'aria-live': 'polite' });
  document.body.append(tip, hint, pop);

  let visible = true;
  let slots: Slot[] = [];
  let mode: 'row' | 'pouch' = 'row';
  let popOpen = false;
  let stock: Partial<Record<ItemId, number>> = {};
  let loadout: ItemId[] = [];

  const makeSlot = (id: ItemId, i: number): Slot => {
    const btn = el('button', 'pu-ab pu-item', { type: 'button', 'data-item': id, 'data-testid': `item2d-${id}`, 'aria-describedby': 'item2d-tip' });
    const frame = img(KIT.medallion, '', 'pu-ab-frame');
    const icon = el('span', 'pu-ab-icon pu-item-icon');
    const pic = img(itemIconUrl(id), '', 'pu-item-art');
    pic.srcset = `${itemIconUrl(id, 1)} 1x, ${itemIconUrl(id, 2)} 2x`;
    icon.append(pic);
    const pips = el('span', 'pu-item-pips', { 'aria-hidden': 'true' });
    const stockEl = el('span', 'pu-item-stock pu-letter', { 'aria-hidden': 'true' });
    const cancel = el('span', 'pu-ab-cancel', { 'aria-hidden': 'true' }, '✕');
    const lock = lockChip();
    btn.append(frame, icon, pips, stockEl, lock, cancel);
    let keyChip: HTMLSpanElement | null = null;
    if (opts.desktop) {
      keyChip = el('span', 'pu-ab-key pu-letter', { 'aria-hidden': 'true' }, badgeLabel(itemKeys()[i] ?? ''));
      btn.append(keyChip);
    }
    btn.addEventListener('click', (e) => {
      if (e.detail > 0) btn.blur();
      press(id);
    });
    btn.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') showTip(id);
    });
    btn.addEventListener('pointerleave', () => showTip(null));
    btn.addEventListener('focus', () => showTip(id));
    btn.addEventListener('blur', () => showTip(null));
    return { id, btn, frame, pips, stock: stockEl, lock, keyChip, view: null, key: '' };
  };

  // --- run binding ------------------------------------------------------------------------------
  let bound: EventBus | null = null;
  let unbind: (() => void)[] = [];
  const readWallet = (): void => {
    try {
      const w = readMarket2D();
      stock = w.inventory;
      loadout = w.loadout;
    } catch {
      stock = {};
      loadout = [];
    }
  };
  const bind = (): void => {
    for (const u of unbind) u();
    bound = game.events;
    setAim(null);
    readWallet();
    const initial: ItemCounts = game.world.itemSystem.initial;
    const ids = beltIds(initial, game.replaying ? [] : loadout);
    slots = ids.map(makeSlot);
    row.replaceChildren(...slots.map((s) => s.btn));
    // The pouch shows the belt's items as a little cluster (not one item's face).
    pouchIcon.replaceChildren(el('span', `pu-items-cluster n${ids.length}`, {}, ...ids.map((id) => img(itemIconUrl(id, 1), '', 'pu-items-mini'))));
    group.hidden = ids.length === 0;
    if (game.itemSlots !== ids.length) {
      game.itemSlots = ids.length;
      game.resize(game.app.screen.width, game.app.screen.height);
    }
    unbind = [
      bound.on('itemCast', (e) => {
        readWallet();
        const s = slots.find((q) => q.id === e.id);
        if (s) {
          s.btn.classList.remove('cast-pop');
          void s.btn.offsetWidth;
          s.btn.classList.add('cast-pop');
        }
      }),
    ];
  };

  // --- layout (the dock's item group: row or pouch) -----------------------------------------------
  const layout = (): void => {
    const k = game.dock.items;
    mode = k.mode;
    group.style.setProperty('--di', `${k.d}px`);
    group.style.setProperty('--igap', `${k.gap}px`);
    group.classList.toggle('pouch', mode === 'pouch');
    if (mode === 'pouch') {
      if (pop.firstChild !== row) pop.append(row);
    } else {
      if (row.parentElement !== group) group.insertBefore(row, pouch);
      setPop(false);
    }
  };
  const setPop = (open: boolean): void => {
    popOpen = open && mode === 'pouch';
    pop.hidden = !popOpen;
    pouch.setAttribute('aria-expanded', String(popOpen));
    pouch.classList.toggle('is-open', popOpen);
    if (!popOpen) return;
    pop.style.setProperty('--di', `${game.dock.items.d}px`);
    pop.style.setProperty('--igap', `${game.dock.items.gap}px`);
    const b = pouch.getBoundingClientRect();
    const tray = game.dock.tray;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    pop.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - pw - 6, b.left + b.width / 2 - pw / 2)))}px`;
    pop.style.top = `${Math.round(Math.max(6, tray.y - 8 - ph))}px`;
  };
  pouch.addEventListener('click', (e) => {
    if (e.detail > 0) pouch.blur();
    setPop(!popOpen);
  });

  // --- tooltip ----------------------------------------------------------------------------------
  let tipFor: ItemId | null = null;
  // Lives still to lose before the next belt cast opens (the Normal / Hard rescue rule; 0 = open).
  let need = 0;
  const stateText = (v: BeltSlotView): string => (v.state === 'reserve' ? t('item.reserve', { n: need }) : t(beltStateKey(v) as MsgKey));
  const reserveRule = (): string => {
    const step = MARKET_RULES.livesLostPerExtraUse[game.world.mods.marketDifficulty];
    return t('item.reserveRule', { a: step, b: step * 2 });
  };
  const showTip = (id: ItemId | null): void => {
    tipFor = id;
    const s = id ? slots.find((q) => q.id === id) : null;
    if (!id || !s || !s.view) {
      tip.hidden = true;
      return;
    }
    const v = s.view;
    const head = el('div', 'pu-ab-tip-head pu-ink', {}, itemName(id));
    if (opts.desktop && v.key) head.append(tipKey(v.key, v.key));
    tip.replaceChildren(
      head,
      el('div', 'pu-ab-tip-desc pu-ink-soft', {}, itemDesc(id)),
      el('div', 'pu-item-tip-uses pu-ink', {}, t('item.uses', { n: v.uses }), ' · ', t('item.stock', { n: v.owned })),
      el('div', `pu-item-tip-state${v.state === 'ready' ? ' ok' : ''}`, {}, stateText(v)),
      v.state === 'reserve' ? el('div', 'pu-item-tip-rule pu-ink-soft', {}, reserveRule()) : '',
    );
    tip.hidden = false;
    const b = s.btn.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    tip.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - tw - 6, b.left + b.width / 2 - tw / 2)))}px`;
    tip.style.top = `${Math.round(Math.max(6, b.top - 10 - th))}px`;
  };

  // --- aiming -------------------------------------------------------------------------------------
  let aiming: ItemId | null = null;
  let lastPointer: { x: number; y: number } | null = null;
  let down: { x: number; y: number; id: number } | null = null;
  let synthetic = false;
  const local = (e: PointerEvent | MouseEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const insideMap = (p: { x: number; y: number }): boolean => {
    const m = game.map;
    const mx = (p.x - m.fit.offsetX) / m.fit.scale;
    const my = (p.y - m.fit.offsetY) / m.fit.scale;
    return mx >= 0 && my >= 0 && mx <= m.imageW && my <= m.imageH;
  };
  const preview = (p: { x: number; y: number } | null): { x: number; z: number; ok: boolean } | null => {
    if (!aiming) return null;
    const at = p ?? { x: game.app.screen.width / 2, y: game.app.screen.height * 0.45 };
    return fx.showAim(aiming, game.map.worldXFromScreen(at.x), game.map.worldZFromScreen(at.y), insideMap(at));
  };
  const placeHint = (): void => {
    if (hint.hidden) return;
    const tray = game.dock.tray;
    const hw = hint.offsetWidth;
    const hh = hint.offsetHeight;
    hint.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - hw - 6, tray.x + tray.w / 2 - hw / 2)))}px`;
    hint.style.top = `${Math.round(Math.max(6, tray.y - 10 - hh - (popOpen ? pop.offsetHeight + 8 : 0)))}px`;
  };
  const showHint = (extra?: string): void => {
    if (!aiming) {
      hint.hidden = true;
      return;
    }
    const mouse = opts.desktop;
    const road = aiming === 'cloudguard';
    const aimText = t(road ? (mouse ? 'item.aimRoadMouse' : 'item.aimRoad') : mouse ? 'item.aimPointMouse' : 'item.aimPoint');
    const pad = document.documentElement.classList.contains('pu-kbd');
    hint.replaceChildren(el('div', 'pu-ink', {}, extra ?? aimText), el('small', 'pu-ink-soft', {}, t(pad ? 'hero.aimHintPad' : mouse ? 'ab.cancelMouse' : 'ab.cancelTouch')));
    hint.hidden = false;
    placeHint();
  };
  const nudgeHint = (msg: string): void => {
    showHint(msg);
    hint.classList.remove('nudge');
    void hint.offsetWidth;
    hint.classList.add('nudge');
  };
  const setAim = (id: ItemId | null): void => {
    if (id && aiming !== id) {
      opts.onAimStart?.();
      game.setHeroSelected(false);
      // Close the build ring through game2d's own Esc shortcut.
      synthetic = true;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      synthetic = false;
    }
    aiming = id;
    down = null;
    group.dataset.aiming = id ?? '';
    for (const s of slots) s.btn.classList.toggle('is-aiming', s.id === id);
    if (!id) {
      fx.hideAim();
      canvas.style.cursor = '';
    } else {
      preview(lastPointer && insideMap(lastPointer) ? lastPointer : null);
      canvas.style.cursor = 'crosshair';
    }
    showHint();
  };
  const nope = (s: Slot): void => {
    s.btn.classList.remove('nope');
    void s.btn.offsetWidth;
    s.btn.classList.add('nope');
    if (!opts.desktop) {
      showTip(s.id);
      window.setTimeout(() => {
        if (tipFor === s.id) showTip(null);
      }, 1800);
    }
  };
  const press = (id: ItemId | null): void => {
    if (!id) {
      setAim(null);
      return;
    }
    if (aiming === id) {
      setAim(null);
      return;
    }
    const s = slots.find((q) => q.id === id);
    if (!s) return;
    s.view = currentView().find((v) => v.id === id) ?? s.view;
    const blocked = !visible || game.end.visible || anySheetOpen();
    const act = blocked || !s.view ? 'refuse' : beltPress(s.view);
    if (act === 'refuse') {
      nope(s);
      return;
    }
    if (act === 'cast') {
      if (aiming) setAim(null);
      if (game.useItem(id)) {
        haptics.pulse('tap');
        if (mode === 'pouch') setPop(false);
      } else nope(s);
      return;
    }
    setAim(id);
  };
  const commit = (p: { x: number; y: number }): void => {
    if (!aiming) return;
    const at = preview(p);
    if (!at || !at.ok) {
      nudgeHint(aiming === 'cloudguard' ? t('item.aimRoad') : t('item.noEffect'));
      return;
    }
    if (game.useItem(aiming, at.x, at.z)) {
      haptics.pulse('tap');
      setAim(null);
      if (mode === 'pouch') setPop(false);
    } else nudgeHint(t('item.noEffect'));
  };
  const stop = (e: Event): void => {
    e.stopPropagation();
    e.preventDefault();
  };
  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (popOpen && !aiming && e.target === canvas) setPop(false);
      if (!aiming || e.target !== canvas) return;
      if (e.button === 2) {
        setAim(null);
        stop(e);
        return;
      }
      const p = local(e);
      if (game.hud.hit(p.x, p.y)) {
        setAim(null);
        return;
      }
      down = { x: p.x, y: p.y, id: e.pointerId };
      lastPointer = p;
      preview(p);
      stop(e);
    },
    { capture: true },
  );
  stage.addEventListener(
    'pointermove',
    (e) => {
      if (e.target !== canvas) return;
      const p = local(e);
      if (e.pointerType === 'mouse' || down) lastPointer = p;
      if (!aiming) return;
      if (e.pointerType === 'mouse' || (down && down.id === e.pointerId)) preview(p);
      e.stopPropagation();
    },
    { capture: true },
  );
  stage.addEventListener(
    'pointerup',
    (e) => {
      if (!aiming || !down || down.id !== e.pointerId) return;
      const p = local(e);
      down = null;
      stop(e);
      commit(p);
    },
    { capture: true },
  );
  stage.addEventListener('pointercancel', () => (down = null), { capture: true });
  stage.addEventListener('contextmenu', (e) => {
    if (aiming) {
      setAim(null);
      e.preventDefault();
    }
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (synthetic || anySheetOpen() || game.replaying || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (aiming) {
          setAim(null);
          e.preventDefault();
        } else if (popOpen) {
          setPop(false);
          e.preventDefault();
        }
        return;
      }
      if (e.repeat || !visible) return;
      const i = beltKeyIndex(eventKey(e) ?? '', slots.length);
      if (i >= 0) {
        e.preventDefault();
        press(slots[i].id);
      }
    },
    { capture: true },
  );

  // --- per-frame state -----------------------------------------------------------------------------
  const runState = (): BeltRunState => {
    const w = game.world;
    return {
      disabled: w.mods.itemsDisabled || w.mods.abilitiesDisabled || w.waveSystem.isEndless,
      preFirstWave: w.waveSystem.state === 'preFirstWave',
      ended: w.outcome !== 'ongoing' || game.end.visible,
      paused: game.stepper.paused,
      replaying: game.replaying,
      lives: w.lives,
      livesUntilNextUse: w.itemSystem.livesUntilNextUse(w),
      heartstoneCeiling: heartstoneCeiling(w.startingLives, w.mods.marketDifficulty),
      enemies: w.enemyPool.getActiveCount(),
    };
  };
  const currentView = (): BeltSlotView[] => beltView(slots.map((s) => s.id), game.world.itemSystem.belt(), stock, runState());
  const sync = (s: Slot, v: BeltSlotView): void => {
    const key = `${v.state}|${v.uses}|${v.owned}|${v.state === 'reserve' ? need : 0}|${v.key}`;
    if (key === s.key) return;
    if (s.keyChip) s.keyChip.textContent = badgeLabel(v.key);
    // A locked charge opening is a moment: pop the medallion (and buzz on a phone).
    if (s.view?.state === 'reserve' && v.state !== 'reserve' && v.uses > 0) {
      s.btn.classList.remove('cast-pop');
      void s.btn.offsetWidth;
      s.btn.classList.add('cast-pop');
      haptics.pulse('upgrade');
    }
    s.key = key;
    s.view = v;
    s.btn.dataset.state = v.state;
    setLock(s.lock, v.state === 'reserve' ? need : 0);
    s.frame.src = v.state === 'ready' ? KIT.medallionHi : KIT.medallion;
    s.btn.classList.toggle('used-up', v.uses <= 0);
    const pips: HTMLElement[] = [];
    const cap = Math.max(v.uses, game.world.itemSystem.initial[s.id] ?? 0);
    for (let i = 0; i < cap; i++) pips.push(el('i', i < v.uses ? 'on' : ''));
    s.pips.replaceChildren(...pips);
    s.stock.textContent = String(v.owned);
    s.btn.setAttribute('aria-label', t('item.btnAria', { name: itemName(s.id), state: `${t('item.uses', { n: v.uses })}, ${stateText(v)}` }));
    if (tipFor === s.id) showTip(s.id);
  };

  let lastDt = 0;
  bind();
  layout();
  return {
    el: group,
    frame(dt: number): void {
      lastDt = dt;
      if (game.events !== bound) bind();
      if (game.dock.items.mode !== mode || group.style.getPropertyValue('--di') !== `${game.dock.items.d}px`) layout();
      need = game.world.itemSystem.livesUntilNextUse(game.world);
      const views = currentView();
      views.forEach((v, i) => sync(slots[i], v));
      pouch.querySelector('.pu-items-pouchn')!.textContent = String(views.reduce((n, v) => n + v.uses, 0));
      const locked = views.some((v) => v.state === 'reserve');
      pouch.dataset.state = views.some((v) => v.state === 'ready') ? 'ready' : locked ? 'reserve' : 'waiting';
      setLock(pouchLock, locked ? need : 0);
      if (aiming) {
        const v = views.find((q) => q.id === aiming);
        if (!v || v.state !== 'ready' || !visible) setAim(null);
      }
      fx.frame(dt);
    },
    setVisible(v: boolean): void {
      if (v === visible) return;
      visible = v;
      group.hidden = !v || slots.length === 0;
      if (!v) {
        setAim(null);
        setPop(false);
        showTip(null);
      }
    },
    get aiming() {
      return aiming;
    },
    press,
    castAt(x: number, y: number): boolean {
      const held = aiming;
      if (!held) return false;
      lastPointer = { x, y };
      commit({ x, y });
      return aiming === null;
    },
    debug(): Record<string, unknown> {
      const r = (e: Element): Rect => {
        const b = e.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      return {
        visible,
        mode,
        popOpen,
        aiming,
        group: r(group),
        slots: slots.map((s) => ({ id: s.id, ...r(s.btn), state: s.view?.state ?? null, uses: s.view?.uses ?? 0, owned: s.view?.owned ?? 0, lock: s.lock.hidden ? 0 : need })),
        hint: hint.hidden ? null : hint.textContent,
        tip: tip.hidden ? null : tip.textContent,
        fx: fx.debug(),
        dt: lastDt,
      };
    },
  };
}
