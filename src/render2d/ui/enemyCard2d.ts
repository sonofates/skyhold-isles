/**
 * Foe info card: tap a foe on the map and a parchment card opens in the HUD dock's info slot
 * (top-left, hudDock.ts; never over the island) — painted portrait, name,
 * Flyer / Empowered / Boss tags, a live health bar (with its ward shield), armour, speed, lives it
 * costs, bounty, what it does and how to stop it. All from the enemy data + codex texts, so new
 * foes need nothing here. When it falls the card says so and fades. Tap elsewhere / Esc closes it.
 */
import './enemyCard2d.css';
import { ENEMY_DEFS } from '../../data/enemies.ts';
import { enemyCounter, enemyDesc, enemyName } from '../../i18n/data.ts';
import { num, t } from '../../i18n/index.ts';
import type { EnemyEntity } from '../../sim/entities.ts';
import { speedClass } from '../../ui/content/codexData.ts';
import type { Rect } from '../uiLayout.ts';
import { dockCard } from './dockCard.ts';
import { el, img } from './dom.ts';
import { ARMORED_MIN, foeMarks } from './foeMarks.ts';

export interface FoeFacts {
  readonly name: string;
  readonly tags: readonly string[];
  readonly armor: number;
  readonly speed: string;
  readonly lives: number;
  readonly bounty: number;
  readonly desc: string;
  readonly counter: string;
}

/** The card's text for a foe (live armour / speed from the entity, the rest from its data). */
export function foeFacts(e: Pick<EnemyEntity, 'type' | 'flying' | 'elite' | 'armor' | 'speed'>): FoeFacts {
  const def = ENEMY_DEFS[e.type];
  const tags: string[] = [];
  if (def && (def.type === 'boss' || def.type === 'tempest')) tags.push(t('codex.kicker.boss'));
  if (e.flying) tags.push(t('codex.kicker.flyer'));
  if (e.elite) tags.push(t('foe.empowered'));
  return {
    name: enemyName(e.type),
    tags,
    armor: Math.round(e.armor),
    speed: t(`codex.speed.${speedClass(def?.speed ?? e.speed)}`),
    lives: def?.livesCost ?? 1,
    bounty: def?.reward ?? 0,
    desc: enemyDesc(e.type),
    counter: enemyCounter(e.type),
  };
}

export interface EnemyCard2D {
  /**
   * Every frame: the inspected foe (null = none / fell), the dock's info slot, the widest the card
   * may get and whether the slot is a wide band (two columns) or a narrow side column.
   */
  update(e: EnemyEntity | null, inspecting: boolean, slot: Rect, maxW: number, wide: boolean): void;
  readonly el: HTMLElement;
  debug(): { shown: boolean; type: string | null; hpFrac: number; fell: boolean; scale: number; rect: Rect | null };
}

