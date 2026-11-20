import { hasMarketActivity, mergeMarket, sanitizeMarket } from '../game/market.ts';
import type { HeroId, HeroSaveData, ProgressData } from '../core/types.ts';
import { isChallengeId } from '../data/challenges.ts';
import { sanitizeDailyRecord, type DailyRecord } from '../data/daily.ts';
import {
  mergeDifficultyWins,
  sanitizeDifficultyWins,
  type DifficultyWins,
} from '../data/difficulty.ts';
import {
  countHeroSkillPointsSpent,
  HERO_IDS,
  isHeroId,
  mergeHeroSaveData,
  sanitizeHeroSaveData,
  totalHeroSaveXp,
} from '../data/heroes.ts';
import { rankOf, sanitizeRanks, WORKSHOP_UPGRADES, workshopStarsSpent } from '../data/workshop.ts';
import { starWallet } from '../game/progression.ts';
import {
  CLOUD_PROGRESS_SLOT,
  createDefaultProgress,
  hasAnyProgress,
  migrateProgress,
  normalizeRawDifficultyWins,
  normalizeRawHeroSave,
  PROGRESS_BACKUP_KEY,
  PROGRESS_CORRUPT_BACKUP_KEY,
  PROGRESS_IMPORT_BACKUP_KEY,
  PROGRESS_RESET_BACKUP_KEY,
  PROGRESS_SAVE_VERSION,
  readLocalProgressRaw,
  sanitizeWonChallenges,
  saveProgress,
  tryRepairTruncatedJson,
} from './storage.ts';

/**
 * Save codes: the campaign save as a copy-paste string, to move progress between devices or keep a
 * backup outside the browser. Format `SKY2-<base64url JSON>-<checksum>`; the checksum catches typos
 * and truncated pastes. Loading a code MERGES it into the current save (best of both per record),
 * so a load can never lose progress. Settings are device-specific and not part of the code.
 */
const PREFIX = 'SKY2-';
const MAX_SAVE_CODE_ISLANDS = 512;
const MAX_SAVE_CODE_CHARS = 262_144;

/** FNV-1a 32-bit, as 7 base36 chars. */
function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

/** UTF-8 safe (btoa alone throws on characters above U+00FF). */
function toBase64Url(text: string): string {
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  const std = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Trailing zeros carry no information: trim them to keep codes short. */
function trimZeros(list: readonly number[] | undefined, max = Number.MAX_SAFE_INTEGER): number[] {
  if (!Array.isArray(list)) return [];
  const safe = list.map((v) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0,
  );
  let end = safe.length;
  while (end > 0 && !safe[end - 1]) end--;
  return safe.slice(0, end);
}

function trimLists(list: readonly string[][] | undefined): string[][] {
  if (!Array.isArray(list)) return [];
  const safe = list.map((l) =>
    Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 40) : [],
  );
  let end = safe.length;
  while (end > 0 && safe[end - 1].length === 0) end--;
  return safe.slice(0, end);
}

interface CompactHeroPayload {
  readonly s: HeroId;
  readonly r?: Partial<Record<HeroId, { readonly x: number; readonly k?: readonly string[] }>>;
}

function encodeHeroPayload(heroes: unknown): CompactHeroPayload {
  const clean = sanitizeHeroSaveData(normalizeRawHeroSave(heroes));
  const r: Partial<Record<HeroId, { readonly x: number; readonly k?: readonly string[] }>> = {};
  let hasAny = false;
  for (let i = 0; i < HERO_IDS.length; i++) {
    const id = HERO_IDS[i];
    const e = clean.roster[id];
    if (!e || (e.xp === 0 && e.skills.length === 0)) continue;
    r[id] = e.skills.length > 0 ? { x: e.xp, k: [...e.skills] } : { x: e.xp };
    hasAny = true;
  }
  return hasAny ? { s: clean.selectedHero, r } : { s: clean.selectedHero };
}

function decodeHeroPayload(raw: unknown): HeroSaveData | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return sanitizeHeroSaveData(normalizeRawHeroSave(raw));
}

