/**
 * Tier-IV specialization comparison card: both branches of a tier-III tower side by side on the
 * painted board — portrait, name, one-line role, price, what changes against tier III, the ability
 * each one unlocks — with a "Choose" plank per branch (permanent until the tower is sold).
 *
 * DOM on the painted kit (dom.ts), so the keyboard / gamepad nav (navFocus.ts) walks it like every
 * other board; Escape / B / the close seal cancel. Opened by main2d from the build ring.
 */
import './specCard2d.css';
import type { TowerType } from '../../core/types.ts';
import { specializationsFor, type TowerSpecializationDef } from '../../data/towers.ts';
import { abilityDesc, abilityName, specDesc, specName, specRole, towerName } from '../../i18n/data.ts';
import { t } from '../../i18n/index.ts';
import { el, img, KIT, openSheet, plank, type Sheet } from './dom.ts';
import { abilityChanges, branchChanges, type StatChange } from './specInfo.ts';

export interface SpecCardOptions {
  readonly type: TowerType;
  /** Gold now (the run is paused while the card is open). */
  readonly gold: number;
  /** Branch the player tapped in the ring: its plank takes the focus. */
  readonly focus?: string;
  /** Portrait URL of a branch (null = the medallion stays blank). */
  readonly portraitUrl: (id: string) => string | null;
  /** "Choose" pressed (the card closes itself first). */
  readonly onChoose: (id: string) => void;
  readonly onClose?: () => void;
}

/** A price with the painted coin. */
export function price(n: number, cls = ''): HTMLElement {
  return el('span', `pu-cx-cost pu-ink${cls ? ` ${cls}` : ''}`, {}, img(KIT.gold), String(n));
}

/** "Damage 60 → 75" rows; a gain in green, a loss in red. */
export function changeList(rows: readonly StatChange[]): HTMLElement {
  const list = el('ul', 'pu-spec-changes');
  for (const r of rows) {
    list.append(
      el(
        'li',
        `pu-spec-change ${r.up ? 'up' : 'down'}`,
        { 'data-stat': r.key },
        el('span', 'pu-ink-soft pu-spec-label', {}, r.label),
        el('span', 'pu-spec-vals', {}, el('span', 'pu-ink-soft', {}, r.from), el('span', 'pu-spec-arrow', { 'aria-hidden': 'true' }, '→'), el('strong', 'pu-spec-to', {}, r.to)),
      ),
    );
  }
  return list;
}

/** The ability block (name, price, what it does). */
export function abilityBlock(type: TowerType, b: TowerSpecializationDef): HTMLElement {
  const box = el('div', 'pu-spec-abilities');
  for (const a of b.abilities) {
    const ch = abilityChanges(type, b, a.id);
    box.append(
      el(
        'div',
        'pu-spec-ability',
        { 'data-ability': a.id },
        el('div', 'pu-spec-ability-head', {}, el('span', 'pu-ink pu-spec-ability-name', {}, abilityName(a.id)), price(a.cost)),
        el('div', 'pu-ink-soft pu-spec-ability-desc', {}, abilityDesc(a.id)),
        ch.length ? changeList(ch) : null,
      ),
    );
  }
  return box;
}

export function openSpecCard(o: SpecCardOptions): Sheet {
  const branches = specializationsFor(o.type);
  let chosen = false;
  const sheet = openSheet(t('spec.title'), {
    cls: 'pu-meta pu-spec',
    testid: 'spec-card',
    onClose: () => o.onClose?.(),
  });
  const cols = el('div', 'pu-spec-cols');
  const planks: { id: string; btn: HTMLButtonElement }[] = [];
  for (const b of branches) {
    const poor = o.gold < b.cost;
    const url = o.portraitUrl(b.id);
    const face = el('span', 'pu-cx-medal big pu-spec-medal');
    if (url) face.append(img(url, '', 'pu-cx-art pu-spec-art'));
    const choose = plank(t('spec.choose'), { kind: 'primary', testid: `spec-choose-${b.id}` });
    choose.disabled = poor;
    choose.addEventListener('click', () => {
      if (chosen || choose.disabled) return;
      chosen = true;
      sheet.close();
      o.onChoose(b.id);
    });
    planks.push({ id: b.id, btn: choose });
    const col = el(
      'section',
      `pu-card pu-spec-col${b.id === o.focus ? ' focus' : ''}${poor ? ' poor' : ''}`,
      { 'data-testid': `spec-col-${b.id}`, 'aria-label': specName(b.id) },
      el(
        'div',
        'pu-spec-head',
        {},
        face,
        el('div', 'pu-spec-titles', {}, el('div', 'pu-cx-title pu-ink pu-spec-name', {}, specName(b.id)), el('div', 'pu-ink-soft pu-spec-role', {}, specRole(b.id))),
      ),
      el('div', 'pu-spec-buy', {}, price(b.cost, poor ? 'poor' : ''), poor ? el('span', 'pu-spec-need', {}, t('ring.needGold', { n: b.cost })) : null, choose),
      el('p', 'pu-cx-desc pu-ink pu-spec-desc', {}, specDesc(b.id)),
      el('div', 'pu-cx-sub pu-letter pu-spec-sub', {}, t('spec.changes')),
      changeList(branchChanges(o.type, b)),
      el('div', 'pu-cx-sub pu-letter pu-spec-sub', {}, t('spec.unlocks')),
      abilityBlock(o.type, b),
    );
    cols.append(col);
  }
  sheet.body.append(
    el('div', 'pu-cx-kicker pu-ink-soft pu-spec-kicker', {}, t('spec.kicker', { name: towerName(o.type) })),
    cols,
    el('p', 'pu-ink-soft pu-spec-note', {}, t('spec.permanent')),
  );
  // Focus: the tapped branch's plank, else the other affordable one (nav users land on a choice).
  const usable = planks.filter((p) => !p.btn.disabled);
  const first = usable.find((p) => p.id === o.focus) ?? usable[0];
  if (first) requestAnimationFrame(() => first.btn.focus({ preventScroll: true }));
  return sheet;
}
