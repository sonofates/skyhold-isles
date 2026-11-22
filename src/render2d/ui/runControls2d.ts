/**
 * Run flow controls over the canvas (DOM, painted kit):
 * - the pause menu under the "Paused" plate: Resume · Restart · Settings · World Map
 *   (Restart and World Map ask first, the run stays paused meanwhile);
 * - a small confirm board (`confirmBoard`);
 * - the replay player: a ribbon at the top with the replay badge, the wave, a progress line,
 *   play / pause, 1× / 2× / 4× and Leave (no scrubbing: the sim only runs forward).
 */
import './runControls2d.css';
import { t } from '../../i18n/index.ts';
import type { Rect } from '../uiLayout.ts';
import { el, glyph, openSheet, plank, roundButton } from './dom.ts';

export interface ConfirmOptions {
  readonly title: string;
  readonly body: string;
  readonly yes: string;
  readonly no: string;
  readonly testid: string;
}

/** A small parchment board with a question and two planks. Resolves true on yes. */
export function confirmBoard(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const sheet = openSheet(o.title, { cls: 'pu-confirm', testid: o.testid, onClose: () => resolve(answer) });
    const yes = plank(o.yes, { kind: 'small', testid: `${o.testid}-yes` });
    yes.classList.add('pu-confirm-yes');
    const no = plank(o.no, { kind: 'small', testid: `${o.testid}-no` });
    yes.addEventListener('click', () => {
      answer = true;
      sheet.close();
    });
    no.addEventListener('click', () => sheet.close());
    sheet.body.append(el('p', 'pu-confirm-text', {}, o.body), el('div', 'pu-confirm-row', {}, no, yes));
    // Keyboard: the safe choice has focus, Enter on it keeps playing.
    requestAnimationFrame(() => no.focus({ preventScroll: true }));
  });
}

export interface PauseMenuHandlers {
  resume(): void;
  restart(): void;
  settings(): void;
  map(): void;
}

export interface PauseMenu2D {
  /** The "Paused" plate's rect while the player has paused (null hides the menu). */
  setPlate(rect: Rect | null): void;
  setHidden(hidden: boolean): void;
  readonly el: HTMLElement;
}

/** The plank row under the Paused plate. */
export function mountPauseMenu(h: PauseMenuHandlers): PauseMenu2D {
  const wrap = el('div', 'pu pu-pause-menu', { 'data-testid': 'pause2d-menu' });
  const resume = plank(t('pause.resume'), { kind: 'small', icon: 'play', testid: 'pause2d-resume' });
  const restart = plank(t('pause.restart'), { kind: 'small', icon: 'restart', testid: 'pause2d-restart' });
  const settings = plank(t('hud.settings'), { kind: 'small', icon: 'settings', testid: 'pause2d-settings' });
  const map = plank(t('pause.map'), { kind: 'small', icon: 'map', testid: 'pause2d-map' });
  resume.classList.add('pu-pause-resume');
  wrap.append(resume, restart, settings, map);
  wrap.style.display = 'none';
  document.body.append(wrap);
  resume.addEventListener('click', () => h.resume());
  restart.addEventListener('click', () => h.restart());
  settings.addEventListener('click', () => h.settings());
  map.addEventListener('click', () => h.map());
  let plate: Rect | null = null;
  let hidden = false;
  const sync = (): void => {
    const show = !!plate && !hidden;
    wrap.style.display = show ? '' : 'none';
    if (show && plate) {
      wrap.style.left = `${plate.x + plate.w / 2}px`;
      let top = plate.y + plate.h + 10;
      if (document.documentElement.classList.contains('pu-phone')) {
        let trayTop = window.innerHeight - 84;
        document.querySelectorAll<HTMLElement>('.pu-hero-port, .pu-ab').forEach((el) => { // i18n-ignore (CSS selector)
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.top < trayTop) trayTop = r.top;
        });
        const menuH = wrap.getBoundingClientRect().height || wrap.offsetHeight || 52;
        const maxTop = Math.max(8, trayTop - menuH - 12);
        if (top > maxTop) top = maxTop;
      }
      wrap.style.top = `${top}px`;
    }
  };
  return {
    el: wrap,
    setPlate(rect) {
      if (rect === plate || (rect && plate && rect.x === plate.x && rect.y === plate.y && rect.w === plate.w && rect.h === plate.h)) return;
      plate = rect;
      sync();
    },
    setHidden(v) {
      if (v === hidden) return;
      hidden = v;
      sync();
    },
  };
}

export interface ReplayBarState {
  readonly paused: boolean;
  readonly speed: number;
  /** 0..1 through the recorded run. */
  readonly progress: number;
  readonly wave: string;
}

export interface ReplayBarHandlers {
  togglePause(): void;
  setSpeed(s: number): void;
  exit(): void;
}

export interface ReplayBar2D {
  setVisible(v: boolean): void;
  update(s: ReplayBarState): void;
  readonly el: HTMLElement;
}

export function mountReplayBar(h: ReplayBarHandlers, speeds: readonly number[], desktop: boolean): ReplayBar2D {
  const bar = el('div', 'pu pu-replay-bar', { role: 'toolbar', 'aria-label': t('replay.title'), 'data-testid': 'replay2d-bar' });
  const badge = el('div', 'pu-replay-badge pu-letter', {}, glyph('replay'), el('span', '', {}, t('replay.title')));
  const wave = el('span', 'pu-replay-wave pu-letter');
  const play = roundButton('pause', t('replay.pause'), 'replay2d-play');
  play.classList.add('pu-replay-play');
  const chips = el('div', 'pu-replay-speeds');
  const chipEls = speeds.map((s) => {
    const c = el('button', 'pu-replay-speed pu-letter', { type: 'button', 'aria-label': t('replay.speed', { n: s }), 'data-testid': `replay2d-speed-${s}`, 'aria-pressed': 'false' }, `${s}×`);
    c.addEventListener('click', () => h.setSpeed(s));
    chips.append(c);
    return c;
  });
  const exit = roundButton('close', t('replay.exit'), 'replay2d-exit');
  exit.classList.add('pu-replay-exit');
  const track = el('div', 'pu-replay-track');
  const fill = el('i', 'pu-replay-fill');
  track.append(fill);
  const row = el('div', 'pu-replay-row', {}, badge, wave, play, chips, exit);
  bar.append(row, track);
  if (desktop) bar.append(el('div', 'pu-replay-keys', {}, t('replay.keys')));
  bar.style.display = 'none';
  document.body.append(bar);
  play.addEventListener('click', () => h.togglePause());
  exit.addEventListener('click', () => h.exit());
  let last = '';
  return {
    el: bar,
    setVisible(v) {
      bar.style.display = v ? '' : 'none';
      last = '';
    },
    update(s) {
      const key = `${s.paused}|${s.speed}|${Math.round(s.progress * 400)}|${s.wave}`;
      if (key === last) return;
      last = key;
      play.replaceChildren(glyph(s.paused ? 'play' : 'pause'));
      const label = s.paused ? t('replay.play') : t('replay.pause');
      play.setAttribute('aria-label', label);
      play.title = label;
      chipEls.forEach((c, i) => c.setAttribute('aria-pressed', String(speeds[i] === s.speed)));
      fill.style.width = `${(s.progress * 100).toFixed(2)}%`;
      wave.textContent = s.wave;
    },
  };
}