export function encodeSaveCode(progress: ProgressData, levelIds?: readonly string[]): string {
  const rawProgress = progress as unknown as Record<string, unknown>;
  const safeVer =
    typeof progress.version === 'number' && Number.isFinite(progress.version) && progress.version > 0
      ? Math.floor(progress.version)
      : PROGRESS_SAVE_VERSION;
  const safeUnlock =
    typeof progress.unlockedLevelIndex === 'number' && Number.isFinite(progress.unlockedLevelIndex)
      ? Math.max(0, Math.floor(progress.unlockedLevelIndex))
      : 0;
  const safeStars = trimZeros(progress.bestStars, 3);
  const payload: Record<string, unknown> = {
    v: safeVer,
    ...(hasMarketActivity(progress.market) ? { m: sanitizeMarket(progress.market) } : {}),
    u: safeUnlock,
    s: safeStars,
    e: trimZeros(progress.bestEndlessWaves),
    l: trimZeros(progress.bestLives),
    c: trimZeros(progress.clears),
    w: sanitizeRanks(progress.workshop),
    b: trimLists(progress.challengeClears),
    d: sanitizeDailyRecord(progress.daily),
  };
  const rawHeroes = progress.heroes ?? rawProgress.h;
  if (rawHeroes !== undefined) {
    payload.h = encodeHeroPayload(rawHeroes);
  }
  const safeWonChallenges = sanitizeWonChallenges(progress.wonChallenges ?? rawProgress.wc);
  if (safeWonChallenges) {
    payload.wc = safeWonChallenges;
  }
  const rawDifficultyWins = progress.difficultyWins ?? rawProgress.dw;
  if (rawDifficultyWins !== undefined) {
    const rawDw = normalizeRawDifficultyWins(rawDifficultyWins) as Record<string, unknown> | null;
    const dwCount = Math.max(
      Array.isArray(progress.bestStars) ? progress.bestStars.length : 0,
      Array.isArray(rawDw?.easy) ? rawDw.easy.length : 0,
      Array.isArray(rawDw?.normal) ? rawDw.normal.length : 0,
      Array.isArray(rawDw?.hard) ? rawDw.hard.length : 0,
      levelIds?.length ?? 0,
    );
    const dw = sanitizeDifficultyWins(rawDw, dwCount);
    if (dw) {
      for (let i = 0; i < dwCount; i++) {
        const bs = safeStars[i] ?? 0;
        const maxDiff = Math.max(dw.easy[i] ?? 0, dw.normal[i] ?? 0, dw.hard[i] ?? 0);
        if (bs > maxDiff) dw.normal[i] = bs;
        else if (maxDiff > bs) safeStars[i] = maxDiff;
      }
      payload.s = trimZeros(safeStars, 3);
      payload.dw = { e: trimZeros(dw.easy, 1), n: trimZeros(dw.normal, 3), h: trimZeros(dw.hard, 3) };
    }
  }
  if (levelIds && levelIds.length > 0) {
    payload.i = levelIds.slice(0, MAX_SAVE_CODE_ISLANDS).map((id) => (typeof id === 'string' ? id : ''));
  }
  const body = toBase64Url(JSON.stringify(payload));
  return `${PREFIX}${body}-${checksum(body)}`;
}

export type SaveCodeResult =
  | { readonly ok: true; readonly progress: ProgressData; readonly levelIds?: readonly string[] }
  | { readonly ok: false; readonly error: string };

function parseVerifiedSaveCodeBody(code: unknown):
  | { readonly ok: true; readonly raw: Record<string, unknown> }
  | { readonly ok: false; readonly error: string } {
  if (typeof code !== 'string') return { ok: false, error: 'That is not a Skyhold save code.' };
  if (code.length > MAX_SAVE_CODE_CHARS) {
    return { ok: false, error: 'The code is too long to be a Skyhold save code.' };
  }
  const clean = code.replace(/\s+/g, '');
  if (!clean.startsWith(PREFIX)) return { ok: false, error: 'That is not a Skyhold save code.' };
  const rest = clean.slice(PREFIX.length);
  const dash = rest.lastIndexOf('-');
  if (dash <= 0) return { ok: false, error: 'The code looks cut off — copy all of it.' };
  const body = rest.slice(0, dash);
  if (checksum(body) !== rest.slice(dash + 1)) {
    return { ok: false, error: 'The code is damaged — copy all of it again.' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(body));
  } catch {
    return { ok: false, error: 'The code could not be read.' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'The code could not be read.' };
  }
  return { ok: true, raw: raw as Record<string, unknown> };
}

