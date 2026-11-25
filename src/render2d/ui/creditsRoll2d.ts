/**
 * The end credits roll (ending2d.ts, after the ending's story beats; Settings → "The ending").
 * A painted board whose column of credits scrolls up on its own and stops with "Thank you for
 * playing!" in the middle. A tap / click anywhere, Esc, Enter or Space skips it (after a short
 * guard, so the tap that closed the story card does not skip it too). With reduced motion it does
 * not move: the column scrolls by hand and the same inputs close it.
 *
 * Names: the roles are listed with no names yet. Studio, brand and person names are the owner's
 * call (owner-gated), so every `who` below is null and reads "Names to come" until filled in.
 */
import { t, type MsgKey } from '../../i18n/index.ts';
import { creditSections } from './credits2d.ts';
import { el, openSheet, plank } from './dom.ts';
import './ending2d.css';

export interface RollRole {
  readonly role: MsgKey;
  /** The credited name(s); null = not decided yet (shown as "Names to come"). */
  readonly who: string | null;
}

/** The crew block of the roll, in order. */
export const ROLL_ROLES: readonly RollRole[] = [
  { role: 'ending.roleDesign', who: null }, // TODO(owner): name(s) for game design
  { role: 'ending.roleCode', who: null }, // TODO(owner): name(s) for programming
  { role: 'ending.roleArt', who: null }, // TODO(owner): name(s) for art direction
  { role: 'ending.roleAudio', who: null }, // TODO(owner): name(s) for music and sound
  { role: 'ending.roleWriting', who: null }, // TODO(owner): name(s) for story and writing
  { role: 'ending.roleL10n', who: null }, // TODO(owner): name(s) for localization
  { role: 'ending.roleQa', who: null }, // TODO(owner): name(s) for playtesting
  { role: 'ending.roleProduction', who: null }, // TODO(owner): studio / producer (brand is owner-gated)
];

export interface RollBlock {
  readonly kind: 'game' | 'head' | 'role' | 'line' | 'thanks';
  readonly text: string;
  /** `role`: the credited name(s); `line`: the product / font name in front. */
  readonly sub?: string;
}

/** Everything the roll shows, top to bottom (pure apart from the dictionary). */
export function rollBlocks(): RollBlock[] {
  const out: RollBlock[] = [
    { kind: 'game', text: t('map.title'), sub: t('ending.rollTagline') },
    { kind: 'head', text: t('ending.rollCrew') },
  ];
  for (const r of ROLL_ROLES) out.push({ kind: 'role', text: t(r.role), sub: r.who ?? t('ending.rollTbd') });
  for (const s of creditSections()) {
    out.push({ kind: 'head', text: s.title });
    for (const l of s.lines) out.push(l.name ? { kind: 'line', text: l.text, sub: l.name } : { kind: 'line', text: l.text });
  }
  out.push({ kind: 'thanks', text: t('credits.thanks') });
  return out;
}

/** Roll speed: one window height every this many seconds. */
const SECONDS_PER_SCREEN = 9;
/** How long "Thank you for playing!" holds before the roll closes on its own. */
const HOLD_MS = 3200;
/** Input right after opening does not skip (the tap that opened it). */
const ARM_MS = 450;

export interface CreditsRoll {
  close(): void;
  /** QA: jump to a share of the scroll (0 = start, 1 = the thanks centred). */
  seek(frac: number): void;
  pause(on: boolean): void;
  /** Share of the scroll done (0..1). */
  progress(): number;
}

declare global {
  interface Window {
    /** QA: the credits roll on screen. */
    __roll?: CreditsRoll;
  }
}

/**
 * Where the column sits (translateY, px) at scroll share `frac`: from just under the window to the
 * thanks line centred in it. Pure.
 */
export function rollOffset(frac: number, windowH: number, colH: number, thanksH: number): number {
  const start = windowH;
  const end = windowH / 2 + thanksH / 2 - colH;
  const f = Math.max(0, Math.min(1, frac));
  return start + (end - start) * f;
}

