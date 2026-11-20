import type { GameSettings, ProgressData, QualityLevel } from '../core/types.ts';
import { createDailyRecord, sanitizeDailyRecord } from '../data/daily.ts';
import { sanitizeDifficultyWins } from '../data/difficulty.ts';
import { HERO_IDS, hasHeroSaveProgress, sanitizeHeroSaveData } from '../data/heroes.ts';
import { sanitizeRanks } from '../data/workshop.ts';
import { starWallet } from '../game/progression.ts';
import { syncAchievementsFromProgress } from './achievements.ts';
import { getPlatform, type PlatformAdapter } from './platform.ts';

const SETTINGS_KEY = 'skyhold_isles_settings_v1';
const PROGRESS_KEY = 'skyhold_isles_progress_v1';
export const CLOUD_PROGRESS_SLOT = 'progress';
const LOCAL_CLOUD_PROGRESS_MIRROR_KEY = `skyhold_isles_cloud_${CLOUD_PROGRESS_SLOT}`;
const readingCloudAdapters = new WeakSet<PlatformAdapter>();
let progressResetGen = 0;

/** Monotonic counter incremented on `resetProgressSave` so in-flight cloud reads abort cleanly. */
export function getProgressResetGen(): number {
  return progressResetGen;
}

/** Tracks an active `hydrateProgressFromCloud` read so concurrent `saveProgress` calls never clobber it. */
export function setCloudReadInFlight(adapter: PlatformAdapter, active: boolean): void {
  if (active) readingCloudAdapters.add(adapter);
  else readingCloudAdapters.delete(adapter);
}
const FLYER_TOAST_SEEN_KEY = 'skyhold_isles_flyer_toast_seen_v1';
const UPGRADE_TOAST_SEEN_KEY = 'skyhold_isles_upgrade_toast_seen_v1';
const ENEMY_INTROS_SEEN_KEY = 'skyhold_isles_enemy_intros_seen_v1';

let enemyIntrosSeen: Set<string> | null = null;

function loadEnemyIntrosSeen(): Set<string> {
  if (enemyIntrosSeen) return enemyIntrosSeen;
  enemyIntrosSeen = new Set<string>();
  try {
    const raw = localStorage.getItem(ENEMY_INTROS_SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const v of parsed) if (typeof v === 'string') enemyIntrosSeen.add(v);
    }
  } catch {
    // ignore storage / parse errors
  }
  return enemyIntrosSeen;
}

/** First-encounter "new foe" hint per enemy type (cached in memory; persisted in localStorage). */
export function hasSeenEnemyIntro(type: string): boolean {
  return loadEnemyIntrosSeen().has(type);
}