/**
 * Reads pre-remap / pre-wallet-refund Workshop ranks and `selectedHero` from a verified `SKY2-...`
 * save code so cross-device 2D imports can evaluate affordability and unlock milestones against the
 * combined (`local + imported`) island stars and clears.
 */
export function inspectSaveCodeHints(code: string): {
  readonly rawWorkshop?: Record<string, number>;
  readonly rawSelectedHero?: HeroId;
} {
  const verified = parseVerifiedSaveCodeBody(code);
  if (!verified.ok) return {};
  const r = verified.raw;
  const rawWorkshop = sanitizeRanks(r.w);
  let rawSelectedHero: HeroId | undefined;
  if (r.h && typeof r.h === 'object' && !Array.isArray(r.h)) {
    const hObj = r.h as Record<string, unknown>;
    const cand = hObj.selectedHero ?? hObj.s;
    if (isHeroId(cand)) rawSelectedHero = cand;
  }
  return {
    ...(Object.keys(rawWorkshop).length > 0 ? { rawWorkshop } : {}),
    ...(rawSelectedHero !== undefined ? { rawSelectedHero } : {}),
  };
}

export function decodeSaveCode(code: string, levelCount: number): SaveCodeResult {
  const verified = parseVerifiedSaveCodeBody(code);
  if (!verified.ok) return verified;
  const r = verified.raw;
  const decodedHeroes = r.h !== undefined ? decodeHeroPayload(r.h) : undefined;
  const levelIds = Array.isArray(r.i)
    ? r.i.slice(0, MAX_SAVE_CODE_ISLANDS).map((x) => (typeof x === 'string' && x.length <= 64 ? x : ''))
    : undefined;
  const hasValidIds = levelIds !== undefined && levelIds.some((id) => id.length > 0);
  const rawDw = r.dw && typeof r.dw === 'object' && !Array.isArray(r.dw) ? (r.dw as Record<string, unknown>) : null;
  const progress = migrateProgress(
    {
      version: r.v,
      market: r.m,
      unlockedLevelIndex: r.u,
      bestStars: r.s,
      bestEndlessWaves: r.e,
      bestLives: r.l,
      clears: r.c,
      workshop: r.w,
      challengeClears: r.b,
      daily: r.d,
      ...(decodedHeroes !== undefined ? { heroes: decodedHeroes } : {}),
      ...(r.wc !== undefined || r.wonChallenges !== undefined
        ? { wonChallenges: r.wc ?? r.wonChallenges }
        : {}),
      ...(rawDw
        ? {
            difficultyWins: {
              easy: rawDw.e ?? rawDw.easy,
              normal: rawDw.n ?? rawDw.normal,
              hard: rawDw.h ?? rawDw.hard,
            },
          }
        : {}),
    },
    levelCount,
  );
  // Only real challenge ids travel between saves (a hand-made code could carry anything).
  progress.challengeClears = progress.challengeClears.map((list) => list.filter((id) => isChallengeId(id)));
  if (starWallet(progress).available < 0) progress.workshop = {};
  return hasValidIds ? { ok: true, progress, levelIds } : { ok: true, progress };
}

/**
 * Daily records from two devices. The current streak chains when one save's run of wins starts no
 * later than the day after the other's last win (wins on both devices count as one run of days).
 * The total is the larger of the two, not the sum: without per-day history a sum would count the
 * same wins twice when a code is loaded again (merging must stay idempotent).
 */
