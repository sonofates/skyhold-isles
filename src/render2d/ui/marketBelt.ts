/**
 * The belt on the island briefing: one compact row (label, the three slots with the uses this run
 * would start with, a Change plank). A slot or Change opens a small picker board over the briefing:
 * the six items as switches (up to three on), each with its stock, and a way into the Market.
 * Items are off for challenge / Daily / Endless runs: the row greys out and says why.
 */
import type { DifficultyId } from '../../data/difficulty.ts';
import { ITEM_IDS, MARKET_RULES } from '../../data/market.ts';
import { itemDesc, itemName } from '../../i18n/data.ts';
import { t } from '../../i18n/index.ts';
import { el, openSheet, plank, type Sheet } from './dom.ts';
import { readMarket2D, setLoadout2D } from './market2d.ts';
import { toggleLoadout, usesFor } from './marketModel.ts';
import { itemSocket } from './marketScreen.ts';

export interface BeltChip {
  readonly el: HTMLElement;
  /** The briefing's choice changed (difficulty sets the cap; challenges / Endless turn items off). */
  update(difficulty: DifficultyId, itemsOff: boolean): void;
}

export interface BeltChipOptions {
  /** Opens the Market (from the picker); calls `closed` when it closes. */
  readonly onMarket?: (closed: () => void) => void;
}

export function beltChip(opts: BeltChipOptions = {}): BeltChip {
  const box = el('div', 'pu-beltchip', { 'data-testid': 'brief2d-belt' });
  let difficulty: DifficultyId = 'normal';
  let off = false;
  const paint = (): void => {
    const w = readMarket2D();
    const slots = el('div', 'pu-beltchip-slots', { role: 'list' });
    for (let i = 0; i < MARKET_RULES.slots; i++) {
      const id = w.loadout[i] ?? null;
      const uses = id ? usesFor(difficulty, w.inventory[id] ?? 0) : 0;
      const b = el('button', `pu-beltchip-slot${id ? '' : ' empty'}`, {
        type: 'button',
        role: 'listitem',
        'data-testid': `brief2d-belt-slot-${i}`,
        'aria-label': id ? `${itemName(id)}: ${t('market.remaining', { n: off ? 0 : uses })}` : t('market.slotEmpty'),
        title: id ? `${itemName(id)} · ${t('market.remaining', { n: off ? 0 : uses })}` : t('market.slotEmpty'),
      });
      b.append(itemSocket(id));
      if (id) b.append(el('span', `pu-beltchip-uses pu-letter${uses === 0 ? ' none' : ''}`, { 'aria-hidden': 'true' }, String(off ? 0 : uses)));
      b.addEventListener('click', () => openPicker());
      slots.append(b);
    }
    const change = plank(t('market.beltChange'), { kind: 'small', testid: 'brief2d-belt-change' });
    change.addEventListener('click', () => openPicker());
    const label = el(
      'div',
      'pu-beltchip-text',
      {},
      el('div', 'pu-beltchip-label pu-letter', {}, t('market.beltRow')),
      el('div', 'pu-beltchip-sub pu-ink-soft', {}, off ? t('market.disabled') : w.loadout.length === 0 ? t('market.beltNone') : t('market.beltUses', { n: MARKET_RULES.useCap[difficulty] })),
    );
    box.classList.toggle('off', off);
    box.title = off ? t('market.disabled') : '';
    box.replaceChildren(label, slots, change);
  };
  const openPicker = (): Sheet => {
    const sheet = openSheet(t('market.beltPick'), { cls: 'pu-meta pu-beltpick', testid: 'beltpick2d', onClose: paint });
    let note = '';
    const render = (): void => {
      const w = readMarket2D();
      const full = w.loadout.length >= MARKET_RULES.slots;
      const grid = el('div', 'pu-beltpick-grid', { role: 'group', 'aria-label': t('market.loadout') });
      for (const id of ITEM_IDS) {
        const on = w.loadout.includes(id);
        const owned = w.inventory[id] ?? 0;
        const b = el('button', `pu-beltpick-item pu-card${on ? ' on' : ''}`, {
          type: 'button',
          role: 'switch',
          'aria-checked': String(on),
          'data-testid': `beltpick2d-${id}`,
          'aria-label': on ? t('market.unequipAria', { name: itemName(id) }) : t('market.equipAria', { name: itemName(id) }),
          title: itemDesc(id),
        });
        b.disabled = !on && full;
        const socket = itemSocket(id);
        socket.append(el('span', 'pu-market-owned pu-letter', { 'aria-hidden': 'true' }, t('market.ownedShort', { n: owned })));
        b.append(socket, el('span', 'pu-beltpick-name pu-ink', {}, itemName(id)), ...(on ? [el('span', 'pu-beltpick-n pu-letter', {}, String(w.loadout.indexOf(id) + 1))] : []));
        b.addEventListener('click', () => {
          const next = toggleLoadout(w.loadout, id);
          note = next ? '' : t('market.beltFull');
          if (next) setLoadout2D(next);
          render();
        });
        grid.append(b);
      }
      const head = el('div', 'pu-meta-note pu-ink-soft', {}, t('market.loadoutHint', { n: MARKET_RULES.slots }), ' ', el('b', 'pu-ink', {}, t('market.capLine', { n: MARKET_RULES.useCap.normal, hard: MARKET_RULES.useCap.hard })));
      const foot = el('div', 'pu-beltpick-foot', {});
      if (note) foot.append(el('span', 'pu-market-beltnote bad', {}, note));
      if (opts.onMarket) {
        const go = plank(t('market.toMarket'), { kind: 'small', icon: 'crystal', testid: 'beltpick2d-market' });
        go.addEventListener('click', () => {
          sheet.close();
          opts.onMarket?.(paint);
        });
        foot.append(go);
      }
      const done = plank(t('common.close'), { kind: 'small', testid: 'beltpick2d-done' });
      done.addEventListener('click', () => sheet.close());
      foot.append(done);
      sheet.body.replaceChildren(head, grid, foot);
    };
    render();
    return sheet;
  };
  paint();
  return {
    el: box,
    update(d: DifficultyId, itemsOff: boolean): void {
      if (d === difficulty && itemsOff === off) return;
      difficulty = d;
      off = itemsOff;
      paint();
    },
  };
}
