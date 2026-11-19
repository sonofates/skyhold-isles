/**
 * Next-wave card in the HUD dock's info slot (top-left, hudDock.ts; genre basic the 2D game was missing): the foes of the coming
 * wave as painted portraits with counts (empowered elites starred, bosses in a red ring), the
 * countdown / "blow the horn" line and the early-call bonus. Shown while the player is choosing
 * when to call the wave (before the first wave, between waves, or paused), never during a fight,
 * so it does not cover enemies walking out of the caves. Data-driven from the sim's
 * `getNextWavePreview()`, so new foes and islands need no change here.
 */
import './wavePreview2d.css';
import type { EnemyType } from '../../core/types.ts';
import { ENEMY_DEFS } from '../../data/enemies.ts';
import { enemyName } from '../../i18n/data.ts';
import { t } from '../../i18n/index.ts';
import type { WavePreview } from '../../sim/waveSystem.ts';
import type { Rect } from '../uiLayout.ts';
import { dockCard } from './dockCard.ts';
import { el, img, KIT } from './dom.ts';

export interface WaveChip {
  readonly type: EnemyType;
  readonly count: number;
  readonly elite: number;
  readonly boss: boolean;
  readonly flying: boolean;
}

/** The card's chips from the sim's preview (sim order = spawn order; bosses first so they show). */
export function waveChips(p: WavePreview | null): WaveChip[] {
  if (!p) return [];
  const chips = p.items.map((it) => {
    const def = ENEMY_DEFS[it.enemyType];
    return {
      type: it.enemyType,
      count: it.count,
      elite: it.eliteCount ?? 0,
      boss: !!def && (def.type === 'boss' || def.type === 'tempest'),
      flying: !!def?.flying,
    };
  });
  return chips.sort((a, b) => Number(b.boss) - Number(a.boss));
}

export interface WaveCardState {
  readonly visible: boolean;
  readonly preview: WavePreview | null;
  /** Seconds until the wave starts on its own (0 = waits for the horn). */
  readonly countdown: number;
  readonly earlyBonus: number;
  readonly first: boolean;
  /** The dock's info slot (css px); the card never leaves it. */
  readonly slot: Rect;
  /** Widest the card gets (css px; it wraps / scales inside the slot). */
  readonly maxW: number;
}

export interface WaveCard2D {
  update(s: WaveCardState): void;
  readonly el: HTMLElement;
  debug(): { shown: boolean; chips: number; scale: number; rect: { x: number; y: number; w: number; h: number } | null };
  /** Where the card stands while shown (no layout read; the lane marks keep off it). */
  box(): Rect | null;
}

export function mountWaveCard(
  enemyUrl: (type: EnemyType) => string | null,
  isNew: (type: EnemyType) => boolean = () => false,
  onChip?: (type: EnemyType) => void,
): WaveCard2D {
  const card = el('div', 'pu pu-wave-card', { 'data-testid': 'wave2d-card', 'aria-live': 'polite' });
  const head = el('div', 'pu-wave-head pu-ink');
  const chips = el('div', 'pu-wave-chips');
  const foot = el('div', 'pu-wave-foot pu-ink-soft');
  card.append(head, chips, foot);
  card.style.display = 'none';
  document.body.append(card);
  let key = '';
  let footKey = '';
  let placeKey = '';
  let scale = 1;
  let placed: Rect | null = null;
  let shown = false;
  let chipCount = 0;
  const build = (p: WavePreview): void => {
    head.textContent = t('wave.next', { n: p.waveOneBased });
    chips.replaceChildren();
    const list = waveChips(p);
    chipCount = list.length;
    for (const c of list) {
      const name = enemyName(c.type);
      const label = t('wave.chip', { n: c.count, name });
      const b = el('button', `pu-wave-chip${c.boss ? ' boss' : ''}${c.flying ? ' flying' : ''}`, { type: 'button', 'aria-label': label, title: label, 'data-enemy': c.type });
      const url = enemyUrl(c.type);
      const face = el('span', 'pu-wave-face');
      if (url) face.append(img(url));
      else face.textContent = name.slice(0, 1);
      b.append(face, el('span', 'pu-wave-count pu-letter', {}, `×${c.count}`));
      if (c.elite > 0) b.append(el('span', 'pu-wave-elite', { title: t('wave.elite', { n: c.elite }) }, img(KIT.star)));
      if (isNew(c.type)) b.append(el('span', 'pu-wave-new', {}, t('foe.new')));
      if (onChip) b.addEventListener('click', () => onChip(c.type));
      chips.append(b);
    }
  };
  return {
    el: card,
    update(s) {
      const on = s.visible && !!s.preview && s.preview.items.length > 0;
      if (on !== shown) {
        shown = on;
        card.style.display = on ? '' : 'none';
        placeKey = '';
      }
      if (!on || !s.preview) return;
      const k = `${s.preview.waveOneBased}|${s.preview.items.map((i) => `${i.enemyType}${i.count}/${i.eliteCount ?? 0}${isNew(i.enemyType) ? '*' : ''}`).join(',')}`;
      if (k !== key) {
        key = k;
        build(s.preview);
      }
      const secs = Math.ceil(s.countdown);
      const fk = `${s.first ? 'f' : secs}|${s.earlyBonus}`;
      if (fk !== footKey) {
        footKey = fk;
        foot.replaceChildren();
        const line = s.first ? t('wave.startHint') : secs > 0 ? t('wave.inSecs', { n: secs }) : '';
        if (line) foot.append(el('span', '', {}, line));
        if (s.earlyBonus > 0) foot.append(el('span', 'pu-wave-bonus', {}, img(KIT.gold), t('wave.earlyBonus', { n: s.earlyBonus })));
      }
      // Measure (a forced layout) only when the text or the slot changed, not every frame.
      const q = s.slot;
      const pk = `${key}|${footKey}|${Math.round(q.x)},${Math.round(q.y)},${Math.round(q.w)},${Math.round(q.h)}|${Math.round(s.maxW)}`;
      if (pk !== placeKey) {
        placeKey = pk;
        const docked = dockCard(card, q, s.maxW, [foot, head]);
        placed = docked.box;
        scale = docked.scale;
      }
    },
    box: () => (shown ? placed : null),
    debug() {
      if (!shown) return { shown, chips: chipCount, scale, rect: null };
      const r = card.getBoundingClientRect();
      return { shown, chips: chipCount, scale, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    },
  };
}
