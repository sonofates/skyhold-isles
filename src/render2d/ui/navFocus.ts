/**
 * Keyboard + gamepad navigation of every painted menu (Steam / controller play).
 *
 * Scope = the topmost thing that owns the keys: an open board (`.pu-overlay`, last opened wins), the
 * title screen, the in-run pause menu, the world map. Inside it:
 * - Arrows (and W A S D, menus only) move the focus to the nearest control that way (spatial
 *   navigation); a focused slider keeps ← → for its value. Enter / Space press (native buttons).
 * - The focus ring is the painted gold ring, shown only while the keyboard or a pad is in use
 *   (`pu-kbd` on <html>; any pointer press hides it again).
 * Gamepad (standard mapping, polled while a pad is connected): D-pad / left stick = arrows (with
 * key repeat), A = press, B = back (Esc), LB / RB = previous / next tab, Start = pause (in a run) or
 * press. In a run with no menu open the pad's buttons go to `onGamePad` (game2d's pad cursor).
 */

export type NavDir = 'up' | 'down' | 'left' | 'right';

export interface NavRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Spatial pick: the candidate nearest to `from` in direction `dir`. First pass: only boxes that lie
 * beyond `from`'s edge that way (a quarter of the smaller box may overlap), so a neighbour in the
 * same row a few pixels higher is not "up"; if none, any box whose centre lies that way. The
 * distance along the direction counts once, the sideways offset (beyond overlap) three times, so a
 * control straight ahead beats a closer one off to the side. -1 when none lies that way.
 */
export function pickInDirection(from: NavRect, dir: NavDir, cands: readonly NavRect[]): number {
  const strict = pickPass(from, dir, cands, true);
  return strict >= 0 ? strict : pickPass(from, dir, cands, false);
}

function beyondEdge(from: NavRect, dir: NavDir, c: NavRect): boolean {
  const tolX = Math.min(from.w, c.w) * 0.25;
  const tolY = Math.min(from.h, c.h) * 0.25;
  switch (dir) {
    case 'up':
      return c.y + c.h <= from.y + tolY;
    case 'down':
      return c.y >= from.y + from.h - tolY;
    case 'left':
      return c.x + c.w <= from.x + tolX;
    case 'right':
      return c.x >= from.x + from.w - tolX;
  }
}

function pickPass(from: NavRect, dir: NavDir, cands: readonly NavRect[], strict: boolean): number {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best = -1;
  let bestScore = Infinity;
  cands.forEach((c, i) => {
    if (strict && !beyondEdge(from, dir, c)) return;
    const x = c.x + c.w / 2;
    const y = c.y + c.h / 2;
    const dx = x - cx;
    const dy = y - cy;
    let along: number;
    let side: number;
    if (dir === 'left' || dir === 'right') {
      along = dir === 'right' ? dx : -dx;
      // Sideways gap between the two boxes' vertical spans (0 when they overlap).
      side = Math.max(0, Math.max(from.y, c.y) - Math.min(from.y + from.h, c.y + c.h));
    } else {
      along = dir === 'down' ? dy : -dy;
      side = Math.max(0, Math.max(from.x, c.x) - Math.min(from.x + from.w, c.x + c.w));
    }
    if (along <= 1) return;
    const score = along + side * 3;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Arrow / WASD key → direction (WASD only when `letters`). */
export function keyDir(key: string, letters: boolean): NavDir | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
  }
  if (!letters) return null;
  switch (key.toLowerCase()) {
    case 'w':
      return 'up';
    case 's':
      return 'down';
    case 'a':
      return 'left';
    case 'd':
      return 'right';
  }
  return null;
}

/** Standard-mapping gamepad buttons. */
export const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;
export type PadButton = keyof typeof PAD;

/** Left stick → direction (dead zone 0.5, the larger axis wins). */
export function stickDir(x: number, y: number, dead = 0.5): NavDir | null {
  if (Math.abs(x) < dead && Math.abs(y) < dead) return null;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

/** Stick axis with a 0.18 dead zone, rescaled so the glide starts from 0. */
export function deadZone(v: number, dead = 0.18): number {
  const a = Math.abs(v);
  if (a < dead) return 0;
  return (Math.sign(v) * (a - dead)) / (1 - dead);
}

/** Key repeat for a held direction: first move at once, again after 380 ms, then every 110 ms. */
export function repeatDue(heldMs: number, lastFireMs: number, fired: number): boolean {
  if (fired === 0) return true;
  if (fired === 1) return heldMs >= 380;
  return heldMs - lastFireMs >= 110;
}

const FOCUSABLE = 'button, [role="slider"], [role="switch"], [tabindex]:not([tabindex="-1"])'; // i18n-ignore (selector)

function visible(e: HTMLElement): boolean {
  if ((e as HTMLButtonElement).disabled) return false;
  if (e.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const r = e.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) {
    // Off screen: only reachable inside a scroller (the map's sea, a long list) that can bring it in.
    if (!scrollParent(e)) return false;
  }
  const cs = getComputedStyle(e);
  return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && Number(cs.opacity) > 0.05;
}

function scrollParent(e: HTMLElement): HTMLElement | null {
  for (let p = e.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY) && (p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1)) return p;
  }
  return null;
}

