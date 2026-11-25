/**
 * Rebindable battle hotkeys (Settings → Controls). One key per action, stored under its own
 * localStorage key; a pick that is already used by another action swaps the two, so a key never
 * does two things. Bindable keys: A–Z, 0–9 and Space. Esc, Enter, Tab, the arrows and the function
 * keys stay fixed (menus, the pad cursor and the desktop shell own them).
 *
 * Bindings are stored as layout labels ('Q', '1', 'SPACE') and matched against `KeyboardEvent.key`
 * first, then the physical `code` (so a non-Latin layout still finds KeyQ / Digit1).
 * Pure apart from the storage helpers; no i18n here (the Settings view labels the keys).
 */

export const KEY_ACTIONS = [
  'pause',
  'speed1',
  'speed2',
  'speed3',
  'wave',
  'meteor',
  'overcharge',
  'heroSelect',
  'heroSkill0',
  'heroSkill1',
  'item0',
  'item1',
  'item2',
] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];
export type KeyBindings = Readonly<Record<KeyAction, string>>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = Object.freeze({
  pause: 'SPACE',
  speed1: '1',
  speed2: '2',
  speed3: '3',
  wave: 'N',
  meteor: 'Q',
  overcharge: 'W',
  heroSelect: 'H',
  heroSkill0: 'E',
  heroSkill1: 'R',
  item0: 'Z',
  item1: 'X',
  item2: 'C',
});

export const KEY_BINDINGS_KEY = 'skyhold_isles_keys_v1';
/** Window event fired after the bindings change (HUD key badges re-letter themselves). */
export const KEY_BINDINGS_EVENT = 'skyhold:keys';

const SPACE = 'SPACE';
/** The stored label of the space bar. */
export const SPACE_LABEL = SPACE;

/** A label for a round HUD key badge: the space bar is drawn as ␣ (too wide to spell out). */
export function badgeLabel(label: string): string {
  return label === SPACE ? '␣' : label;
}

/** A binding label for a `KeyboardEvent.key` value, or null when that key cannot be bound. */
export function normalizeKey(key: string): string | null {
  if (key === ' ' || key === 'Spacebar' || key === SPACE) return SPACE; // i18n-ignore (key name)
  if (key.length === 1 && /^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  return null;
}

/** A binding label for a physical `KeyboardEvent.code` (KeyQ → Q, Digit1 / Numpad1 → 1, Space). */
export function codeKey(code: string): string | null {
  if (code === 'Space') return SPACE; // i18n-ignore (key code)
  const m = /^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9]))$/.exec(code);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

/** The binding label a key press stands for (its character first, its key position as fallback). */
export function eventKey(e: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'code'>>): string | null {
  return normalizeKey(e.key) ?? (e.code ? codeKey(e.code) : null);
}

export function isBindable(label: unknown): label is string {
  return typeof label === 'string' && normalizeKey(label) === label;
}

/** Repairs stored bindings: unknown / invalid entries take the default; any clash → all defaults. */
export function parseKeyBindings(raw: unknown): KeyBindings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_KEY_BINDINGS } as Record<KeyAction, string>;
  for (const a of KEY_ACTIONS) if (isBindable(o[a])) out[a] = o[a] as string;
  const used = new Set(KEY_ACTIONS.map((a) => out[a]));
  return used.size === KEY_ACTIONS.length ? Object.freeze(out) : DEFAULT_KEY_BINDINGS;
}

/** Binds `action` to `label`; the action that held `label` before takes the old key (a swap). */
export function rebind(b: KeyBindings, action: KeyAction, label: string): KeyBindings {
  if (!isBindable(label) || b[action] === label) return b;
  const out = { ...b } as Record<KeyAction, string>;
  const holder = KEY_ACTIONS.find((a) => b[a] === label);
  if (holder) out[holder] = b[action];
  out[action] = label;
  return Object.freeze(out);
}

/** Which action (if any) a key press triggers. */
export function actionForKey(b: KeyBindings, e: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'code'>>): KeyAction | null {
  const k = eventKey(e);
  if (!k) return null;
  return KEY_ACTIONS.find((a) => b[a] === k) ?? null;
}

/** The `KeyboardEvent.key` a synthetic press of `label` carries (the pad cursor replays keys). */
export function domKeyFor(label: string): string {
  return label === SPACE ? ' ' : label;
}

// --- live bindings ----------------------------------------------------------------------------------

let cache: KeyBindings | null = null;

function store(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadKeyBindings(): KeyBindings {
  if (cache) return cache;
  let parsed: KeyBindings = DEFAULT_KEY_BINDINGS;
  try {
    const raw = store()?.getItem(KEY_BINDINGS_KEY);
    if (raw) parsed = parseKeyBindings(JSON.parse(raw));
  } catch {
    parsed = DEFAULT_KEY_BINDINGS;
  }
  cache = parsed;
  return parsed;
}

export function saveKeyBindings(b: KeyBindings): void {
  cache = parseKeyBindings(b);
  try {
    store()?.setItem(KEY_BINDINGS_KEY, JSON.stringify(cache));
  } catch {
    // private mode: the bindings still hold for this session
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(KEY_BINDINGS_EVENT));
}

export function resetKeyBindings(): void {
  saveKeyBindings(DEFAULT_KEY_BINDINGS);
}

/** Test hook / another tab changed the storage: read it again on the next call. */
export function forgetKeyBindingsCache(): void {
  cache = null;
}

/** The label bound to `action` right now. */
export function keyFor(action: KeyAction): string {
  return loadKeyBindings()[action];
}

/** Does this key press trigger `action`? */
export function matchesAction(e: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'code'>>, action: KeyAction): boolean {
  const k = eventKey(e);
  return k !== null && k === keyFor(action);
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY_BINDINGS_KEY) {
      cache = null;
      window.dispatchEvent(new Event(KEY_BINDINGS_EVENT));
    }
  });
}