export function mergeDaily(a: DailyRecord, b: DailyRecord): DailyRecord {
  const ca = sanitizeDailyRecord(a);
  const cb = sanitizeDailyRecord(b);
  const [early, late] =
    ca.lastDay < cb.lastDay || (ca.lastDay === cb.lastDay && ca.streak <= cb.streak)
      ? [ca, cb]
      : [cb, ca];
  const lateStart = late.lastDay - Math.max(0, late.streak) + 1;
  const earlyStart = early.lastDay - Math.max(0, early.streak) + 1;
  const chains = early.streak > 0 && late.streak > 0 && lateStart <= early.lastDay + 1;
  const streak = chains ? late.lastDay - Math.min(lateStart, earlyStart) + 1 : late.streak;
  return {
    lastDay: late.lastDay,
    streak,
    bestStreak: Math.max(ca.bestStreak, cb.bestStreak, streak),
    total: Math.max(ca.total, cb.total),
  };
}

/**
 * Derives per-difficulty star records sized to `count` islands without truncating `difficultyWins`
 * when `progress.bestStars` is shorter than `count` (e.g. partial / un-migrated saves).
 */
export function sizedDifficultyWins(progress: ProgressData, count: number): DifficultyWins {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const bestStars = Array.isArray(progress.bestStars) ? progress.bestStars : [];
  const clampStar = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(3, Math.floor(v))) : 0;
  const rawDw = progress.difficultyWins ?? (progress as unknown as { readonly dw?: unknown }).dw;
  const dw = sanitizeDifficultyWins(normalizeRawDifficultyWins(rawDw), safeCount);
  if (!dw) {
    return {
      easy: new Array<number>(safeCount).fill(0),
      normal: Array.from({ length: safeCount }, (_, i) => clampStar(bestStars[i])),
      hard: new Array<number>(safeCount).fill(0),
    };
  }
  for (let i = 0; i < safeCount; i++) {
    const bs = clampStar(bestStars[i]);
    const maxDiff = Math.max(dw.easy[i] ?? 0, dw.normal[i] ?? 0, dw.hard[i] ?? 0);
    if (bs > maxDiff) dw.normal[i] = bs;
  }
  return dw;
}

/**
 * Best of both saves, record by record: a merge never lowers anything. Workshop ranks come from
 * whichever save had spent more (refunded if the merged wallet somehow cannot pay for them).
 */
