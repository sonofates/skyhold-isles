/**
 * Tiny typed i18n for the painted (2D) game: `t(key, params?)` over two flat dictionaries
 * (src/i18n/en.ts, src/i18n/tr.ts). English is the source; Turkish must carry the same keys (the
 * type of `TR` and tests/i18n/coverage.test.ts both enforce it).
 *
 * - Params: `{name}` in a message is replaced by `params.name`.
 * - Plurals: a message may be `{ one, other }`; the form is picked from `params.n` with the
 *   locale's plural rules (EN: 1 → one; TR: nouns after a number stay singular, so most TR
 *   messages use the same text for both).
 * - Locale: module state, 'en' until `initLocale()` runs (the 2D entry calls it), so tests and
 *   node scripts are deterministic. `initLocale()` reads `?lang=`, then the stored setting
 *   (localeSetting.ts), then `navigator.language` (tr* → tr, else en).
 *
 * Data-table text (island / tower / enemy / challenge / workshop / feat names) lives in
 * src/data and is looked up by id in ./data.ts, falling back to the English data text.
 */
import { EN, type Msg, type MsgKey } from './en.ts';
import { TR } from './tr.ts';
import { loadLocaleSetting } from './localeSetting.ts';

export type Locale = 'en' | 'tr';
export const LOCALES: readonly Locale[] = ['en', 'tr'];
/** Each language in its own name (never translated). */
export const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', tr: 'Türkçe' };
export type { MsgKey };

const DICTS: Readonly<Record<Locale, Readonly<Record<MsgKey, Msg>>>> = { en: EN, tr: TR };

let current: Locale = 'en';

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'tr';
}

/** `navigator.language`-style tag → game locale (tr, tr-TR, TR → tr; anything else → en). */
export function localeFromTag(tag: string | null | undefined): Locale {
  return typeof tag === 'string' && /^tr\b/i.test(tag.trim()) ? 'tr' : 'en';
}

export function getLocale(): Locale {
  return current;
}

/** Sets the active locale (and `<html lang>`, so CSS uppercase follows the TR İ/ı rules). */
export function setLocale(l: Locale): void {
  current = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

/** Startup: `?lang=` (QA) → stored setting → browser language. */
export function initLocale(search: string = typeof location !== 'undefined' ? location.search : ''): Locale {
  const q = new URLSearchParams(search).get('lang');
  const stored = loadLocaleSetting();
  const nav = typeof navigator !== 'undefined' ? navigator.language : undefined;
  setLocale(isLocale(q) ? q : stored ?? localeFromTag(nav));
  return current;
}

export type Params = Readonly<Record<string, string | number>>;

const pluralRules = new Map<Locale, Intl.PluralRules | null>();
function pluralForm(l: Locale, n: number): 'one' | 'other' {
  if (!pluralRules.has(l)) {
    try {
      pluralRules.set(l, new Intl.PluralRules(l));
    } catch {
      pluralRules.set(l, null);
    }
  }
  const r = pluralRules.get(l);
  const cat = r ? r.select(n) : n === 1 ? 'one' : 'other';
  return cat === 'one' ? 'one' : 'other';
}

function interpolate(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Message in the active locale (English when the key is missing there). */
export function t(key: MsgKey, params?: Params): string {
  return tIn(current, key, params);
}

/** Message in a given locale. */
export function tIn(l: Locale, key: MsgKey, params?: Params): string {
  const msg: Msg | undefined = DICTS[l][key] ?? EN[key];
  if (msg === undefined) return key;
  const s = typeof msg === 'string' ? msg : msg[pluralForm(l, Number(params?.n ?? 0))];
  return interpolate(s, params);
}

/** Locale-aware uppercase (Turkish: i → İ, ı → I). */
export function upper(s: string, l: Locale = current): string {
  return s.toLocaleUpperCase(l === 'tr' ? 'tr-TR' : 'en-US');
}

/** Locale-aware lowercase (Turkish: I → ı, İ → i). */
export function lower(s: string, l: Locale = current): string {
  return s.toLocaleLowerCase(l === 'tr' ? 'tr-TR' : 'en-US');
}

const numberFormats = new Map<string, Intl.NumberFormat>();
function nf(l: Locale, opts: Intl.NumberFormatOptions, key: string): Intl.NumberFormat {
  const k = `${l}|${key}`;
  let f = numberFormats.get(k);
  if (!f) {
    f = new Intl.NumberFormat(l === 'tr' ? 'tr-TR' : 'en-US', opts);
    numberFormats.set(k, f);
  }
  return f;
}

/** A number as the locale writes it, no grouping (EN 0.52 · TR 0,52). */
export function num(n: number, l: Locale = current): string {
  return nf(l, { maximumFractionDigits: 2, useGrouping: false }, 'num').format(n);
}

/** A ratio as a percentage (EN 12% · TR %12). */
export function pct(ratio: number, l: Locale = current): string {
  return nf(l, { style: 'percent', maximumFractionDigits: 0 }, 'pct').format(ratio);
}

/** Short UTC date for a day number (e.g. "Nov 18" / "18 Kas"). */
export function shortDate(dayNumber: number, l: Locale = current): string {
  return new Date(dayNumber * 86_400_000).toLocaleDateString(l === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