export function markEnemyIntroSeen(type: string): void {
  const seen = loadEnemyIntrosSeen();
  if (seen.has(type)) return;
  seen.add(type);
  try {
    localStorage.setItem(ENEMY_INTROS_SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // ignore storage errors
  }
}

export function hasSeenUpgradeToast(): boolean {
  try {
    return localStorage.getItem(UPGRADE_TOAST_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markUpgradeToastSeen(): void {
  try {
    localStorage.setItem(UPGRADE_TOAST_SEEN_KEY, '1');
  } catch {
    // ignore storage errors
  }
}

export function hasSeenFlyerToast(): boolean {
  try {
    return localStorage.getItem(FLYER_TOAST_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markFlyerToastSeen(): void {
  try {
    localStorage.setItem(FLYER_TOAST_SEEN_KEY, '1');
  } catch {
    // Ignore storage quota / private mode failures
  }
}

export function isTouchDevice(): boolean {
  if (getPlatform().isMobile) return true;
  if (typeof window === 'undefined') return false;
  const hasTouchPoints = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const hasTouchEvent = 'ontouchstart' in window;
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return hasTouchPoints || hasTouchEvent || coarsePointer;
}

export function getDefaultSettings(): GameSettings {
  return {
    masterVolume: 0.65,
    muted: false,
    cameraShake: true,
    damageNumbers: true,
    // Everyone starts in Auto: the frame-time governor begins at High on desktop / Medium on touch
    // and steps down only when frames are actually slow.
    quality: 'auto',
    haptics: true,
  };
}

export const DEFAULT_SETTINGS: GameSettings = getDefaultSettings();

/**
 * Current progress save format. v1 = unlock/stars/endless only; v2 adds bestLives, clears,
 * Workshop ranks and challenge clears.
 */
export const PROGRESS_SAVE_VERSION = 2;
/** One-time copy of a pre-migration save, written before the first save in a newer format. */
export const PROGRESS_BACKUP_KEY = 'skyhold_isles_progress_backup_v1';
/** Forensic copy preserved once if the primary save slot encounters corrupted / truncated JSON. */
export const PROGRESS_CORRUPT_BACKUP_KEY = 'skyhold_isles_progress_corrupt_backup_v1';

export function createDefaultProgress(levelCount: number): ProgressData {
  const count = Number.isFinite(levelCount) ? Math.max(0, Math.floor(levelCount)) : 0;
  return {
    version: PROGRESS_SAVE_VERSION,
    unlockedLevelIndex: 0,
    bestStars: new Array<number>(count).fill(0),
    bestEndlessWaves: new Array<number>(count).fill(0),
    bestLives: new Array<number>(count).fill(0),
    clears: new Array<number>(count).fill(0),
    workshop: {},
    challengeClears: Array.from({ length: count }, () => []),
    daily: createDailyRecord(),
  };
}

/** Per-island list of unique short id strings (junk → empty list). */
function parseIslandIdLists(val: unknown, levelCount: number): string[][] {
  const out: string[][] = Array.from({ length: levelCount }, () => []);
  if (!Array.isArray(val)) return out;
  for (let i = 0; i < levelCount; i++) {
    const list: unknown = val[i];
    if (!Array.isArray(list)) continue;
    for (const id of list) {
      if (typeof id === 'string' && id.length > 0 && id.length <= 40 && !out[i].includes(id)) {
        out[i].push(id);
      }
    }
  }
  return out;
}

/** Per-island non-negative integer array of exactly `levelCount` entries (junk → 0). */
function parseIslandInts(val: unknown, levelCount: number, max = Number.MAX_SAFE_INTEGER): number[] {
  const out = new Array<number>(levelCount).fill(0);
  if (!Array.isArray(val)) return out;
  for (let i = 0; i < levelCount; i++) {
    const v: unknown = val[i];
    if (typeof v === 'number' && Number.isFinite(v)) out[i] = Math.max(0, Math.min(max, Math.floor(v)));
  }
  return out;
}

function parseQuality(val: unknown, fallback: QualityLevel): QualityLevel {
  return val === 'auto' || val === 'high' || val === 'medium' || val === 'low' ? val : fallback;
}

/** Bump when the stored settings shape changes; see loadSettings for the migration notes. */
const SETTINGS_VERSION = 3;

export function loadSettings(): GameSettings {
  const defaults = getDefaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const rawParsed: unknown = JSON.parse(raw);
    if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) return defaults;
    const parsed = rawParsed as Partial<GameSettings> & { v?: number };
    let quality = parseQuality(parsed.quality, defaults.quality);
    // v1 (pre-Auto) defaulted touch devices to 'low', so a stored 'low' on a touch device is
    // almost always that old default rather than a choice: move it to Auto. Explicit choices
    // made on desktop (or any v2 save) are kept as they are.
    if (parsed.v === undefined && quality === 'low' && isTouchDevice()) quality = 'auto';
    // Before v3, desktop defaulted to a fixed 'high' (no governor), which stutters on weaker GPUs.
    // A stored desktop 'high' from v1/v2 is that old default, not a choice: move it to Auto.
    if ((parsed.v === undefined || parsed.v < 3) && quality === 'high' && !isTouchDevice()) quality = 'auto';
    return {
      masterVolume:
        typeof parsed.masterVolume === 'number' && Number.isFinite(parsed.masterVolume)
          ? Math.max(0, Math.min(1, parsed.masterVolume))
          : defaults.masterVolume,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : defaults.muted,
      cameraShake:
        typeof parsed.cameraShake === 'boolean' ? parsed.cameraShake : defaults.cameraShake,
      damageNumbers:
        typeof parsed.damageNumbers === 'boolean'
          ? parsed.damageNumbers
          : defaults.damageNumbers,
      quality,
      haptics: typeof parsed.haptics === 'boolean' ? parsed.haptics : defaults.haptics,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, v: SETTINGS_VERSION }));
  } catch {
    // Ignore storage quota / private mode failures
  }
}

function normalizeRawDifficultyWins(rawDw: unknown): unknown {
  if (!rawDw || typeof rawDw !== 'object' || Array.isArray(rawDw)) return rawDw;
  const dw = rawDw as Record<string, unknown>;
  if ('easy' in dw || 'normal' in dw || 'hard' in dw) return dw;
  if ('e' in dw || 'n' in dw || 'h' in dw) {
    return { easy: dw.e, normal: dw.n, hard: dw.h };
  }
  return dw;
}

function normalizeRawHeroSave(rawH: unknown): unknown {
  if (!rawH || typeof rawH !== 'object' || Array.isArray(rawH)) return rawH;
  const obj = rawH as Record<string, unknown>;
  if ('selectedHero' in obj || 'roster' in obj) return obj;
  if (!('s' in obj) && !('r' in obj)) return obj;
  const rawR =
    obj.r && typeof obj.r === 'object' && !Array.isArray(obj.r)
      ? (obj.r as Record<string, unknown>)
      : {};
  const roster: Record<string, { xp: unknown; skills: unknown }> = {};
  for (let i = 0; i < HERO_IDS.length; i++) {
    const id = HERO_IDS[i];
    const ce = rawR[id];
    if (ce && typeof ce === 'object' && !Array.isArray(ce)) {
      const c = ce as { x?: unknown; k?: unknown };
      roster[id] = { xp: c.x ?? 0, skills: c.k ?? [] };
    }
  }
  return { selectedHero: obj.s, roster };
}

/**
 * Salvages a truncated JSON object string (e.g. partial write from power loss / quota cutoff) by
 * scanning open string/bracket state, peeling back any incomplete trailing token or key-value pair,
 * and closing open `[` / `{` scopes. Returns `null` if not a salvageable JSON object.
 */
export function tryRepairTruncatedJson(raw: string): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trimStart();
  if (trimmed.length === 0 || trimmed.length > 262_144 || trimmed[0] !== '{') return null;

  // Collect candidate cut lengths from the end back to structural boundaries (`,`, `[`, `{`, `}`, `]`, `"`, digits).
  const cuts: number[] = [trimmed.length];
  for (let pos = trimmed.length - 1; pos >= 1 && cuts.length < 96; pos--) {
    const ch = trimmed[pos];
    if (ch === ',' || ch === '{' || ch === '[' || ch === '}' || ch === ']' || ch === '"') {
      cuts.push(pos);
      if (ch === '}' || ch === ']' || ch === '"') cuts.push(pos + 1);
    }
  }

  for (let ci = 0; ci < cuts.length; ci++) {
    let end = cuts[ci];
    while (end > 1 && /\s/.test(trimmed[end - 1])) end--;
    if (end > 1 && trimmed[end - 1] === ',') {
      end--;
      while (end > 1 && /\s/.test(trimmed[end - 1])) end--;
    }
    if (end <= 0 || trimmed[end - 1] === ':') continue;

    let inStr = false;
    let esc = false;
    let validPrefix = true;
    const stack: ('{' | '[')[] = [];
    for (let i = 0; i < end; i++) {
      const c = trimmed[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') stack.push(c);
      else if (c === '}') {
        if (stack.pop() !== '{') {
          validPrefix = false;
          break;
        }
      } else if (c === ']') {
        if (stack.pop() !== '[') {
          validPrefix = false;
          break;
        }
      }
    }
    if (!validPrefix) return null;
    if (inStr) continue;

    // Reject cuts that stopped mid-key inside an object (an object key string without `: value`).
    let suffix = '';
    for (let s = stack.length - 1; s >= 0; s--) {
      suffix += stack[s] === '{' ? '}' : ']';
    }
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(0, end) + suffix);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Peel back to the next earlier structural boundary and retry.
    }
  }
  return null;
}

/**
 * Pure migration of any stored progress object (v1 or v2, possibly from a build with a different
 * island count) to the current format. Never drops earned progress: stars, unlocks and records
 * are kept, unknown junk becomes 0.
 */
export function migrateProgress(parsed: unknown, levelCount: number): ProgressData {
  const count = Number.isFinite(levelCount) ? Math.max(0, Math.floor(levelCount)) : 0;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return createDefaultProgress(count);
  }
  const raw = parsed as Record<string, unknown>;
  const bestStars = parseIslandInts(raw.bestStars, count, 3);
  const bestEndlessWaves = parseIslandInts(raw.bestEndlessWaves, count);
  const bestLives = parseIslandInts(raw.bestLives, count);
  const clears = parseIslandInts(raw.clears, count);
  const difficultyWins = sanitizeDifficultyWins(
    normalizeRawDifficultyWins(raw.difficultyWins ?? raw.dw),
    count,
  );
  if (difficultyWins) {
    for (let i = 0; i < count; i++) {
      const maxDiff = Math.max(
        difficultyWins.easy[i] ?? 0,
        difficultyWins.normal[i] ?? 0,
        difficultyWins.hard[i] ?? 0,
      );
      if (maxDiff > bestStars[i]) {
        bestStars[i] = maxDiff;
      } else if (bestStars[i] > maxDiff) {
        difficultyWins.normal[i] = bestStars[i];
      }
    }
  }
  // v1 saves (or partial saves recovered from difficultyWins) never counted clears: an island with stars was won at least once.
  for (let i = 0; i < count; i++) {
    if (bestStars[i] > 0 && clears[i] === 0) clears[i] = 1;
  }
  const storedIndex = raw.unlockedLevelIndex;
  const maxIndex = Math.max(0, count - 1);
  const unlockedLevelIndex =
    typeof storedIndex === 'number' && Number.isFinite(storedIndex)
      ? Math.max(0, Math.min(maxIndex, Math.floor(storedIndex)))
      : 0;

  // Walk forward from the stored unlock across islands the player has already cleared. Saves
  // from a build with fewer islands never recorded an unlock past their last island (there was
  // none), so islands appended later would otherwise stay locked for players who had finished
  // the campaign. Starting from the stored index keeps corrupted saves conservative.
  // A non-finite stored index (corrupted save, e.g. 1e500 -> Infinity) starts at island 0 and is not walked.
  const storedIndexOk = typeof storedIndex === 'number' && Number.isFinite(storedIndex);
  let unlocked = storedIndexOk ? unlockedLevelIndex : 0;
  while (
    storedIndexOk &&
    unlocked < bestStars.length - 1 &&
    (bestStars[unlocked] > 0 || clears[unlocked] > 0)
  ) {
    unlocked++;
  }
  const progress: ProgressData = {
    version: PROGRESS_SAVE_VERSION,
    unlockedLevelIndex: unlocked,
    bestStars,
    bestEndlessWaves,
    bestLives,
    clears,
    workshop: sanitizeRanks(raw.workshop),
    challengeClears: parseIslandIdLists(raw.challengeClears, count),
    daily: sanitizeDailyRecord(raw.daily),
  };
  const rawHeroes = normalizeRawHeroSave(raw.heroes ?? raw.h);
  if (rawHeroes && typeof rawHeroes === 'object' && !Array.isArray(rawHeroes)) {
    let clearedCount = 0;
    for (let i = 0; i < count; i++) {
      if (clears[i] > 0 || bestStars[i] > 0) clearedCount++;
    }
    progress.heroes = sanitizeHeroSaveData(rawHeroes, clearedCount, unlocked);
  }
  if (difficultyWins) progress.difficultyWins = difficultyWins;
  // Upgrades are always refundable: if a save somehow spends more stars than it has earned
  // (edited save, retuned costs), refund everything instead of keeping an impossible state.
  if (starWallet(progress).available < 0) progress.workshop = {};
  return progress;
}

function parseLooseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return tryRepairTruncatedJson(raw);
  }
}

function combineRecoveredRawObjects(
  primary: Record<string, unknown> | null,
  mirror: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!primary) return mirror;
  if (!mirror) return primary;
  const combined: Record<string, unknown> = { ...mirror, ...primary };
  for (const key of ['bestStars', 'bestEndlessWaves', 'bestLives', 'clears']) {
    const pa = primary[key];
    const ma = mirror[key];
    if (Array.isArray(pa) && Array.isArray(ma)) {
      const len = Math.max(pa.length, ma.length);
      combined[key] = Array.from({ length: len }, (_, i) => {
        const pv = typeof pa[i] === 'number' && Number.isFinite(pa[i]) ? (pa[i] as number) : 0;
        const mv = typeof ma[i] === 'number' && Number.isFinite(ma[i]) ? (ma[i] as number) : 0;
        return Math.max(pv, mv);
      });
    }
  }
  const pu = primary.unlockedLevelIndex;
  const mu = mirror.unlockedLevelIndex;
  if (typeof pu === 'number' && Number.isFinite(pu) && typeof mu === 'number' && Number.isFinite(mu)) {
    combined.unlockedLevelIndex = Math.max(pu, mu);
  }
  return combined;
}

export function loadProgress(levelCount: number): ProgressData {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return createDefaultProgress(levelCount);
    const parsed: unknown = JSON.parse(raw);
    const storedVersion =
      parsed && typeof parsed === 'object' ? (parsed as { version?: unknown }).version : undefined;
    if (typeof storedVersion !== 'number' || storedVersion < PROGRESS_SAVE_VERSION) {
      // Keep the untouched pre-migration save once, so a bad migration can always be recovered.
      try {
        if (localStorage.getItem(PROGRESS_BACKUP_KEY) === null) {
          localStorage.setItem(PROGRESS_BACKUP_KEY, raw);
        }
      } catch {
        // ignore storage errors
      }
    }
    return migrateProgress(parsed, levelCount);
  } catch {
    if (raw) {
      try {
        if (localStorage.getItem(PROGRESS_CORRUPT_BACKUP_KEY) === null) {
          localStorage.setItem(PROGRESS_CORRUPT_BACKUP_KEY, raw);
        }
      } catch {
        // ignore storage errors
      }
      const repaired = tryRepairTruncatedJson(raw);
      let mirrorObj: Record<string, unknown> | null;
      try {
        mirrorObj = parseLooseJsonObject(localStorage.getItem(LOCAL_CLOUD_PROGRESS_MIRROR_KEY));
      } catch {
        mirrorObj = null;
      }
      const candidate = combineRecoveredRawObjects(repaired, mirrorObj);
      if (candidate) {
        const recovered = migrateProgress(candidate, levelCount);
        if (hasAnyProgress(recovered)) return recovered;
      }
    }
    return createDefaultProgress(levelCount);
  }
}

