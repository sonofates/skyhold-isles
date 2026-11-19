/**
 * Marks the document with input-device classes so CSS and UI modules can branch on them:
 *  - `html.is-touch`   coarse primary pointer (phones / tablets)
 *  - `html.has-radial` the radial build / tower menu is the active interaction model
 *
 * `?touch=1` / `?touch=0` force the result (QA on desktop browsers).
 */
type Listener = (isTouch: boolean) => void;

let touch = false;
const listeners = new Set<Listener>();
let mediaUnsub: (() => void) | null = null;

function forcedValue(): boolean | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return null;
}

function apply(next: boolean): void {
  const changed = next !== touch;
  touch = next;
  const root = document.documentElement;
  root.classList.toggle('is-touch', next);
  root.classList.toggle('has-radial', next);
  if (changed) {
    for (const fn of listeners) fn(next);
  }
}

export function isTouchDevice(): boolean {
  return touch;
}

/** True when the radial menu replaces the build bar / anchored panel. */
export function isRadialActive(): boolean {
  return touch;
}

export function onDeviceClassChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initDeviceClass(): void {
  mediaUnsub?.();
  mediaUnsub = null;
  const forced = forcedValue();
  if (forced !== null) {
    apply(forced);
    return;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    apply(false);
    return;
  }
  const mq = window.matchMedia('(pointer: coarse)');
  apply(mq.matches);
  if (typeof mq.addEventListener === 'function') {
    const onChange = (e: MediaQueryListEvent): void => apply(e.matches);
    mq.addEventListener('change', onChange);
    mediaUnsub = () => mq.removeEventListener('change', onChange);
  }
}
