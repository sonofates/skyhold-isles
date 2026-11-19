/**
 * First-play coach marks on the first island (l1c): five short tips that follow what the player
 * actually does, never block play, and can be skipped. Build a tower → blow the horn → upgrade →
 * send the hero → drop a meteor. A bobbing gold arrow points at the thing to tap; a small parchment
 * card says what to do ("2/5", text, Skip). Done / skipped is remembered in its own UI key.
 *
 * `coachStep` is pure (unit-tested); the DOM part only shows it.
 */
import './coach2d.css';
import { t, type MsgKey } from '../../i18n/index.ts';
import { addHudKeepOut, hudKeepOuts } from '../uiKit.ts';
import type { Rect } from '../uiLayout.ts';
import { el } from './dom.ts';

export type CoachStep = 'build' | 'pick' | 'wave' | 'upgrade' | 'hero' | 'meteor' | 'done';

export interface CoachObs {
  readonly towers: number;
  readonly maxTier: number;
  /** Waves called so far (0 before the first). */
  readonly waves: number;
  /** The build ring is open on a free plot (pick a tower). */
  readonly buildRingOpen: boolean;
  readonly gold: number;
  /** Cheapest upgrade of a built tower (Infinity when none). */
  readonly cheapestUpgrade: number;
  readonly hasHero: boolean;
  /** Hero move orders given so far. */
  readonly heroMoves: number;
  readonly meteorReady: boolean;
  /** Meteor casts so far. */
  readonly meteors: number;
}

/** How many tips there are (for "2/5"). */
export const COACH_TOTAL = 5;

/** Steps the player is past give up after this many waves (they have the hang of it). */
const PATIENCE_WAVES = 4;

/**
 * The tip to show now. `prev` keeps the tour moving forward only (a sold first tower before the
 * first wave goes back to "build").
 */
export function coachStep(prev: CoachStep, o: CoachObs): CoachStep {
  let s = prev;
  for (let guard = 0; guard < 8; guard++) {
    const before = s;
    if (s === 'build' || s === 'pick') {
      s = o.towers >= 1 ? 'wave' : o.buildRingOpen ? 'pick' : 'build';
    } else if (s === 'wave') {
      if (o.towers === 0 && o.waves === 0) s = 'build';
      else if (o.waves >= 1) s = 'upgrade';
    } else if (s === 'upgrade') {
      if (o.maxTier >= 2 || o.waves >= PATIENCE_WAVES) s = o.hasHero ? 'hero' : 'meteor';
    } else if (s === 'hero') {
      if (!o.hasHero || o.heroMoves >= 1 || o.waves >= PATIENCE_WAVES + 2) s = 'meteor';
    } else if (s === 'meteor') {
      if (o.meteors >= 1 || o.waves >= PATIENCE_WAVES + 4) s = 'done';
    }
    if (s === before) break;
  }
  return s;
}

/** The tip's number (1-based) and text keys; the upgrade tip waits until the player can afford one. */
export function coachText(step: CoachStep, o: CoachObs, touch: boolean): { n: number; title: MsgKey; text: MsgKey } | null {
  switch (step) {
    case 'build':
      return { n: 1, title: 'coach.buildTitle', text: touch ? 'coach.build' : 'coach.buildMouse' };
    case 'pick':
      return { n: 1, title: 'coach.pickTitle', text: touch ? 'coach.pick' : 'coach.pickMouse' };
    case 'wave':
      return { n: 2, title: 'coach.waveTitle', text: 'coach.wave' };
    case 'upgrade':
      return o.gold >= o.cheapestUpgrade ? { n: 3, title: 'coach.upgradeTitle', text: touch ? 'coach.upgrade' : 'coach.upgradeMouse' } : { n: 3, title: 'coach.goldTitle', text: 'coach.gold' };
    case 'hero':
      return { n: 4, title: 'coach.heroTitle', text: touch ? 'coach.hero' : 'coach.heroMouse' };
    case 'meteor':
      return o.meteorReady ? { n: 5, title: 'coach.meteorTitle', text: touch ? 'coach.meteor' : 'coach.meteorMouse' } : null;
    default:
      return null;
  }
}

export const COACH_KEY = 'skyhold2d_coach_v1';

export function coachDone(): boolean {
  try {
    return localStorage.getItem(COACH_KEY) === 'done';
  } catch {
    return false;
  }
}

function markDone(): void {
  try {
    localStorage.setItem(COACH_KEY, 'done');
  } catch {
    // private mode: the tips just come back next time
  }
}

const overlap = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Where the coach card goes: its home spot (top centre) unless that covers a HUD piece (the
 * ability / hero bar can sit in the top band on dense islands — and the tips point at it). Then
 * beside the piece it covers, else under it; the card stays on screen. Pure (QA / tests).
 */