/** Reads the raw `PROGRESS_KEY` string from `localStorage` without parsing (`null` if absent/unavailable). */
export function readLocalProgressRaw(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(PROGRESS_KEY);
  } catch {
    return null;
  }
}

/** Persists `progress` to `localStorage` only (without triggering fire-and-forget Steam Cloud/achievement IPC). */
export function saveLocalProgress(progress: ProgressData): string {
  progress.version = PROGRESS_SAVE_VERSION;
  const raw = JSON.stringify(progress);
  try {
    localStorage.setItem(PROGRESS_KEY, raw);
  } catch {
    // Ignore storage quota / private mode failures
  }
  return raw;
}

export function saveProgress(progress: ProgressData): void {
  const raw = saveLocalProgress(progress);
  const platform = getPlatform();
  if (platform.isSteam) {
    if (readingCloudAdapters.has(platform)) {
      // An in-flight hydrateProgressFromCloud is awaiting cloudSave.read('progress');
      // it will fold in this fresh localStorage write via diskRawAfter, merge monotonically
      // with the remote cloud save, write the union to Steam Cloud, and sync achievements.
      return;
    }
    void platform.cloudSave.write(CLOUD_PROGRESS_SLOT, raw);
    void syncAchievementsFromProgress(progress, platform);
  }
}