export function mergeProgress(a: ProgressData, b: ProgressData, levelCount: number): ProgressData {
  const count = Number.isFinite(levelCount) ? Math.max(0, Math.floor(levelCount)) : 0;
  const rawA = a as unknown as Record<string, unknown>;
  const rawB = b as unknown as Record<string, unknown>;
  const safeInt = (v: unknown, max = Number.MAX_SAFE_INTEGER): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;
  const maxList = (
    x: readonly number[] | undefined,
    y: readonly number[] | undefined,
    max = Number.MAX_SAFE_INTEGER,
  ): number[] =>
    Array.from({ length: count }, (_, i) => Math.max(safeInt(x?.[i], max), safeInt(y?.[i], max)));
  const daily = mergeDaily(a.daily, b.daily);
  const workshopA = sanitizeRanks(a.workshop);
  const workshopB = sanitizeRanks(b.workshop);
  const unionWorkshop: Record<string, number> = {};
  for (const def of WORKSHOP_UPGRADES) {
    const r = Math.max(rankOf(workshopA, def.id), rankOf(workshopB, def.id));
    if (r > 0) unionWorkshop[def.id] = r;
  }
  const spentA = workshopStarsSpent(workshopA);
  const spentB = workshopStarsSpent(workshopB);
  const [primaryWorkshop, secondaryWorkshop] =
    spentB > spentA || (spentB === spentA && JSON.stringify(workshopB) > JSON.stringify(workshopA))
      ? [workshopB, workshopA]
      : [workshopA, workshopB];
  const maxIdx = Math.max(0, count - 1);
  const hasDiffA = (a.difficultyWins ?? rawA.dw) !== undefined;
  const hasDiffB = (b.difficultyWins ?? rawB.dw) !== undefined;
  const mergedDifficultyWins =
    hasDiffA || hasDiffB
      ? mergeDifficultyWins(sizedDifficultyWins(a, count), sizedDifficultyWins(b, count), count)
      : undefined;
  const bestStars = maxList(a.bestStars, b.bestStars, 3);
  if (mergedDifficultyWins) {
    for (let i = 0; i < count; i++) {
      const maxDiff = Math.max(
        mergedDifficultyWins.easy[i] ?? 0,
        mergedDifficultyWins.normal[i] ?? 0,
        mergedDifficultyWins.hard[i] ?? 0,
      );
      if (maxDiff > bestStars[i]) {
        bestStars[i] = maxDiff;
      } else if (bestStars[i] > maxDiff) {
        mergedDifficultyWins.normal[i] = bestStars[i];
      }
    }
  }
  const clears = maxList(a.clears, b.clears);
  for (let i = 0; i < count; i++) {
    if (bestStars[i] > 0 && clears[i] === 0) clears[i] = 1;
  }
  const rawMaxUnlock = Math.max(
    0,
    Number.isFinite(a.unlockedLevelIndex) ? Math.floor(a.unlockedLevelIndex) : 0,
    Number.isFinite(b.unlockedLevelIndex) ? Math.floor(b.unlockedLevelIndex) : 0,
  );
  let unlockedLevelIndex = Math.min(maxIdx, rawMaxUnlock);
  while (
    unlockedLevelIndex < maxIdx &&
    (bestStars[unlockedLevelIndex] > 0 || clears[unlockedLevelIndex] > 0)
  ) {
    unlockedLevelIndex++;
  }
  let clearedCount = 0;
  for (let i = 0; i < count; i++) {
    if (clears[i] > 0 || bestStars[i] > 0) clearedCount++;
  }
  const rawHeroesA = a.heroes ?? rawA.h;
  const rawHeroesB = b.heroes ?? rawB.h;
  const mergedHeroes = mergeHeroSaveData(
    rawHeroesA !== undefined ? (normalizeRawHeroSave(rawHeroesA) as HeroSaveData) : undefined,
    rawHeroesB !== undefined ? (normalizeRawHeroSave(rawHeroesB) as HeroSaveData) : undefined,
    clearedCount,
    unlockedLevelIndex,
  );
  const wcA = sanitizeWonChallenges(a.wonChallenges ?? rawA.wc) ?? [];
  const wcB = sanitizeWonChallenges(b.wonChallenges ?? rawB.wc) ?? [];
  const mergedWonChallenges =
    wcA.length > 0 || wcB.length > 0
      ? wcA.length === wcB.length && wcA.every((id, idx) => wcB[idx] === id)
        ? wcA
        : [...new Set([...wcA, ...wcB])].sort()
      : undefined;
  const verA = safeInt(a.version) || PROGRESS_SAVE_VERSION;
  const verB = safeInt(b.version) || PROGRESS_SAVE_VERSION;
  const merged: ProgressData = {
    version: Math.max(PROGRESS_SAVE_VERSION, verA, verB),
    market: mergeMarket(a.market, b.market),
    unlockedLevelIndex,
    bestStars,
    bestEndlessWaves: maxList(a.bestEndlessWaves, b.bestEndlessWaves),
    bestLives: maxList(a.bestLives, b.bestLives),
    clears,
    workshop: unionWorkshop,
    challengeClears: Array.from({ length: count }, (_, i) => {
      const cleanList = (src: unknown): string[] => {
        if (!Array.isArray(src)) return [];
        const list: string[] = [];
        for (const id of src) {
          if (typeof id === 'string' && id.length > 0 && id.length <= 40 && !list.includes(id)) {
            list.push(id);
          }
        }
        return list;
      };
      const la = cleanList(a.challengeClears?.[i]);
      const lb = cleanList(b.challengeClears?.[i]);
      if (la.length === lb.length && la.every((id, idx) => lb[idx] === id)) return la;
      if (lb.length < la.length && lb.every((id) => la.includes(id))) return la;
      if (la.length < lb.length && la.every((id) => lb.includes(id))) return lb;
      return [...new Set([...la, ...lb])].sort();
    }),
    daily,
    ...(mergedHeroes !== undefined ? { heroes: mergedHeroes } : {}),
    // Either side recorded difficulty: keep the best of both (a legacy side's wins read as Normal).
    ...(mergedDifficultyWins !== undefined ? { difficultyWins: mergedDifficultyWins } : {}),
    ...(mergedWonChallenges !== undefined ? { wonChallenges: mergedWonChallenges } : {}),
  };
  if (starWallet(merged).available < 0) {
    const totalEarned = starWallet(merged).earned;
    if (spentA <= totalEarned && spentB <= totalEarned) {
      // Both sides were genuinely affordable saves whose combined upgrades exceeded totalEarned:
      // keep all of primaryWorkshop and greedily top up affordable ranks from secondaryWorkshop.
      const topped: Record<string, number> = { ...primaryWorkshop };
      let remaining = totalEarned - workshopStarsSpent(topped);
      for (const def of WORKSHOP_UPGRADES) {
        let cur = rankOf(topped, def.id);
        const want = rankOf(secondaryWorkshop, def.id);
        while (cur < want) {
          const stepCost = def.costs[cur];
          if (stepCost === undefined || stepCost > remaining) break;
          cur++;
          topped[def.id] = cur;
          remaining -= stepCost;
        }
      }
      merged.workshop = sanitizeRanks(topped);
    } else {
      merged.workshop = primaryWorkshop;
      if (starWallet(merged).available < 0) {
        merged.workshop = secondaryWorkshop;
        if (starWallet(merged).available < 0) merged.workshop = {};
      }
    }
  }
  return merged;
}