/** The DOM scope that owns the keys now (null = the game canvas has them). */
export function navScope(): HTMLElement | null {
  const overlays = document.querySelectorAll<HTMLElement>('.pu-overlay:not(.closing)');
  if (overlays.length > 0) return overlays[overlays.length - 1];
  const title = document.querySelector<HTMLElement>('.pu-title:not(.leaving)');
  if (title) return title;
  const pause = document.querySelector<HTMLElement>('.pu-pause-menu');
  if (pause && !pause.hidden && pause.getBoundingClientRect().width > 0) return pause;
  return document.querySelector<HTMLElement>('.pu-map');
}

/** Controls the arrows walk; `data-nav-skip` marks pointer-only helpers (the map's pan arrows: focusing an island scrolls the sea anyway). */
function candidates(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => e.dataset.navSkip === undefined && visible(e));
}

function rectOf(e: Element): NavRect {
  const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/**
 * Where a scope's focus starts: a marked default, the main (glowing) plank, a checked tab, else the
 * first. The marked default counts even while it is still fading in (the map's islands pop in one by
 * one: a key pressed meanwhile must still land on the island to play next).
 */
function defaultTarget(list: HTMLElement[], scope?: HTMLElement): HTMLElement | null {
  const marked = scope?.querySelector<HTMLElement>('[data-nav-default]');
  const early = marked && !(marked as HTMLButtonElement).disabled && !marked.closest('[hidden], [inert]') ? marked : null; // i18n-ignore (selector)
  return (
    early ??
    list.find((e) => e.dataset.navDefault !== undefined) ??
    list.find((e) => e.classList.contains('primary')) ??
    list.find((e) => e.classList.contains('pu-confirm-yes') === false && e.closest('.pu-confirm-row') !== null) ??
    list.find((e) => !e.classList.contains('pu-sheet-close')) ??
    list[0] ??
    null
  );
}

/** Controls that use ← → themselves (sliders, `data-nav-keep` radio rows). */
function keepsSideKeys(e: HTMLElement): boolean {
  return e.getAttribute('role') === 'slider' || e.dataset.navKeep !== undefined;
}

function setKbd(on: boolean): void {
  document.documentElement.classList.toggle('pu-kbd', on);
  if (!on) setPadMode(false);
}

/**
 * `pu-pad` on <html> while the controller is the last thing used: the HUD's key badges show the pad
 * buttons (Y, LB, RB, LT, RT) instead of the keyboard letters. A real key or pointer press ends it.
 */
export function setPadMode(on: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('pu-pad', on);
}

function focusEl(e: HTMLElement): void {
  e.focus({ preventScroll: true });
  // Sideways (the map's sea) the focused island comes to the middle, not to the edge under the pan arrow.
  const instant = document.documentElement.classList.contains('pu-reduce-motion');
  e.scrollIntoView({ block: 'nearest', inline: 'center', behavior: instant ? 'auto' : 'smooth' });
}

/** Moves the focus inside the current scope; false when no scope / nothing that way. */
export function navMove(dir: NavDir): boolean {
  const scope = navScope();
  if (!scope) return false;
  const list = candidates(scope);
  if (list.length === 0) return false;
  const cur = document.activeElement instanceof HTMLElement && scope.contains(document.activeElement) && list.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) {
    const d = defaultTarget(list, scope);
    if (d) focusEl(d);
    return !!d;
  }
  const others = list.filter((e) => e !== cur);
  const i = pickInDirection(rectOf(cur), dir, others.map(rectOf));
  if (i < 0) {
    // At the edge: ↑ / ↓ scroll the board's long text (Logbook isles, Controls, Credits) that has
    // no buttons of its own to walk; otherwise stay (the key is still ours).
    if (dir === 'up' || dir === 'down') scrollScope(scope, dir === 'down' ? 1 : -1);
    return true;
  }
  focusEl(others[i]);
  return true;
}

