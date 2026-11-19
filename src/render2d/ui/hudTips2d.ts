/**
 * Desktop hover tooltips for the canvas HUD (horn, pause, speed, the lives / gold plaque) in the
 * same parchment as the ability tooltips: what it does, its key, and the live state (early-call
 * bonus, speed).
 */
import { t } from '../../i18n/index.ts';
import { el } from './dom.ts';

export type HudTipFor = 'horn' | 'pause' | 'speed' | 'lives' | 'gold';

export interface HudTipState {
  readonly paused: boolean;
  readonly speed: number;
  readonly canCall: boolean;
  readonly earlyBonus: number;
  readonly first: boolean;
}

/** Tooltip text for a HUD button (pure). */
export function hudTipText(what: HudTipFor, s: HudTipState): { head: string; key: string; desc: string } {
  if (what === 'horn') {
    const desc = !s.canCall ? t('tip.hornWait') : s.first ? t('tip.hornFirst') : s.earlyBonus > 0 ? t('tip.hornBonus', { n: s.earlyBonus }) : t('tip.hornNow');
    return { head: t('tip.horn'), key: 'N', desc };
  }
  if (what === 'pause') return { head: s.paused ? t('tip.resume') : t('tip.pause'), key: t('key.space'), desc: t('tip.pauseDesc') };
  if (what === 'lives') return { head: t('tip.lives'), key: '', desc: t('tip.livesDesc') };
  if (what === 'gold') return { head: t('tip.gold'), key: '', desc: t('tip.goldDesc') };
  return { head: t('tip.speed', { n: s.speed }), key: '1 2 3', desc: t('tip.speedDesc') };
}

export interface HudTips2D {
  /** `what` null hides; `at` = the button's centre and radius (css px). */
  update(what: HudTipFor | null, s: HudTipState, at: { x: number; y: number; r: number } | null): void;
}

export function mountHudTips(): HudTips2D {
  const tip = el('div', 'pu pu-ab-tip', { role: 'tooltip', 'data-testid': 'hud2d-tip' });
  tip.hidden = true;
  document.body.append(tip);
  let key = '';
  return {
    update(what, s, at) {
      if (!what || !at) {
        tip.hidden = true;
        key = '';
        return;
      }
      const txt = hudTipText(what, s);
      const k = `${what}|${txt.head}|${txt.desc}`;
      if (k !== key) {
        key = k;
        tip.replaceChildren(
          el('div', 'pu-ab-tip-head pu-ink', {}, txt.head, txt.key ? el('span', 'pu-ab-tip-key pu-letter', {}, t('ab.key', { key: txt.key })) : null),
          el('div', 'pu-ab-tip-desc pu-ink-soft', {}, txt.desc),
        );
      }
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      // Below a top-row button, above / beside the horn; always on screen.
      let x = at.x - tw / 2;
      let y = at.y + at.r + 10;
      if (y + th > window.innerHeight - 6) y = at.y - at.r - 10 - th;
      x = Math.max(6, Math.min(window.innerWidth - tw - 6, x));
      tip.style.left = `${Math.round(x)}px`;
      tip.style.top = `${Math.round(Math.max(6, y))}px`;
    },
  };
}
