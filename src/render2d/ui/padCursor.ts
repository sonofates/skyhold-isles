/**
 * In-run cursor for the keyboard and the gamepad (Steam / controller play). It is a virtual mouse:
 * a painted gold reticle whose "clicks" are pointer events on the canvas at its spot, so every
 * existing rule (build ring, tower card, hero select / move, rally flag, ability and hero-skill
 * aiming, the end board) works exactly as with a mouse.
 * - Snap mode (game2d.padTargets): arrows / D-pad / stick jump between the plots and the hero; with
 *   the ring open, between its tokens; on the end board, between its buttons.
 * - Free mode (hero move order, rally flag, an ability or hero skill aiming): the stick glides the
 *   reticle (analog), arrows / D-pad step it.
 * - Enter / A = click. B / Esc = back (game2d closes ring / hero / aim). X = call the wave, Y = select
 *   the hero (the reticle jumps to it), LB / RB = Meteor / Overcharge, LT / RT = hero skills,
 *   Start = pause.
 * Shown from the first arrow / pad input; any real mouse or touch hides it again.
 */
import { ABILITY_KEYS } from './abilities2d.ts';
import { HERO_KEYS } from './heroKeys.ts';
import { keyDir, navScope, pickInDirection, setGameNav, type NavDir, type PadButton } from './navFocus.ts';
import './padCursor.css';

export type PadMode = 'ring' | 'end' | 'free' | 'snap';

export interface PadCursorHost {
  readonly canvas: HTMLCanvasElement;
  targets(): { mode: PadMode; points: { x: number; y: number }[] };
  /** An ability or hero skill is aiming (the reticle glides). */
  aiming(): boolean;
  /** Screen spot of the hero (Y jumps there), null without one. */
  heroSpot(): { x: number; y: number } | null;
  /** Run is paused (the cursor waits; the pause menu has the keys). */
  paused(): boolean;
  /** Where a click at the reticle lands (game2d.padClickPoint: a hero move snaps onto the road). */
  clickPoint?(x: number, y: number): { x: number; y: number };
}

export interface PadCursor {
  state(): { shown: boolean; x: number; y: number; mode: PadMode };
  move(dir: NavDir): void;
  click(): void;
}

/** Free glide speed at full stick, as a share of the screen's shorter side per second. */
export const GLIDE_PER_S = 0.9;
/** One arrow / D-pad step in free mode, share of the shorter side. */
export const FREE_STEP = 0.045;

/** The point nearest to `p` (index), -1 for none. */
export function nearestPoint(p: { x: number; y: number }, pts: readonly { x: number; y: number }[]): number {
  let best = -1;
  let bd = Infinity;
  pts.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Pad buttons → the key the run already understands (null = handled here or by default). */
export function padKey(b: PadButton): string | null {
  switch (b) {
    case 'x':
      return 'n';
    case 'y':
      return HERO_KEYS.select;
    case 'lb':
      return ABILITY_KEYS.meteor;
    case 'rb':
      return ABILITY_KEYS.overcharge;
    case 'lt':
      return HERO_KEYS.skill0;
    case 'rt':
      return HERO_KEYS.skill1;
    case 'start':
      return ' ';
    case 'b':
      return 'Escape'; // i18n-ignore (key name)
    default:
      return null;
  }
}

/** Visible DOM buttons of the battle HUD (not boards, not the pause menu). */
function hudButtons(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.pu button')).filter((b) => { // i18n-ignore (selector)
    if ((b as HTMLButtonElement).disabled || b.closest('.pu-overlay, .pu-pause-menu, .pu-padcursor, [hidden]')) return false; // i18n-ignore (selector)
    const r = b.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) return false;
    const cs = getComputedStyle(b);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.2;
  });
}