function maxRawIslandCount(raw: Record<string, unknown>): number {
  let maxLen = 0;
  for (const key of ['bestStars', 'bestEndlessWaves', 'bestLives', 'clears', 'challengeClears']) {
    const arr = raw[key];
    if (Array.isArray(arr) && arr.length > maxLen) maxLen = arr.length;
  }
  const dw = raw.difficultyWins ?? raw.dw;
  if (dw && typeof dw === 'object' && !Array.isArray(dw)) {
    const dwo = dw as Record<string, unknown>;
    for (const key of ['easy', 'normal', 'hard', 'e', 'n', 'h']) {
      const arr = dwo[key];
      if (Array.isArray(arr) && arr.length > maxLen) maxLen = arr.length;
    }
  }
  return Math.min(MAX_SAVE_CODE_ISLANDS, maxLen);
}

/**
 * Migrates `parsed` onto `count` islands while preserving source-valid `workshop` and
 * `selectedHero` candidates from a larger island roster so `mergeProgress` can evaluate
 * star affordability and unlock milestones against the combined (`local + incoming`) save.
 */
export function migrateProgressForMerge(
  parsed: Record<string, unknown>,
  count: number,
): ProgressData {
  const migrated = migrateProgress(parsed, count);
  const fullCount = Math.max(1, count, maxRawIslandCount(parsed));
  if (fullCount > count) {
    const fullMigrated = migrateProgress(parsed, fullCount);
    if (workshopStarsSpent(fullMigrated.workshop) > workshopStarsSpent(migrated.workshop)) {
      migrated.workshop = fullMigrated.workshop;
    }
    if (
      migrated.heroes &&
      fullMigrated.heroes &&
      fullMigrated.heroes.selectedHero !== migrated.heroes.selectedHero
    ) {
      migrated.heroes = { ...migrated.heroes, selectedHero: fullMigrated.heroes.selectedHero };
    }
  }
  return migrated;
}

export interface RecoverProgressResult {
  readonly progress: ProgressData;
  readonly recovered: boolean;
  readonly sources: readonly string[];
}

/**
 * Multi-source recovery for 3D campaign saves: inspects the primary slot (direct or truncated-JSON
 * repaired), mirrored cloud slot (`skyhold_isles_cloud_progress`), import backup, pre-migration
 * backup, and optionally the reset backup, merging every valid source monotonically.
 */
