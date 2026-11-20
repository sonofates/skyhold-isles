import type { GameSettings, ProgressData, QualityLevel } from '../core/types.ts';
import { isChallengeId } from '../data/challenges.ts';
import { createDailyRecord, sanitizeDailyRecord, type DailyRecord } from '../data/daily.ts';
import { mergeDifficultyWins, sanitizeDifficultyWins } from '../data/difficulty.ts';
import { HERO_IDS, hasHeroSaveProgress, mergeHeroSaveData, sanitizeHeroSaveData } from '../data/heroes.ts';
import { rankOf, sanitizeRanks, WORKSHOP_UPGRADES, workshopStarsSpent } from '../data/workshop.ts';
import { starWallet } from '../game/progression.ts';
import { syncAchievementsFromProgress } from './achievements.ts';
import { getPlatform, type PlatformAdapter } from './platform.ts';

const SETTINGS_KEY = 'skyhold_isles_settings_v1';
const PROGRESS_KEY = 'skyhold_isles_progress_v1';
export const CLOUD_PROGRESS_SLOT = 'progress';
const LOCAL_CLOUD_PROGRESS_MIRROR_KEY = `skyhold_isles_cloud_${CLOUD_PROGRESS_SLOT}`;
const readingCloudAdapters = new WeakSet<PlatformAdapter>();
const completedHydratedAdapters = new WeakSet<PlatformAdapter>();
type CloudHydratorFn = (
  progress: ProgressData,
  levelCount: number,
  adapter: PlatformAdapter,
) => Promise<unknown>;
let registeredCloudHydrator: CloudHydratorFn | null = null;
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

/** Marks `adapter` as having completed a clean remote Steam Cloud hydration for `progress`. */
export function markCloudHydrated(adapter: PlatformAdapter): void {
  completedHydratedAdapters.add(adapter);
}

/** Registers `hydrateProgressFromCloud` without creating a circular import between `storage` and `cloudSync`. */
export function registerCloudHydrator(hydrator: CloudHydratorFn): void {
  registeredCloudHydrator = hydrator;
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
    if (!raw) return enemyIntrosSeen;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = tryRepairTruncatedJsonArray(raw);
    }
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

/** Sanitizes a flat list of unique valid `ChallengeId` tokens (`undefined` when empty/absent). */
export function sanitizeWonChallenges(val: unknown): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  const out: string[] = [];
  for (const id of val) {
    if (isChallengeId(id) && !out.includes(id)) out.push(id);
  }
  return out.length > 0 ? out : undefined;
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
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(raw);
    } catch {
      rawParsed = tryRepairTruncatedJson(raw);
    }
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

function isJsonWhitespaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function repairTruncatedJsonContainer(raw: string, openChar: '{' | '['): unknown {
  if (typeof raw !== 'string') return null;
  let start = 0;
  while (start < raw.length && isJsonWhitespaceCode(raw.charCodeAt(start))) start++;
  const len = raw.length - start;
  if (len === 0 || len > 262_144 || raw[start] !== openChar) return null;
  const trimmed = start === 0 ? raw : raw.slice(start);

  const cutPositions: number[] = [];
  const cutSuffixes: string[] = [];
  const pushCut = (pos: number, suffix: string): void => {
    if (cutPositions.length > 0 && cutPositions[cutPositions.length - 1] === pos) return;
    cutPositions.push(pos);
    cutSuffixes.push(suffix);
  };

  let inStr = false;
  let esc = false;
  let hadMismatch = false;
  const stack: ('{' | '[')[] = [];
  let closingSuffix = '';

  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') {
        inStr = false;
        pushCut(i + 1, closingSuffix);
      }
      continue;
    }
    if (c === '"') {
      pushCut(i, closingSuffix);
      inStr = true;
    } else if (c === '{' || c === '[') {
      pushCut(i, closingSuffix);
      stack.push(c);
      closingSuffix = (c === '{' ? '}' : ']') + closingSuffix;
      pushCut(i + 1, closingSuffix);
    } else if (c === '}' || c === ']') {
      const expected = c === '}' ? '{' : '[';
      pushCut(i, closingSuffix);
      if (stack.length === 0 || stack[stack.length - 1] !== expected) {
        hadMismatch = true;
        inStr = true; // prevent pushing post-mismatch tail
        break;
      }
      stack.pop();
      closingSuffix = closingSuffix.slice(1);
      if (stack.length === 0) {
        try {
          return JSON.parse(trimmed.slice(0, i + 1)) as unknown;
        } catch {
          inStr = true;
          break;
        }
      }
      pushCut(i + 1, closingSuffix);
    } else if (c === ',') {
      pushCut(i, closingSuffix);
    }
  }

  if (!inStr) {
    pushCut(trimmed.length, closingSuffix);
  }

  const tryCutAt = (ci: number): unknown => {
    let end = cutPositions[ci];
    const suffix = cutSuffixes[ci];
    while (end > 1 && isJsonWhitespaceCode(trimmed.charCodeAt(end - 1))) end--;
    if (end > 1 && trimmed[end - 1] === ',') {
      end--;
      while (end > 1 && isJsonWhitespaceCode(trimmed.charCodeAt(end - 1))) end--;
    }
    if (end <= 0 || trimmed[end - 1] === ':') return undefined;
    if (hadMismatch && end <= 1) return undefined;
    try {
      return JSON.parse(trimmed.slice(0, end) + suffix) as unknown;
    } catch {
      return undefined;
    }
  };

  const totalCuts = cutPositions.length;
  const exactTail = totalCuts <= 1024 ? totalCuts : 256;
  const minExact = Math.max(0, totalCuts - exactTail);
  for (let ci = totalCuts - 1; ci >= minExact; ci--) {
    const res = tryCutAt(ci);
    if (res !== undefined) return res;
  }
  if (minExact > 0) {
    const stride = Math.max(1, Math.ceil(minExact / 512));
    for (let base = minExact - 1; base >= 0; base -= stride) {
      for (let off = 0; off < 3 && base - off >= 0; off++) {
        const res = tryCutAt(base - off);
        if (res !== undefined) return res;
      }
    }
  }
  return null;
}

/**
 * Salvages a truncated JSON object string (e.g. partial write from power loss / quota cutoff) by
 * scanning open string/bracket state, peeling back any incomplete trailing token or key-value pair,
 * and closing open `[` / `{` scopes. Returns `null` if not a salvageable JSON object.
 */