/** The scope's main vertical scroller (the tallest one that has more to show), if any. */
export function scopeScroller(scope: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  const all = [scope, ...Array.from(scope.querySelectorAll<HTMLElement>('*'))];
  for (const e of all) {
    if (e.scrollHeight <= e.clientHeight + 1 || e.clientHeight < 40) continue;
    if (!/(auto|scroll)/.test(getComputedStyle(e).overflowY)) continue;
    if (!best || e.clientHeight > best.clientHeight) best = e;
  }
  return best;
}

/** Scroll step for one key press: about half the visible height, never under 60 px. */
export function scrollStep(clientHeight: number): number {
  return Math.max(60, Math.round(clientHeight * 0.5));
}

function scrollScope(scope: HTMLElement, sign: 1 | -1): boolean {
  const sc = scopeScroller(scope);
  if (!sc) return false;
  const reduced = document.documentElement.classList.contains('pu-reduce-motion');
  sc.scrollBy({ top: sign * scrollStep(sc.clientHeight), behavior: reduced ? 'auto' : 'smooth' });
  return true;
}

/** Presses the focused control (or the scope's default when nothing has focus). */
export function navPress(): boolean {
  const scope = navScope();
  if (!scope) return false;
  const a = document.activeElement;
  if (a instanceof HTMLElement && scope.contains(a) && a !== scope) {
    a.click();
    return true;
  }
  // Nothing focused: A presses the default (the island to play next, a board's main plank, a
  // confirm's safe choice, the title's "start").
  const d = defaultTarget(candidates(scope), scope);
  if (d) {
    focusEl(d);
    d.click();
  }
  return !!d;
}

/** LB / RB: the previous / next tab of the scope's tab row (Settings, Logbook, the hero tabs). */
export function navTab(step: 1 | -1): boolean {
  const scope = navScope();
  if (!scope) return false;
  const row = scope.querySelector<HTMLElement>('[role="tablist"]');
  if (!row) return false;
  const tabs = Array.from(row.querySelectorAll<HTMLElement>('button')).filter(visible);
  if (tabs.length < 2) return false;
  let i = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true' || b.classList.contains('on'));
  if (i < 0) i = 0;
  const next = tabs[(i + step + tabs.length) % tabs.length];
  next.click();
  // The row may have been rebuilt: focus the tab now in its place.
  const fresh = Array.from(row.querySelectorAll<HTMLElement>('button')).filter(visible)[(i + step + tabs.length) % tabs.length];
  if (fresh) focusEl(fresh);
  return true;
}

function fireKey(key: string, target: EventTarget = window): void {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
}

export interface NavOptions {
  /** A pad button in a run with no menu open (game2d's pad cursor); true = used. */
  onGamePad?: (b: PadButton) => boolean;
  /** Left-stick / D-pad direction in a run with no menu open. */
  onGameDir?: (dir: NavDir) => boolean;
  /**
   * The left stick every frame in a run with no menu open (dead zone applied, -1..1); true = the
   * game used it as an analog glide (the stick then gives no direction steps).
   */
  onGameStick?: (x: number, y: number, dtMs: number) => boolean;
}

let installed = false;
let opts: NavOptions = {};

/** Sets the in-run pad handlers (game2d registers them once the run is up). */
export function setGameNav(o: NavOptions): void {
  opts = o;
}