export function coachCardSpot(home: Rect, keepOuts: readonly Rect[], screen: { readonly w: number; readonly h: number }, gap = 10): { x: number; y: number } {
  const hits = keepOuts.filter((k) => overlap(home, k) > 0);
  if (hits.length === 0) return { x: home.x, y: home.y };
  const clampX = (x: number): number => Math.max(gap, Math.min(screen.w - gap - home.w, x));
  const cands: { x: number; y: number }[] = [];
  for (const k of hits) {
    cands.push({ x: clampX(k.x + k.w + gap), y: home.y }, { x: clampX(k.x - gap - home.w), y: home.y });
  }
  const below = Math.max(...hits.map((k) => k.y + k.h)) + gap;
  cands.push({ x: home.x, y: below });
  let best = { x: home.x, y: home.y };
  let bestA = Infinity;
  for (const c of cands) {
    const box = { x: c.x, y: c.y, w: home.w, h: home.h };
    if (box.y + box.h > screen.h) continue;
    const a = keepOuts.reduce((sum, k) => sum + overlap(box, k), 0);
    // Least covered; ties keep the earlier (same height) spot.
    if (a < bestA) {
      bestA = a;
      best = c;
    }
  }
  return best;
}

export interface Coach2D {
  /** Every frame. `target` = screen point to point at (null = no arrow); `hidden` = a sheet / end panel / story is up. */
  update(o: CoachObs, target: { x: number; y: number; dir?: 'down' | 'left' | 'right' } | null, hidden: boolean): void;
  readonly step: CoachStep;
  debug(): { step: CoachStep; shown: boolean; arrow: { x: number; y: number } | null };
}

export function mountCoach(touch: boolean, heroName: string): Coach2D {
  const card = el('div', 'pu pu-coach', { role: 'status', 'aria-live': 'polite', 'data-testid': 'coach2d-card' });
  const count = el('span', 'pu-coach-n pu-letter');
  const title = el('div', 'pu-coach-title pu-ink');
  const text = el('div', 'pu-coach-text pu-ink-soft');
  const skip = el('button', 'pu-coach-skip pu-ink-soft', { type: 'button', 'data-testid': 'coach2d-skip' }, t('coach.skip'));
  // "Skip tips" rides on the title row (right) so the card stays two lines tall.
  card.append(el('div', 'pu-coach-head', {}, count, title, skip), text);
  const arrow = el('div', 'pu pu-coach-arrow', { 'aria-hidden': 'true', 'data-testid': 'coach2d-arrow' });
  card.style.display = 'none';
  arrow.style.display = 'none';
  document.body.append(card, arrow);
  let step: CoachStep = 'build';
  let key = '';
  let shown = false;
  let arrowAt: { x: number; y: number } | null = null;
  /** The card's home box (top centre), measured when its text or the window changes. */
  let home: Rect | null = null;
  let homeFor = '';
  /** Where the card stands while shown: a HUD keep-out for the next-wave card / foe card. */
  let cardBox: Rect | null = null;
  let placing = false;
  const dropKeepOut = addHudKeepOut(() => (shown && !placing && cardBox ? { x: cardBox.x - 6, y: cardBox.y - 6, w: cardBox.w + 12, h: cardBox.h + 12 } : null));
  const place = (): void => {
    const sizeKey = `${key}|${window.innerWidth}x${window.innerHeight}`;
    if (sizeKey !== homeFor || !home) {
      homeFor = sizeKey;
      card.classList.remove('moved');
      card.style.left = '';
      card.style.top = '';
      // Layout values (the pop animation's transform must not count): CSS centres it on `left`.
      const cs = getComputedStyle(card);
      const w = card.offsetWidth;
      home = { x: parseFloat(cs.left) - w / 2, y: parseFloat(cs.top), w, h: card.offsetHeight };
    }
    placing = true;
    const at = coachCardSpot(home, hudKeepOuts(), { w: window.innerWidth, h: window.innerHeight });
    placing = false;
    const moved = at.x !== home.x || at.y !== home.y;
    cardBox = { x: at.x, y: at.y, w: home.w, h: home.h };
    // Off its home spot: plain left / top (the pop animation's translateX(-50%) assumes the home spot).
    card.classList.toggle('moved', moved);
    card.style.left = moved ? `${Math.round(at.x)}px` : '';
    card.style.top = moved ? `${Math.round(at.y)}px` : '';
  };
  const finish = (): void => {
    step = 'done';
    shown = false;
    markDone();
    dropKeepOut();
    card.remove();
    arrow.remove();
  };
  skip.addEventListener('click', finish);
  return {
    get step() {
      return step;
    },
    update(o, target, hidden) {
      if (step === 'done') return;
      step = coachStep(step, o);
      if (step === 'done') {
        finish();
        return;
      }
      const msg = hidden ? null : coachText(step, o, touch);
      shown = !!msg;
      card.style.display = msg ? '' : 'none';
      if (msg) {
        const k = `${step}|${msg.text}`;
        if (k !== key) {
          key = k;
          count.textContent = `${msg.n}/${COACH_TOTAL}`;
          title.textContent = t(msg.title, { hero: heroName });
          text.textContent = t(msg.text, { hero: heroName });
          card.classList.remove('pop');
          void card.offsetWidth;
          card.classList.add('pop');
        }
        place();
      }
      arrowAt = msg && target ? target : null;
      arrow.style.display = arrowAt ? '' : 'none';
      if (arrowAt) {
        arrow.style.transform = `translate(${Math.round(arrowAt.x)}px, ${Math.round(arrowAt.y)}px)`; // i18n-ignore (css)
        arrow.dataset.dir = target?.dir ?? 'down';
      }
    },
    debug: () => ({ step, shown, arrow: arrowAt }),
  };
}
