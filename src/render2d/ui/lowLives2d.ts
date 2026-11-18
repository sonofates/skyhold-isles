/**
 * Lives warning over the canvas: a short red flash round the screen edge each time a foe reaches
 * the keep, and a slow red pulse while lives are low (≤ 25 % of the start, or ≤ 3). DOM + CSS
 * (a radial gradient, composited by the browser, no Pixi cost). Reduced motion: no pulse, a steady
 * faint edge instead.
 */
import './lowLives2d.css';
import { el } from './dom.ts';

/** Lives are "low" at ≤ 25 % of the start (or ≤ 3), while any are left. */
export function livesLow(lives: number, start: number): boolean {
  return lives > 0 && (lives <= 3 || lives <= Math.floor(start * 0.25));
}

export interface LivesWarning {
  /** Call every frame with the current lives; `active` false hides everything (end panel, replay start…). */
  update(lives: number, start: number, active: boolean): void;
  readonly el: HTMLElement;
  debug(): { low: boolean; flashes: number };
}

export function mountLivesWarning(): LivesWarning {
  // Two layers: the steady low-lives pulse and the one-shot hit flash never fight over opacity.
  const v = el('div', 'pu-lives-vignette', { 'aria-hidden': 'true', 'data-testid': 'lives2d-vignette' });
  const flash = el('div', 'pu-lives-vignette pu-lives-flash', { 'aria-hidden': 'true' });
  document.body.append(v, flash);
  let last = NaN;
  let low = false;
  let flashes = 0;
  return {
    el: v,
    update(lives, start, active) {
      const nowLow = active && livesLow(lives, start);
      if (nowLow !== low) {
        low = nowLow;
        v.classList.toggle('low', low);
      }
      if (active && Number.isFinite(last) && lives < last) {
        flashes++;
        flash.classList.remove('hit');
        void flash.offsetWidth;
        flash.classList.add('hit');
      }
      if (!active) flash.classList.remove('hit');
      last = lives;
    },
    debug: () => ({ low, flashes }),
  };
}