export function mountEnemyCard(portrait: (type: string) => string | null): EnemyCard2D {
  const card = el('div', 'pu pu-foe-card', { 'data-testid': 'foe2d-card', role: 'status' });
  const face = el('span', 'pu-foe-face');
  const name = el('div', 'pu-foe-name pu-ink');
  const tags = el('div', 'pu-foe-tags');
  const barFill = el('i', 'pu-foe-hp-fill');
  const barShield = el('i', 'pu-foe-hp-shield');
  const bar = el('div', 'pu-foe-hp', {}, barFill, barShield);
  const hpText = el('span', 'pu-foe-hp-text pu-ink');
  const stats = el('div', 'pu-foe-stats pu-ink');
  const desc = el('div', 'pu-foe-desc pu-ink-soft');
  const counter = el('div', 'pu-foe-counter pu-ink');
  const faceBox = el('span', 'pu-foe-facebox', {}, face);
  const head = el('div', 'pu-foe-head', {}, faceBox, el('div', 'pu-foe-title', {}, el('div', 'pu-foe-row', {}, name, tags), el('div', 'pu-foe-row', {}, bar, hpText)));
  card.append(head, stats, desc, counter);
  card.classList.add('docked');
  card.style.display = 'none';
  document.body.append(card);
  let placeKey = '';
  let scale = 1;
  let box: Rect | null = null;

  let uid = -1;
  let shown = false;
  let fell = false;
  let fellT = 0;
  let hpKey = '';
  let hpFrac = 0;
  let type: string | null = null;
  const show = (v: boolean): void => {
    if (v === shown) return;
    shown = v;
    card.style.display = v ? '' : 'none';
  };
  const fill = (e: EnemyEntity): void => {
    const f = foeFacts(e);
    type = e.type;
    const url = portrait(e.type);
    face.replaceChildren(url ? img(url) : el('b', '', {}, f.name.slice(0, 1)));
    face.classList.toggle('boss', f.tags.includes(t('codex.kicker.boss')));
    face.classList.toggle('flying', e.flying);
    faceBox.querySelector('.pu-foe-marks')?.remove();
    const marks = foeMarks({ flying: e.flying, armored: f.armor >= ARMORED_MIN, boss: f.tags.includes(t('codex.kicker.boss')) }, 'pu-foe-face-marks');
    if (marks) faceBox.append(marks);
    name.textContent = f.name;
    tags.replaceChildren(...f.tags.map((tg) => el('span', `pu-foe-tag${tg === t('foe.empowered') ? ' elite' : ''}`, {}, tg)));
    stats.replaceChildren(
      el('span', '', {}, el('b', '', {}, `${t('codex.stat.armor')} `), num(f.armor)),
      el('span', '', {}, el('b', '', {}, `${t('codex.stat.speed')} `), f.speed),
      el('span', '', {}, el('b', '', {}, `${t('codex.stat.lives')} `), num(f.lives)),
      el('span', '', {}, el('b', '', {}, `${t('codex.stat.bounty')} `), t('codex.gold', { n: f.bounty })),
    );
    desc.textContent = f.desc;
    desc.hidden = !f.desc;
    counter.replaceChildren(...(f.counter ? [el('b', '', {}, `${t('codex.howToStop')}: `), f.counter] : []));
    counter.hidden = !f.counter;
    card.classList.remove('fell');
  };

  return {
    el: card,
    update(e, inspecting, slot, maxW, wide) {
      if (!inspecting) {
        uid = -1;
        fell = false;
        show(false);
        return;
      }
      if (e && e.uid !== uid) {
        uid = e.uid;
        fell = false;
        hpKey = '';
        fill(e);
        placeKey = '';
      }
      if (!e) {
        // It fell (or burrowed out of reach): say so, fade, close.
        if (uid !== -1 && !fell) {
          fell = true;
          fellT = performance.now();
          card.classList.add('fell');
          hpText.textContent = t('foe.fell');
          barFill.style.width = '0%';
          barShield.style.width = '0%';
        }
        if (!fell || performance.now() - fellT > 1200) show(false);
        return;
      }
      show(true);
      const max = Math.max(1, e.maxHp);
      hpFrac = Math.max(0, Math.min(1, e.hp / max));
      const k = `${Math.ceil(e.hp)}|${Math.ceil(e.shield)}`;
      if (k !== hpKey) {
        hpKey = k;
        barFill.style.width = `${(hpFrac * 100).toFixed(1)}%`;
        barFill.classList.toggle('low', hpFrac < 0.3);
        barShield.style.width = `${Math.min(100, (e.shield / max) * 100).toFixed(1)}%`;
        hpText.textContent = `${num(Math.ceil(e.hp))}/${num(Math.round(e.maxHp))}`;
      }
      // Docked in the info slot; measured again only when the foe or the slot changes (the HP bar
      // and its numbers keep their size).
      const phone = document.documentElement.classList.contains('pu-phone');
      const useSlot = phone
        ? { ...slot, w: Math.max(slot.w, Math.min(310, Math.round(window.innerWidth * 0.46))), h: Math.max(slot.h, 190) }
        : slot;
      const useMaxW = phone ? Math.max(maxW, useSlot.w) : maxW;
      const pk = `${uid}|${Math.round(useSlot.x)},${Math.round(useSlot.y)},${Math.round(useSlot.w)},${Math.round(useSlot.h)}|${Math.round(useMaxW)}|${wide ? 1 : 0}`;
      if (pk !== placeKey) {
        placeKey = pk;
        card.classList.toggle('wide', wide);
        // Small slots: the description, then the stat line go before the card would shrink below a
        // readable size (the Codex has both).
        const docked = dockCard(card, useSlot, useMaxW, [desc, stats], phone ? 0.99 : 0.88);
        scale = docked.scale;
        box = docked.box;
      }
    },
    debug: () => ({ shown, type, hpFrac, fell, scale, rect: shown ? box : null }),
  };
}