/** Installs the key + pad navigation once (main2d, for the map, the title and runs). */
export function installNav(o: NavOptions = {}): void {
  opts = { ...opts, ...o };
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // A real key press (pad presses arrive as synthetic keys) brings the keyboard letters back.
      if (e.isTrusted) setPadMode(false);
      if (e.key === 'Tab') setKbd(true); // i18n-ignore (key name)
      const scope = navScope();
      if (!scope) return;
      const a = document.activeElement;
      const inScope = a instanceof HTMLElement && scope.contains(a) && a !== scope;
      const dir = keyDir(e.key, true);
      if (dir) {
        // A slider / radio row keeps ← → for its own value.
        if (inScope && keepsSideKeys(a) && (dir === 'left' || dir === 'right')) return;
        setKbd(true);
        if (navMove(dir)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (e.key === ' ' && scope.classList.contains('pu-pause-menu')) {
        // Space resumes the run (game2d) — it must not also press the focused plank.
        if (a instanceof HTMLElement) a.blur();
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && !inScope) {
        // Nothing focused yet: land on the scope's default control; the scope's own Enter (the
        // map's "open the current island", the title's "press any key") still runs.
        setKbd(true);
        const d = defaultTarget(candidates(scope), scope);
        if (d) focusEl(d);
      }
    },
    { capture: true },
  );
  const pointer = (): void => setKbd(false);
  window.addEventListener('pointerdown', pointer, { capture: true, passive: true });
  startPadLoop();
}

// --- gamepad --------------------------------------------------------------------------------------

interface Held {
  since: number;
  last: number;
  fired: number;
}

function startPadLoop(): void {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
  let running = false;
  let lastFrame = performance.now();
  const prev = new Map<number, boolean>();
  let held: { dir: NavDir; h: Held } | null = null;
  const loop = (): void => {
    const pads = navigator.getGamepads().filter((p): p is Gamepad => !!p && p.connected);
    if (pads.length === 0) {
      running = false;
      return;
    }
    const now = performance.now();
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    const pressed = (i: number): boolean => pads.some((p) => !!p.buttons[i]?.pressed);
    // Buttons: fire on the press edge.
    for (const [name, i] of Object.entries(PAD) as [PadButton, number][]) {
      if (name === 'up' || name === 'down' || name === 'left' || name === 'right') continue;
      const on = pressed(i);
      if (on && !prev.get(i)) {
        setPadMode(true);
        padButton(name);
      }
      prev.set(i, on);
    }
    // Direction: D-pad first, then the left stick; repeats while held.
    const dpad: NavDir | null = pressed(PAD.up) ? 'up' : pressed(PAD.down) ? 'down' : pressed(PAD.left) ? 'left' : pressed(PAD.right) ? 'right' : null;
    let stick: NavDir | null = null;
    for (const p of pads) stick ??= stickDir(p.axes[0] ?? 0, p.axes[1] ?? 0);
    if (!navScope() && opts.onGameStick) {
      const p = pads[0];
      const ax = deadZone(p.axes[0] ?? 0);
      const ay = deadZone(p.axes[1] ?? 0);
      if (opts.onGameStick(ax, ay, dt)) {
        stick = null;
        if (ax !== 0 || ay !== 0) setPadMode(true);
      }
    }
    const dir = dpad ?? stick;
    if (!dir) held = null;
    else {
      if (!held || held.dir !== dir) held = { dir, h: { since: now, last: now, fired: 0 } };
      if (repeatDue(now - held.h.since, held.h.last - held.h.since, held.h.fired)) {
        held.h.fired++;
        held.h.last = now;
        setPadMode(true);
        padDir(dir);
      }
    }
    requestAnimationFrame(loop);
  };
  const start = (): void => {
    if (running) return;
    running = true;
    requestAnimationFrame(loop);
  };
  window.addEventListener('gamepadconnected', start);
  // A pad already connected before this page loaded shows up on its first button press.
  if (navigator.getGamepads().some((p) => p?.connected)) start();
}

function padDir(dir: NavDir): void {
  setKbd(true);
  const scope = navScope();
  if (scope) {
    const a = document.activeElement;
    if (a instanceof HTMLElement && scope.contains(a) && keepsSideKeys(a) && (dir === 'left' || dir === 'right')) {
      fireKey(dir === 'left' ? 'ArrowLeft' : 'ArrowRight', a);
      return;
    }
    navMove(dir);
    return;
  }
  opts.onGameDir?.(dir);
}

function padButton(b: PadButton): void {
  setKbd(true);
  const scope = navScope();
  if (scope) {
    if (b === 'a' || (b === 'start' && !document.querySelector('.pu-pause-menu:not([hidden])'))) navPress();
    else if (b === 'b') fireKey('Escape');
    else if (b === 'start') fireKey(' ');
    else if (b === 'lb') navTab(-1);
    else if (b === 'rb') navTab(1);
    return;
  }
  if (opts.onGamePad?.(b)) return;
  if (b === 'start') fireKey(' ');
  else if (b === 'b') fireKey('Escape');
}