function hudButtonSpots(): { x: number; y: number }[] {
  return hudButtons().map((b) => {
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

/** The HUD button whose box holds (x, y), if any. */
function hudButtonAt(x: number, y: number): HTMLElement | null {
  return (
    hudButtons().find((b) => {
      const r = b.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) ?? null
  );
}

export function mountPadCursor(host: PadCursorHost): PadCursor {
  const reticle = document.createElement('div');
  reticle.className = 'pu pu-padcursor';
  reticle.setAttribute('aria-hidden', 'true');
  reticle.dataset.testid = 'pad2d-cursor';
  reticle.append(document.createElement('i'), document.createElement('b'));
  document.body.append(reticle);
  let shown = false;
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let mode: PadMode = 'snap';

  const paint = (): void => {
    const live = shown && !navScope() && !host.paused();
    reticle.classList.toggle('on', live);
    reticle.dataset.mode = mode;
    reticle.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; // i18n-ignore (CSS)
  };

  const pointer = (type: 'pointermove' | 'pointerdown' | 'pointerup'): void => {
    const r = host.canvas.getBoundingClientRect();
    host.canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: r.left + x,
        clientY: r.top + y,
        pointerId: 4242,
        pointerType: 'mouse',
        isPrimary: true,
        button: type === 'pointermove' ? -1 : 0,
        buttons: type === 'pointerdown' ? 1 : 0,
      }),
    );
  };

  const clampToScreen = (): void => {
    x = Math.max(4, Math.min(window.innerWidth - 4, x));
    y = Math.max(4, Math.min(window.innerHeight - 4, y));
  };

  const currentMode = (): { mode: PadMode; points: { x: number; y: number }[] } => {
    const t = host.targets();
    if (host.aiming() && t.mode !== 'end') return { mode: 'free', points: [] };
    // Snap mode also reaches the HUD's own buttons (Codex, Settings, abilities, hero, skills).
    if (t.mode === 'snap') return { mode: 'snap', points: [...t.points, ...hudButtonSpots()] };
    return t;
  };

  /** First input: show the reticle on the nearest target (screen centre in free mode). */
  const wake = (): boolean => {
    if (shown) return false;
    shown = true;
    const t = currentMode();
    mode = t.mode;
    const i = nearestPoint({ x, y }, t.points);
    if (i >= 0) {
      x = t.points[i].x;
      y = t.points[i].y;
    }
    pointer('pointermove');
    paint();
    return true;
  };

  const move = (dir: NavDir): void => {
    if (wake()) return;
    const t = currentMode();
    mode = t.mode;
    if (t.mode === 'free' || t.points.length === 0) {
      const step = FREE_STEP * Math.min(window.innerWidth, window.innerHeight);
      x += dir === 'left' ? -step : dir === 'right' ? step : 0;
      y += dir === 'up' ? -step : dir === 'down' ? step : 0;
      clampToScreen();
    } else {
      const from = { x: x - 4, y: y - 4, w: 8, h: 8 };
      const i = pickInDirection(
        from,
        dir,
        t.points.map((p) => ({ x: p.x - 4, y: p.y - 4, w: 8, h: 8 })),
      );
      if (i < 0) return;
      x = t.points[i].x;
      y = t.points[i].y;
    }
    pointer('pointermove');
    paint();
  };

  const click = (): void => {
    if (wake()) return;
    const at = host.clickPoint?.(x, y);
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      x = at.x;
      y = at.y;
      paint();
    }
    // A HUD button under the reticle is pressed as a button; anything else is a click on the map.
    const b = hudButtonAt(x, y);
    if (b) b.click();
    else {
      pointer('pointerdown');
      pointer('pointerup');
    }
    // The click may have opened the ring / selected the hero: the next move uses the new targets.
    requestAnimationFrame(() => {
      mode = currentMode().mode;
      paint();
    });
  };

  const glide = (ax: number, ay: number, dtMs: number): boolean => {
    if (!shown && ax === 0 && ay === 0) return false;
    const t = currentMode();
    if (t.mode !== 'free') return false;
    if (ax === 0 && ay === 0) return true;
    wake();
    mode = 'free';
    const v = GLIDE_PER_S * Math.min(window.innerWidth, window.innerHeight) * (dtMs / 1000);
    x += ax * v;
    y += ay * v;
    clampToScreen();
    pointer('pointermove');
    paint();
    return true;
  };

  const sendKey = (key: string): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };

  setGameNav({
    onGameDir: (dir) => {
      move(dir);
      return true;
    },
    onGameStick: glide,
    onGamePad: (b) => {
      if (b === 'a') {
        click();
        return true;
      }
      const key = padKey(b);
      if (!key) return false;
      sendKey(key);
      if (b === 'y') {
        // Hero selected: the reticle goes to it, ready to glide to the move spot.
        const h = host.heroSpot();
        if (h) {
          shown = true;
          x = h.x;
          y = h.y;
        }
      }
      if (b === 'lb' || b === 'rb' || b === 'lt' || b === 'rt' || b === 'y') {
        shown = true;
        requestAnimationFrame(() => {
          mode = currentMode().mode;
          pointer('pointermove');
          paint();
        });
      }
      return true;
    },
  });

  // Keyboard in a run: arrows move the reticle, Enter clicks (WASD stay ability / hero keys).
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || navScope()) return;
    const dir = keyDir(e.key, false);
    if (dir) {
      e.preventDefault();
      document.documentElement.classList.add('pu-kbd');
      move(dir);
      return;
    }
    if (e.key === 'Enter' && shown && !e.repeat) {
      e.preventDefault();
      click();
    }
  });
  // A real mouse / finger takes over.
  const hide = (e: PointerEvent): void => {
    if (!e.isTrusted || !shown) return;
    if (e.type === 'pointermove' && e.pointerType !== 'mouse') return;
    shown = false;
    paint();
  };
  window.addEventListener('pointermove', hide, { capture: true, passive: true });
  window.addEventListener('pointerdown', hide, { capture: true, passive: true });
  // Mode / visibility follow the run (the ring opening, the pause menu, a board).
  const tick = (): void => {
    if (shown) {
      // Mode only (no DOM button scan every frame).
      const t = host.targets().mode;
      const m = host.aiming() && t !== 'end' ? 'free' : t;
      if (m !== mode) mode = m;
      paint();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  paint();

  return {
    state: () => ({ shown, x, y, mode }),
    move,
    click,
  };
}