export function openCreditsRoll(onDone: () => void): CreditsRoll {
  const reduced = document.documentElement.classList.contains('pu-reduce-motion');
  let raf = 0;
  let holdTimer = 0;
  const sheet = openSheet(t('map.title'), {
    cls: `pu-meta pu-credits pu-roll${reduced ? ' still' : ''}`,
    testid: 'roll2d',
    modal: true,
    closeButton: false,
    onClose: () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(holdTimer);
      window.removeEventListener('keydown', onKey, true);
      if (window.__roll === handle) delete window.__roll;
      onDone();
    },
  });
  const win = el('div', 'pu-roll-window', { 'data-testid': 'roll2d-window' });
  const col = el('div', 'pu-credits-col pu-roll-col', { 'data-testid': 'roll2d-col' });
  let thanks: HTMLElement | null = null;
  let sec: HTMLElement | null = null;
  for (const b of rollBlocks()) {
    if (b.kind === 'game') {
      col.append(el('div', 'pu-roll-game', {}, el('div', 'pu-roll-title pu-letter', {}, b.text), el('div', 'pu-roll-tagline pu-ink-soft', {}, b.sub ?? '')));
    } else if (b.kind === 'head') {
      sec = el('section', 'pu-credits-sec');
      sec.append(el('h3', 'pu-credits-head pu-ink', {}, b.text));
      col.append(sec);
    } else if (b.kind === 'role') {
      (sec ?? col).append(el('p', 'pu-roll-role', {}, el('span', 'pu-ink-soft', {}, b.text), el('b', 'pu-ink', {}, b.sub ?? '')));
    } else if (b.kind === 'line') {
      (sec ?? col).append(el('p', 'pu-credits-line pu-ink-soft', {}, b.sub ? el('b', 'pu-ink', {}, b.sub) : null, b.sub ? ' — ' : null, b.text));
    } else {
      thanks = el('p', 'pu-credits-thanks pu-roll-thanks pu-letter', { 'data-testid': 'roll2d-thanks' }, b.text);
      col.append(thanks);
    }
  }
  win.append(col);
  const skip = plank(t('ending.rollSkip'), { kind: 'small', testid: 'roll2d-skip' });
  skip.dataset.navDefault = '';
  const foot = el('div', 'pu-roll-foot', {}, el('span', 'pu-roll-hint pu-ink-soft', {}, t('ending.rollHint')), skip);
  sheet.body.append(win, foot);

  const openedAt = performance.now();
  const armed = (): boolean => performance.now() - openedAt >= ARM_MS;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    sheet.close();
  };
  // Anywhere on the board or the backdrop skips (the Skip plank too, through the same click).
  sheet.overlay.addEventListener('click', () => {
    if (armed()) close();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    if (armed()) close();
  };
  window.addEventListener('keydown', onKey, true);

  let frac = 0;
  let paused = false;
  let last = 0;
  const place = (): void => {
    if (reduced) return;
    const y = rollOffset(frac, win.clientHeight, col.offsetHeight, thanks?.offsetHeight ?? 0);
    col.style.setProperty('--roll-y', `${y.toFixed(1)}px`);
  };
  const totalPx = (): number => Math.max(1, win.clientHeight / 2 + col.offsetHeight - (thanks?.offsetHeight ?? 0) / 2);
  const tick = (now: number): void => {
    if (closed) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!paused && frac < 1) {
      const speed = Math.max(1, win.clientHeight) / SECONDS_PER_SCREEN;
      frac = Math.min(1, frac + (speed * dt) / totalPx());
      place();
      if (frac >= 1) holdTimer = window.setTimeout(close, HOLD_MS);
    }
    raf = requestAnimationFrame(tick);
  };
  if (!reduced) {
    place();
    raf = requestAnimationFrame(tick);
  }
  const handle: CreditsRoll = {
    close,
    seek: (f) => {
      frac = Math.max(0, Math.min(0.999, f));
      place();
    },
    pause: (on) => {
      paused = on;
      last = 0;
    },
    progress: () => frac,
  };
  window.__roll = handle;
  return handle;
}
