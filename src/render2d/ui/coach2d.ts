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
      return { n: 1, title: 'coach.pickTitle', text: 'coach.pick' };
    case 'wave':
      return { n: 2, title: 'coach.waveTitle', text: 'coach.wave' };
    case 'upgrade':
      return o.gold >= o.cheapestUpgrade ? { n: 3, title: 'coach.upgradeTitle', text: 'coach.upgrade' } : { n: 3, title: 'coach.goldTitle', text: 'coach.gold' };
    case 'hero':
      return { n: 4, title: 'coach.heroTitle', text: touch ? 'coach.hero' : 'coach.heroMouse' };
    case 'meteor':
      return o.meteorReady ? { n: 5, title: 'coach.meteorTitle', text: 'coach.meteor' } : null;
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
  card.append(el('div', 'pu-coach-head', {}, count, title), text, skip);
  const arrow = el('div', 'pu pu-coach-arrow', { 'aria-hidden': 'true', 'data-testid': 'coach2d-arrow' });
  card.style.display = 'none';
  arrow.style.display = 'none';
  document.body.append(card, arrow);
  let step: CoachStep = 'build';
  let key = '';
  let shown = false;
  let arrowAt: { x: number; y: number } | null = null;
  const finish = (): void => {
    step = 'done';
    markDone();
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