export function tryRepairTruncatedJson(raw: string): Record<string, unknown> | null {
  const parsed = repairTruncatedJsonContainer(raw, '{');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

/**
 * Salvages a truncated JSON array string (e.g. `STORY_SEEN_KEY`, `ENEMY_INTROS_SEEN_KEY`, or legacy
 * `IAP_SAVE_KEY` arrays) by peeling back any incomplete trailing element and closing open brackets.
 */
export function tryRepairTruncatedJsonArray(raw: string): unknown[] | null {
  const parsed = repairTruncatedJsonContainer(raw, '[');
  return Array.isArray(parsed) ? parsed : null;
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
  const wonChallenges = sanitizeWonChallenges(raw.wonChallenges ?? raw.wc);
  if (wonChallenges) progress.wonChallenges = wonChallenges;
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

function mergeRecoveredDaily(a: DailyRecord, b: DailyRecord): DailyRecord {
  const [early, late] =
    a.lastDay < b.lastDay || (a.lastDay === b.lastDay && a.streak <= b.streak) ? [a, b] : [b, a];
  const lateStart = late.lastDay - Math.max(0, late.streak) + 1;
  const earlyStart = early.lastDay - Math.max(0, early.streak) + 1;
  const chains = early.streak > 0 && late.streak > 0 && lateStart <= early.lastDay + 1;
  const streak = chains ? late.lastDay - Math.min(lateStart, earlyStart) + 1 : late.streak;
  return {
    lastDay: late.lastDay,
    streak,
    bestStreak: Math.max(a.bestStreak, b.bestStreak, streak),
    total: Math.max(a.total, b.total),
  };
}

function combineRecoveredProgress(
  primary: Record<string, unknown> | null,
  mirror: Record<string, unknown> | null,
  levelCount: number,
): ProgressData | null {
  if (!primary && !mirror) return null;
  if (!primary) return migrateProgress(mirror, levelCount);
  if (!mirror) return migrateProgress(primary, levelCount);

  const count = Number.isFinite(levelCount) ? Math.max(0, Math.floor(levelCount)) : 0;
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
    } else if (Array.isArray(pa)) {
      combined[key] = pa;
    } else if (Array.isArray(ma)) {
      combined[key] = ma;
    }
  }

  const pcc = primary.challengeClears;
  const mcc = mirror.challengeClears;
  if (Array.isArray(pcc) || Array.isArray(mcc)) {
    const len = Math.max(Array.isArray(pcc) ? pcc.length : 0, Array.isArray(mcc) ? mcc.length : 0);
    combined.challengeClears = Array.from({ length: len }, (_, i) => {
      const la = Array.isArray(mcc) && Array.isArray(mcc[i]) ? (mcc[i] as unknown[]) : [];
      const lb = Array.isArray(pcc) && Array.isArray(pcc[i]) ? (pcc[i] as unknown[]) : [];
      const out: string[] = [];
      for (const id of [...la, ...lb]) {
        if (typeof id === 'string' && id.length > 0 && id.length <= 40 && !out.includes(id)) {
          out.push(id);
        }
      }
      return out;
    });
  }

  const pu = primary.unlockedLevelIndex;
  const mu = mirror.unlockedLevelIndex;
  const pFin = typeof pu === 'number' && Number.isFinite(pu);
  const mFin = typeof mu === 'number' && Number.isFinite(mu);
  if (pFin && mFin) combined.unlockedLevelIndex = Math.max(pu, mu);
  else if (pFin) combined.unlockedLevelIndex = pu;
  else if (mFin) combined.unlockedLevelIndex = mu;
  else delete combined.unlockedLevelIndex;

  if (primary.daily !== undefined || mirror.daily !== undefined) {
    combined.daily = mergeRecoveredDaily(
      sanitizeDailyRecord(mirror.daily),
      sanitizeDailyRecord(primary.daily),
    );
  }

  const pdw = sanitizeDifficultyWins(
    normalizeRawDifficultyWins(primary.difficultyWins ?? primary.dw),
    count,
  );
  const mdw = sanitizeDifficultyWins(
    normalizeRawDifficultyWins(mirror.difficultyWins ?? mirror.dw),
    count,
  );
  if (pdw && mdw) combined.difficultyWins = mergeDifficultyWins(mdw, pdw, count);
  else if (pdw || mdw) combined.difficultyWins = pdw ?? mdw;
  delete combined.dw;

  const rawPh = normalizeRawHeroSave(primary.heroes ?? primary.h);
  const rawMh = normalizeRawHeroSave(mirror.heroes ?? mirror.h);
  const ph =
    rawPh && typeof rawPh === 'object' && !Array.isArray(rawPh)
      ? sanitizeHeroSaveData(rawPh, count, count)
      : undefined;
  const mh =
    rawMh && typeof rawMh === 'object' && !Array.isArray(rawMh)
      ? sanitizeHeroSaveData(rawMh, count, count)
      : undefined;
  const mergedHeroes = mergeHeroSaveData(mh, ph, count, count);
  if (mergedHeroes) combined.heroes = mergedHeroes;
  else delete combined.heroes;
  delete combined.h;

  const workshopP = sanitizeRanks(primary.workshop);
  const workshopM = sanitizeRanks(mirror.workshop);
  const unionWorkshop: Record<string, number> = {};
  for (const def of WORKSHOP_UPGRADES) {
    const r = Math.max(rankOf(workshopP, def.id), rankOf(workshopM, def.id));
    if (r > 0) unionWorkshop[def.id] = r;
  }
  combined.workshop = unionWorkshop;

  const pwc = primary.wonChallenges ?? primary.wc;
  const mwc = mirror.wonChallenges ?? mirror.wc;
  if (Array.isArray(pwc) || Array.isArray(mwc)) {
    combined.wonChallenges = [
      ...(Array.isArray(mwc) ? mwc : []),
      ...(Array.isArray(pwc) ? pwc : []),
    ];
  }
  delete combined.wc;

  const recovered = migrateProgress(combined, count);
  const unionSpent = workshopStarsSpent(unionWorkshop);
  if (unionSpent > 0 && Object.keys(recovered.workshop).length === 0) {
    // Union overspent the recovered wallet: greedily keep the higher-spent affordable side + top-ups.
    const spentP = workshopStarsSpent(workshopP);
    const spentM = workshopStarsSpent(workshopM);
    const [firstW, secondW] =
      spentM > spentP || (spentM === spentP && JSON.stringify(workshopM) > JSON.stringify(workshopP))
        ? [workshopM, workshopP]
        : [workshopP, workshopM];
    const earned = starWallet(recovered).earned;
    const base = workshopStarsSpent(firstW) <= earned ? firstW : workshopStarsSpent(secondW) <= earned ? secondW : {};
    const topped: Record<string, number> = { ...base };
    let remaining = earned - workshopStarsSpent(topped);
    const other = base === firstW ? secondW : firstW;
    for (const def of WORKSHOP_UPGRADES) {
      let cur = rankOf(topped, def.id);
      const want = rankOf(other, def.id);
      while (cur < want) {
        const stepCost = def.costs[cur];
        if (stepCost === undefined || stepCost > remaining) break;
        cur++;
        topped[def.id] = cur;
        remaining -= stepCost;
      }
    }
    recovered.workshop = sanitizeRanks(topped);
  }
  return recovered;
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
      const recovered = combineRecoveredProgress(repaired, mirrorObj, levelCount);
      if (recovered && hasAnyProgress(recovered)) return recovered;
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

/** Reads the local `skyhold_isles_cloud_progress` mirror string without parsing (`null` if absent). */
export function readLocalCloudProgressMirrorRaw(): string | null {
  try {
    return typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(LOCAL_CLOUD_PROGRESS_MIRROR_KEY);
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
    if (!completedHydratedAdapters.has(platform) && registeredCloudHydrator) {
      // Never overwrite an un-fetched remote Steam Cloud save with a first local write on a new PC.
      void registeredCloudHydrator(progress, progress.bestStars.length, platform);
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
  enemyIntrosSeen = null;
  try {
    localStorage.removeItem(LOCAL_CLOUD_PROGRESS_MIRROR_KEY);
    localStorage.removeItem(ENEMY_INTROS_SEEN_KEY);
    localStorage.removeItem(FLYER_TOAST_SEEN_KEY);
    localStorage.removeItem(UPGRADE_TOAST_SEEN_KEY);
  } catch {
    // ignore storage errors
  }
  const fresh = createDefaultProgress(levelCount);
  const rawFresh = saveLocalProgress(fresh);
  const platform = getPlatform();
  if (platform.isSteam) {
    completedHydratedAdapters.add(platform);
    void platform.cloudSave.write(CLOUD_PROGRESS_SLOT, rawFresh);
  }
  return fresh;
}

/** Copy of the save as it was before the last Settings → Save code → Load. */
export const PROGRESS_IMPORT_BACKUP_KEY = 'skyhold_isles_progress_import_backup';

export function backupProgressBeforeImport(): void {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    let parsed: Record<string, unknown> | null = null;
    let validJson = false;
    if (raw) {
      try {
        const direct: unknown = JSON.parse(raw);
        if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
          parsed = direct as Record<string, unknown>;
          validJson = true;
        }
      } catch {
        parsed = tryRepairTruncatedJson(raw);
      }
    }
    if (validJson && raw && parsed) {
      if (localStorage.getItem(PROGRESS_IMPORT_BACKUP_KEY) !== null) {
        if (!hasAnyProgress(migrateProgress(parsed, 64))) return;
      }
      localStorage.setItem(PROGRESS_IMPORT_BACKUP_KEY, raw);
      return;
    }
    const mirrorObj = parseLooseJsonObject(localStorage.getItem(LOCAL_CLOUD_PROGRESS_MIRROR_KEY));
    const recovered = combineRecoveredProgress(parsed, mirrorObj, 64);
    if (!recovered) return;
    if (localStorage.getItem(PROGRESS_IMPORT_BACKUP_KEY) !== null && !hasAnyProgress(recovered)) {
      return;
    }
    if (hasAnyProgress(recovered) || parsed !== null) {
      localStorage.setItem(PROGRESS_IMPORT_BACKUP_KEY, JSON.stringify(recovered));
    }
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
    (p.wonChallenges?.length ?? 0) > 0 ||
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
