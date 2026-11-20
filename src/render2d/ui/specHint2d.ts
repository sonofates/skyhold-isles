/**
 * One-time tip the first time a tower reaches tier III: "Choose a specialization — tap it to pick
 * one of two". The coach's parchment card + bobbing gold arrow (coach2d.css) pointing at the tower.
 * Gone for good once the player specializes a tower or presses "Got it" (its own UI key); hidden
 * while a board, the ring, the end panel, a replay or the first-play coach is up.
 *
 * `specHintTower` is pure (unit-tested); the DOM part only shows it.
 */
import './coach2d.css';
import { t } from '../../i18n/index.ts';
import { addHudKeepOut } from '../uiKit.ts';
import { el } from './dom.ts';

export const SPEC_HINT_KEY = 'skyhold2d_spechint_v1';

interface HintTower {
  readonly id: number;
  readonly tier: number;
  readonly specialization?: unknown;
}

/** The tower the tip points at: the first tier-III tower not yet specialized (-1 = none). */
export function specHintTower(towers: readonly HintTower[]): number {
  for (const tw of towers) if (tw.tier === 3 && !tw.specialization) return tw.id;
  return -1;
}

/** Has any tower chosen its branch (the player found the feature)? */
export function anySpecialized(towers: readonly HintTower[]): boolean {
  return towers.some((tw) => !!tw.specialization);
}

export function specHintDone(): boolean {
  try {
    return localStorage.getItem(SPEC_HINT_KEY) === 'done';
  } catch {
    return false;
  }
}

function markDone(): void {
  try {
    localStorage.setItem(SPEC_HINT_KEY, 'done');
  } catch {
    // private mode: the tip may come back next run
  }
}

export interface SpecHint2D {
  /**
   * Every frame (live play). `target` = screen point above the tower (null hides the arrow),
   * `hidden` = something else owns the screen.
   */
  update(towers: readonly HintTower[], target: (id: number) => { x: number; y: number } | null, hidden: boolean): void;
  readonly done: boolean;
  debug(): { done: boolean; shown: boolean; tower: number; arrow: { x: number; y: number } | null };
}

export function mountSpecHint(touch: boolean, force = false): SpecHint2D {
  let done = !force && specHintDone();
  const card = el('div', 'pu pu-coach pu-spechint', { role: 'status', 'aria-live': 'polite', 'data-testid': 'spechint2d-card' });
  const title = el('div', 'pu-coach-title pu-ink', {}, t('spechint.title'));
  const ok = el('button', 'pu-coach-skip pu-ink-soft', { type: 'button', 'data-testid': 'spechint2d-ok' }, t('spechint.ok'));
  card.append(el('div', 'pu-coach-head', {}, title, ok), el('div', 'pu-coach-text pu-ink-soft', {}, t(touch ? 'spechint.text' : 'spechint.textMouse')));
  const arrow = el('div', 'pu pu-coach-arrow', { 'aria-hidden': 'true', 'data-testid': 'spechint2d-arrow' });
  card.style.display = 'none';
  arrow.style.display = 'none';
  document.body.append(card, arrow);
  let shown = false;
  let tower = -1;
  let arrowAt: { x: number; y: number } | null = null;
  const dropKeepOut = addHudKeepOut(() => {
    if (!shown) return null;
    const b = card.getBoundingClientRect();
    return { x: b.left - 6, y: b.top - 6, w: b.width + 12, h: b.height + 12 };
  });
  const finish = (): void => {
    if (done) return;
    done = true;
    shown = false;
    markDone();
    dropKeepOut();
    card.remove();
    arrow.remove();
  };
  ok.addEventListener('click', finish);
  return {
    get done() {
      return done;
    },
    update(towers, target, hidden) {
      if (done) return;
      if (anySpecialized(towers)) {
        finish();
        return;
      }
      tower = specHintTower(towers);
      const show = tower !== -1 && !hidden;
      if (show && !shown) {
        card.classList.remove('pop');
        void card.offsetWidth;
        card.classList.add('pop');
      }
      shown = show;
      card.style.display = show ? '' : 'none';
      arrowAt = show ? target(tower) : null;
      arrow.style.display = arrowAt ? '' : 'none';
      if (arrowAt) arrow.style.transform = `translate(${Math.round(arrowAt.x)}px, ${Math.round(arrowAt.y)}px)`; // i18n-ignore (css)
    },
    debug: () => ({ done, shown, tower, arrow: arrowAt }),
  };
}