/** Copy of the save erased by Settings → Reset progress (kept so a reset can be undone by hand). */
export const PROGRESS_RESET_BACKUP_KEY = 'skyhold_isles_progress_reset_backup';

/** Erases campaign progress (settings untouched) after backing up the current save. */
export function resetProgressSave(levelCount: number): ProgressData {
  progressResetGen++;
  try {
    const current = loadProgress(levelCount);
    // Never let a reset of an already-empty save overwrite the backup of real progress.
    if (hasAnyProgress(current)) {
      const raw = localStorage.getItem(PROGRESS_KEY);
      let rawIsValidJson = false;
      if (raw) {
        try {
          JSON.parse(raw);
          rawIsValidJson = true;
        } catch {
          rawIsValidJson = false;
        }
      }
      localStorage.setItem(PROGRESS_RESET_BACKUP_KEY, rawIsValidJson && raw ? raw : JSON.stringify(current));
    }
  } catch {
    // ignore storage errors
  }
  try {
    localStorage.removeItem(LOCAL_CLOUD_PROGRESS_MIRROR_KEY);
  } catch {
    // ignore storage errors
  }
  const fresh = createDefaultProgress(levelCount);
  const rawFresh = saveLocalProgress(fresh);
  const platform = getPlatform();
  if (platform.isSteam) {
    void platform.cloudSave.write(CLOUD_PROGRESS_SLOT, rawFresh);
  }
  return fresh;
}

