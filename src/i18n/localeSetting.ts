/**
 * Thin wrapper that stores the language with the shared settings.
 *
 * The shared settings live in src/platform/storage.ts (`skyhold_isles_settings_v1`), which this
 * task may not edit: its `loadSettings()` rebuilds the object field by field and `saveSettings()`
 * writes that object back, so a `language` field there would be dropped by the next save. So:
 *
 * - the language is written into the same settings JSON (`language: 'en' | 'tr'`, ignored by
 *   older code, backward compatible), and
 * - mirrored to its own key, which is what survives a settings save from code that does not
 *   know the field (the 3D settings modal, the 2D Settings sheet). `reapplyLocaleSetting()` puts
 *   it back into the JSON after such a save.
 *
 * When storage.ts gains a `language` field, this file can shrink to a re-export.
 */
const SETTINGS_KEY = 'skyhold_isles_settings_v1';
const LANG_KEY = 'skyhold_isles_language_v1';

type Lang = 'en' | 'tr';
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'tr';

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** The stored language, or null when the player never picked one. */
export function loadLocaleSetting(): Lang | null {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(SETTINGS_KEY);
    if (raw) {
      const v = (JSON.parse(raw) as { language?: unknown }).language;
      if (isLang(v)) return v;
    }
  } catch {
    /* a broken settings blob is storage.ts's business */
  }
  const side = ls.getItem(LANG_KEY);
  return isLang(side) ? side : null;
}

export function saveLocaleSetting(lang: Lang): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(LANG_KEY, lang);
    const raw = ls.getItem(SETTINGS_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    obj.language = lang;
    ls.setItem(SETTINGS_KEY, JSON.stringify(obj));
  } catch {
    /* quota / private mode */
  }
}

/** After `saveSettings()` (which drops unknown fields): write the language back into the JSON. */
export function reapplyLocaleSetting(): void {
  const ls = storage();
  const side = ls?.getItem(LANG_KEY);
  if (isLang(side)) saveLocaleSetting(side);
}