export function recoverProgressSave(
  levelCount: number,
  options?: { readonly includeResetBackup?: boolean; readonly persist?: boolean },
): RecoverProgressResult {
  const count = Number.isFinite(levelCount) ? Math.max(0, Math.floor(levelCount)) : 0;
  let merged = createDefaultProgress(count);
  const sources: string[] = [];

  const readKey = (key: string): string | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const candidates: readonly (readonly [string, string | null])[] = [
    ['primary', readLocalProgressRaw()],
    ['cloud', readKey(`skyhold_isles_cloud_${CLOUD_PROGRESS_SLOT}`)],
    ['importBackup', readKey(PROGRESS_IMPORT_BACKUP_KEY)],
    ['corruptBackup', readKey(PROGRESS_CORRUPT_BACKUP_KEY)],
    ['migrationBackup', readKey(PROGRESS_BACKUP_KEY)],
    ...(options?.includeResetBackup ? ([['resetBackup', readKey(PROGRESS_RESET_BACKUP_KEY)]] as const) : []),
  ];

  for (let i = 0; i < candidates.length; i++) {
    const [label, raw] = candidates[i];
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = tryRepairTruncatedJson(raw);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const rawObj = parsed as Record<string, unknown>;
    const strictMigrated = migrateProgress(rawObj, count);
    const mergeCandidate = migrateProgressForMerge(rawObj, count);
    if (!hasAnyProgress(strictMigrated) && Object.keys(mergeCandidate.workshop).length === 0) continue;
    merged = mergeProgress(merged, mergeCandidate, count);
    sources.push(label);
  }

  const recovered = sources.length > 0 && hasAnyProgress(merged);
  if (recovered && options?.persist !== false) {
    saveProgress(merged);
  }
  return { progress: merged, recovered, sources };
}

