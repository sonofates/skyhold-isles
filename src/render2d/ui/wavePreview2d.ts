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
import { ARMORED_MIN, foeMarks } from './foeMarks.ts';

export interface WaveChip {
  readonly type: EnemyType;
  readonly count: number;
  readonly elite: number;
  readonly boss: boolean;
  readonly flying: boolean;
  /** Heavy armour (foeMarks.ts ARMORED_MIN): a shield mark. */
  readonly armored: boolean;
}

/** Fade-out of the next-wave card as the wave marches (wavePreview2d.css `.pu-wave-out`). */
export const WAVE_CARD_FADE_MS = 320;

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
      armored: (def?.armor ?? 0) >= ARMORED_MIN,
    };
  });
  return chips.sort((a, b) => Number(b.boss) - Number(a.boss));
}

export interface WaveCardState {
  readonly visible: boolean;
  readonly preview: WavePreview | null;
  readonly title?: string;
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

/**
 * Inset the wave card slightly from the top of roomy desktop slots so its top and left screen
 * margins feel balanced, while staying strictly inside `slot` (hudCheck: 0 px outside).
 */
export function waveCardSlot(slot: Rect): Rect {
  const topInset = slot.h >= 104 ? 4 : 0;
  return topInset > 0 ? { x: slot.x, y: slot.y + topInset, w: slot.w, h: slot.h - topInset } : slot;
}

/** Responsive layout tier for the wave card inside its slot (pure, tested). */
export function waveCardTier(
  chipCount: number,
  slotW: number,
): { readonly many: boolean; readonly snug: boolean; readonly compact: boolean; readonly tiny: boolean } {
  const compact = slotW < 175;
  return {
    many: chipCount >= 4,
    snug: !compact && slotW < 235,
    compact,
    tiny: slotW < 90,
  };
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
  let outTimer: ReturnType<typeof setTimeout> | undefined;
  let chipCount = 0;
  const build = (p: WavePreview, title?: string): void => {
    head.textContent = [t('wave.next', { n: p.waveOneBased }), title].filter(Boolean).join(' · ');
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
      const faceBox = el('span', 'pu-wave-facebox', {}, face);
      if (c.elite > 0) faceBox.append(el('span', 'pu-wave-elite', { title: t('wave.elite', { n: c.elite }) }, img(KIT.star)));
      // Shapes, not only the backdrop colour: wing / shield / crown (colour-blind safe).
      const marks = foeMarks(c, 'pu-wave-marks');
      if (marks) faceBox.append(marks);
      b.append(faceBox, el('span', 'pu-wave-count pu-ink', {}, `×${c.count}`));
      if (isNew(c.type)) b.append(el('span', 'pu-wave-new pu-letter', {}, t('foe.new')));
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
        placeKey = '';
        clearTimeout(outTimer);
        if (on) {
          card.classList.remove('pu-wave-out');
          card.style.display = '';
        } else if (card.style.display !== 'none') {
          // The wave marches: the card fades out of its corner (Reduced motion: gone at once).
          card.classList.add('pu-wave-out');
          const done = (): void => {
            card.classList.remove('pu-wave-out');
            if (!shown) card.style.display = 'none';
          };
          if (document.documentElement.classList.contains('pu-reduce-motion')) done();
          else outTimer = setTimeout(done, WAVE_CARD_FADE_MS);
        }
      }
      if (!on || !s.preview) return;
      const k = `${s.title ?? ''}|${s.preview.waveOneBased}|${s.preview.items.map((i) => `${i.enemyType}${i.count}/${i.eliteCount ?? 0}${isNew(i.enemyType) ? '*' : ''}`).join(',')}`;
      if (k !== key) {
        key = k;
        build(s.preview, s.title);
      }
      const secs = Math.ceil(s.countdown);
      const fk = `${s.first ? 'f' : secs}|${s.earlyBonus}`;
      if (fk !== footKey) {
        footKey = fk;
        foot.replaceChildren();
        const line = s.first ? t('wave.startHint') : secs > 0 ? t('wave.inSecs', { n: secs }) : '';
        if (line) foot.append(el('span', 'pu-wave-hint', {}, line));
        if (s.earlyBonus > 0) foot.append(el('span', 'pu-wave-bonus', {}, img(KIT.gold), t('wave.earlyBonus', { n: s.earlyBonus })));
      }
      // Measure (a forced layout) only when the text or the slot changed, not every frame.
      const phone = document.documentElement.classList.contains('pu-phone');
      const q0 = waveCardSlot(s.slot);
      const q = phone ? { ...q0, w: Math.max(q0.w, Math.min(240, Math.round(window.innerWidth * 0.36))), h: Math.max(q0.h, 88) } : q0;
      const useMaxW = phone ? Math.max(s.maxW, q.w) : s.maxW;
      const pk = `${key}|${footKey}|${Math.round(q.x)},${Math.round(q.y)},${Math.round(q.w)},${Math.round(q.h)}|${Math.round(useMaxW)}`;
      if (pk !== placeKey) {
        placeKey = pk;
        const tier = waveCardTier(chipCount, q.w);
        card.classList.toggle('many', tier.many);
        card.classList.toggle('snug', tier.snug);
        card.classList.toggle('compact', tier.compact);
        card.classList.toggle('tiny', tier.tiny);
        const docked = dockCard(card, q, useMaxW, [foot, head], phone ? 0.99 : 0.8);
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
