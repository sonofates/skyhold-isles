import type { HeroId, HeroSaveData, ProgressData } from '../core/types.ts';
import { isChallengeId } from '../data/challenges.ts';
import { sanitizeDailyRecord, type DailyRecord } from '../data/daily.ts';
import { HERO_IDS, mergeHeroSaveData, sanitizeHeroSaveData, totalHeroSaveXp } from '../data/heroes.ts';
import { sanitizeRanks } from '../data/workshop.ts';
import { starWallet } from '../game/progression.ts';
import { migrateProgress } from './storage.ts';

/**
 * Save codes: the campaign save as a copy-paste string, to move progress between devices or keep a
 * backup outside the browser. Format `SKY2-<base64url JSON>-<checksum>`; the checksum catches typos
 * and truncated pastes. Loading a code MERGES it into the current save (best of both per record),
 * so a load can never lose progress. Settings are device-specific and not part of the code.
 */
const PREFIX = 'SKY2-';

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
function trimZeros(list: readonly number[]): number[] {
  let end = list.length;
  while (end > 0 && !list[end - 1]) end--;
  return list.slice(0, end);
}

function trimLists(list: readonly string[][]): string[][] {
  let end = list.length;
  while (end > 0 && (list[end - 1]?.length ?? 0) === 0) end--;
  return list.slice(0, end).map((l) => [...l]);
}

interface CompactHeroPayload {
  readonly s: HeroId;
  readonly r?: Partial<Record<HeroId, { readonly x: number; readonly k?: readonly string[] }>>;
}

function encodeHeroPayload(heroes: HeroSaveData): CompactHeroPayload {
  const clean = sanitizeHeroSaveData(heroes);
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
  const obj = raw as Record<string, unknown>;
  // Accept either compact `{ s, r: { bran: { x, k } } }` or full `{ selectedHero, roster }`.
  if ('selectedHero' in obj || 'roster' in obj) {
    return sanitizeHeroSaveData(obj);
  }
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
  return sanitizeHeroSaveData({ selectedHero: obj.s, roster });
}

export function encodeSaveCode(progress: ProgressData, levelIds?: readonly string[]): string {
  const payload: Record<string, unknown> = {
    v: progress.version,
    u: progress.unlockedLevelIndex,
    s: trimZeros(progress.bestStars),
    e: trimZeros(progress.bestEndlessWaves),
    l: trimZeros(progress.bestLives),
    c: trimZeros(progress.clears),
    w: progress.workshop,
    b: trimLists(progress.challengeClears),
    d: progress.daily,
  };
  if (progress.heroes !== undefined) {
    payload.h = encodeHeroPayload(progress.heroes);
  }
  if (levelIds && levelIds.length > 0) {
    payload.i = [...levelIds];
  }
  const body = toBase64Url(JSON.stringify(payload));
  return `${PREFIX}${body}-${checksum(body)}`;
}

export type SaveCodeResult =
  | { readonly ok: true; readonly progress: ProgressData; readonly levelIds?: readonly string[] }
  | { readonly ok: false; readonly error: string };

export function decodeSaveCode(code: string, levelCount: number): SaveCodeResult {
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
  const r = raw as Record<string, unknown>;
  const decodedHeroes = r.h !== undefined ? decodeHeroPayload(r.h) : undefined;
  const levelIds = Array.isArray(r.i)
    ? r.i.map((x) => (typeof x === 'string' ? x : ''))
    : undefined;
  const hasValidIds = levelIds !== undefined && levelIds.some((id) => id.length > 0);
  const progress = migrateProgress(
    {
      version: r.v,
      unlockedLevelIndex: r.u,
      bestStars: r.s,
      bestEndlessWaves: r.e,
      bestLives: r.l,
      clears: r.c,
      workshop: r.w,
      challengeClears: r.b,
      daily: r.d,
      ...(decodedHeroes !== undefined ? { heroes: decodedHeroes } : {}),
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
 * Best of both saves, record by record: a merge never lowers anything. Workshop ranks come from
 * whichever save had spent more (refunded if the merged wallet somehow cannot pay for them).
 */
export function mergeProgress(a: ProgressData, b: ProgressData, levelCount: number): ProgressData {
  const count = Number.isFinite(levelCount) ? Math.max(0, Math.floor(levelCount)) : 0;
  const maxList = (x: readonly number[], y: readonly number[]): number[] =>
    Array.from({ length: count }, (_, i) => Math.max(x[i] ?? 0, y[i] ?? 0));
  const daily = mergeDaily(a.daily, b.daily);
  const spentA = starWallet(a).spent;
  const spentB = starWallet(b).spent;
  const maxIdx = Math.max(0, count - 1);
  const bestStars = maxList(a.bestStars, b.bestStars);
  const clears = maxList(a.clears, b.clears);
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
  const mergedHeroes = mergeHeroSaveData(a.heroes, b.heroes, clearedCount, unlockedLevelIndex);
  const merged: ProgressData = {
    version: Math.max(a.version, b.version),
    unlockedLevelIndex,
    bestStars,
    bestEndlessWaves: maxList(a.bestEndlessWaves, b.bestEndlessWaves),
    bestLives: maxList(a.bestLives, b.bestLives),
    clears,
    workshop: sanitizeRanks(spentB > spentA ? b.workshop : a.workshop),
    challengeClears: Array.from({ length: count }, (_, i) => {
      const out = [...(a.challengeClears[i] ?? [])];
      for (const id of b.challengeClears[i] ?? []) if (!out.includes(id)) out.push(id);
      return out;
    }),
    daily,
    ...(mergedHeroes !== undefined ? { heroes: mergedHeroes } : {}),
  };
  if (starWallet(merged).available < 0) merged.workshop = {};
  return merged;
}

/** What a merge would add, for the confirmation line ("+5★, 2 islands, …"). */
export function describeMergeGain(before: ProgressData, after: ProgressData): string {
  const stars = starWallet(after).campaign - starWallet(before).campaign;
  const islands = after.unlockedLevelIndex - before.unlockedLevelIndex;
  let badges = 0;
  for (let i = 0; i < after.challengeClears.length; i++) {
    badges += (after.challengeClears[i]?.length ?? 0) - (before.challengeClears[i]?.length ?? 0);
  }
  const parts: string[] = [];
  if (stars > 0) parts.push(`+${stars}★`);
  if (islands > 0) parts.push(`${islands} more island${islands === 1 ? '' : 's'} unlocked`);
  if (badges > 0) parts.push(`+${badges} badge${badges === 1 ? '' : 's'}`);
  const records = after.bestEndlessWaves.some((v, i) => v > (before.bestEndlessWaves[i] ?? 0));
  if (records) parts.push('new endless records');
  const dailies = (after.daily?.total ?? 0) - (before.daily?.total ?? 0);
  if (dailies > 0) parts.push(`+${dailies} daily win${dailies === 1 ? '' : 's'}`);
  if (totalHeroSaveXp(after.heroes) > totalHeroSaveXp(before.heroes)) parts.push('hero XP');
  return parts.length > 0 ? parts.join(', ') : 'nothing new — this save already had all of it';
}