/** What a merge would add, for the confirmation line ("+5★, 2 islands, …"). */
export function describeMergeGain(before: ProgressData, after: ProgressData): string {
  const rawBefore = before as unknown as Record<string, unknown>;
  const rawAfter = after as unknown as Record<string, unknown>;
  const safeInt = (v: unknown, max = Number.MAX_SAFE_INTEGER): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;
  const rawDwLen = (p: ProgressData, rawObj: Record<string, unknown>): number => {
    const dw = normalizeRawDifficultyWins(p.difficultyWins ?? rawObj.dw) as
      | Record<string, unknown>
      | undefined;
    if (!dw || typeof dw !== 'object' || Array.isArray(dw)) return 0;
    return Math.max(
      Array.isArray(dw.easy) ? dw.easy.length : 0,
      Array.isArray(dw.normal) ? dw.normal.length : 0,
      Array.isArray(dw.hard) ? dw.hard.length : 0,
    );
  };
  const starLen = Math.min(
    MAX_SAVE_CODE_ISLANDS,
    Math.max(
      Array.isArray(before.bestStars) ? before.bestStars.length : 0,
      Array.isArray(after.bestStars) ? after.bestStars.length : 0,
      rawDwLen(before, rawBefore),
      rawDwLen(after, rawAfter),
    ),
  );
  const hasDiffWins =
    (before.difficultyWins ?? rawBefore.dw) !== undefined ||
    (after.difficultyWins ?? rawAfter.dw) !== undefined;
  const dwBefore = hasDiffWins ? sizedDifficultyWins(before, starLen) : null;
  const dwAfter = hasDiffWins ? sizedDifficultyWins(after, starLen) : null;
  let starsBefore = 0;
  let starsAfter = 0;
  for (let i = 0; i < starLen; i++) {
    starsBefore += Math.max(
      safeInt(before.bestStars?.[i], 3),
      dwBefore ? Math.max(dwBefore.easy[i] ?? 0, dwBefore.normal[i] ?? 0, dwBefore.hard[i] ?? 0) : 0,
    );
    starsAfter += Math.max(
      safeInt(after.bestStars?.[i], 3),
      dwAfter ? Math.max(dwAfter.easy[i] ?? 0, dwAfter.normal[i] ?? 0, dwAfter.hard[i] ?? 0) : 0,
    );
  }
  const stars = starsAfter - starsBefore;
  const islands = safeInt(after.unlockedLevelIndex) - safeInt(before.unlockedLevelIndex);
  const countValidBadges = (list: unknown): number => {
    if (!Array.isArray(list)) return 0;
    const seen = new Set<string>();
    for (const id of list) {
      if (typeof id === 'string' && id.length > 0 && id.length <= 40) seen.add(id);
    }
    return seen.size;
  };
  const beforeCc = Array.isArray(before.challengeClears) ? before.challengeClears : [];
  const afterCc = Array.isArray(after.challengeClears) ? after.challengeClears : [];
  let badges = 0;
  const badgeLen = Math.max(beforeCc.length, afterCc.length);
  for (let i = 0; i < badgeLen; i++) {
    badges += countValidBadges(afterCc[i]) - countValidBadges(beforeCc[i]);
  }
  const parts: string[] = [];
  if (stars > 0) parts.push(`+${stars}★`);
  if (islands > 0) parts.push(`${islands} more island${islands === 1 ? '' : 's'} unlocked`);
  if (badges > 0) parts.push(`+${badges} badge${badges === 1 ? '' : 's'}`);
  else {
    const wcBefore = new Set(sanitizeWonChallenges(before.wonChallenges ?? rawBefore.wc) ?? []);
    const newWc = (sanitizeWonChallenges(after.wonChallenges ?? rawAfter.wc) ?? []).filter(
      (id) => !wcBefore.has(id),
    ).length;
    if (newWc > 0) parts.push(`+${newWc} challenge win${newWc === 1 ? '' : 's'}`);
  }
  const beforeEw = Array.isArray(before.bestEndlessWaves) ? before.bestEndlessWaves : [];
  const afterEw = Array.isArray(after.bestEndlessWaves) ? after.bestEndlessWaves : [];
  const records = afterEw.some((v, i) => safeInt(v) > safeInt(beforeEw[i]));
  if (records) parts.push('new endless records');
  const dailies = safeInt(after.daily?.total) - safeInt(before.daily?.total);
  if (dailies > 0) parts.push(`+${dailies} daily win${dailies === 1 ? '' : 's'}`);
  if (workshopStarsSpent(sanitizeRanks(after.workshop)) > workshopStarsSpent(sanitizeRanks(before.workshop))) {
    parts.push('workshop upgrades');
  }
  const rawHeroesBefore = before.heroes ?? rawBefore.h;
  const rawHeroesAfter = after.heroes ?? rawAfter.h;
  const heroesBefore =
    rawHeroesBefore !== undefined ? sanitizeHeroSaveData(normalizeRawHeroSave(rawHeroesBefore)) : undefined;
  const heroesAfter =
    rawHeroesAfter !== undefined ? sanitizeHeroSaveData(normalizeRawHeroSave(rawHeroesAfter)) : undefined;
  if (totalHeroSaveXp(heroesAfter) > totalHeroSaveXp(heroesBefore)) {
    parts.push('hero XP');
  } else if (heroesAfter) {
    let spentBefore = 0;
    let spentAfter = 0;
    for (let i = 0; i < HERO_IDS.length; i++) {
      const id = HERO_IDS[i];
      spentBefore += countHeroSkillPointsSpent(id, heroesBefore?.roster?.[id]?.skills ?? []);
      spentAfter += countHeroSkillPointsSpent(id, heroesAfter.roster?.[id]?.skills ?? []);
    }
    if (spentAfter > spentBefore) parts.push('hero skills');
  }
  if (dwBefore && dwAfter) {
    let newHardRibbons = 0;
    let betterDiffStars = false;
    for (let i = 0; i < starLen; i++) {
      const hb = dwBefore.hard[i] ?? 0;
      const ha = dwAfter.hard[i] ?? 0;
      if (hb === 0 && ha > 0) newHardRibbons++;
      else if (
        ha > hb ||
        (dwAfter.normal[i] ?? 0) > (dwBefore.normal[i] ?? 0) ||
        (dwAfter.easy[i] ?? 0) > (dwBefore.easy[i] ?? 0)
      ) {
        betterDiffStars = true;
      }
    }
    if (newHardRibbons > 0) {
      parts.push(`+${newHardRibbons} Hard ribbon${newHardRibbons === 1 ? '' : 's'}`);
    } else if (betterDiffStars) {
      parts.push('difficulty records');
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'nothing new — this save already had all of it';
}