/** Copy of the save as it was before the last Settings → Save code → Load. */
export const PROGRESS_IMPORT_BACKUP_KEY = 'skyhold_isles_progress_import_backup';

export function backupProgressBeforeImport(): void {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return;
    if (localStorage.getItem(PROGRESS_IMPORT_BACKUP_KEY) !== null) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      if (!hasAnyProgress(migrateProgress(parsed, 64))) return;
    }
    localStorage.setItem(PROGRESS_IMPORT_BACKUP_KEY, raw);
  } catch {
    // ignore storage errors
  }
}

/** True when a save holds anything worth backing up. */
export function hasAnyProgress(p: ProgressData): boolean {
  return (
    p.unlockedLevelIndex > 0 ||
    p.bestStars.some((v) => v > 0) ||
    p.clears.some((v) => v > 0) ||
    p.bestEndlessWaves.some((v) => v > 0) ||
    p.challengeClears.some((l) => l.length > 0) ||
    p.daily.total > 0 ||
    Object.keys(p.workshop).length > 0 ||
    hasHeroSaveProgress(p.heroes) ||
    Boolean(
      p.difficultyWins &&
        (p.difficultyWins.easy.some((v) => v > 0) ||
          p.difficultyWins.normal.some((v) => v > 0) ||
          p.difficultyWins.hard.some((v) => v > 0)),
    )
  );
}
