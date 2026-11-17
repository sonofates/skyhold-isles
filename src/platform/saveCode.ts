import type { ProgressData } from '../core/types.ts';
import { isChallengeId } from '../data/challenges.ts';
import type { DailyRecord } from '../data/daily.ts';
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

export function encodeSaveCode(progress: ProgressData): string {
  const payload = {
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
  const body = toBase64Url(JSON.stringify(payload));
  return `${PREFIX}${body}-${checksum(body)}`;
}

export type SaveCodeResult =
  | { readonly ok: true; readonly progress: ProgressData }
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
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'The code could not be read.' };
  const r = raw as Record<string, unknown>;
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
    },
    levelCount,
  );
  // Only real challenge ids travel between saves (a hand-made code could carry anything).
  progress.challengeClears = progress.challengeClears.map((list) => list.filter((id) => isChallengeId(id)));
  return { ok: true, progress };
}

/**
 * Daily records from two devices. The current streak chains when one save's run of wins starts no
 * later than the day after the other's last win (wins on both devices count as one run of days).
 * The total is the larger of the two, not the sum: without per-day history a sum would count the
 * same wins twice when a code is loaded again (merging must stay idempotent).
 */
export function mergeDaily(a: DailyRecord, b: DailyRecord): DailyRecord {
  const [early, late] = a.lastDay <= b.lastDay ? [a, b] : [b, a];
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

/**
 * Best of both saves, record by record: a merge never lowers anything. Workshop ranks come from
 * whichever save had spent more (refunded if the merged wallet somehow cannot pay for them).
 */
export function mergeProgress(a: ProgressData, b: ProgressData, levelCount: number): ProgressData {
  const maxList = (x: readonly number[], y: readonly number[]): number[] =>
    Array.from({ length: levelCount }, (_, i) => Math.max(x[i] ?? 0, y[i] ?? 0));
  const daily = mergeDaily(a.daily, b.daily);
  const spentA = starWallet(a).spent;
  const spentB = starWallet(b).spent;
  const merged: ProgressData = {
    version: Math.max(a.version, b.version),
    unlockedLevelIndex: Math.min(levelCount - 1, Math.max(a.unlockedLevelIndex, b.unlockedLevelIndex)),
    bestStars: maxList(a.bestStars, b.bestStars),
    bestEndlessWaves: maxList(a.bestEndlessWaves, b.bestEndlessWaves),
    bestLives: maxList(a.bestLives, b.bestLives),
    clears: maxList(a.clears, b.clears),
    workshop: { ...(spentB > spentA ? b.workshop : a.workshop) },
    challengeClears: Array.from({ length: levelCount }, (_, i) => {
      const out = [...(a.challengeClears[i] ?? [])];
      for (const id of b.challengeClears[i] ?? []) if (!out.includes(id)) out.push(id);
      return out;
    }),
    daily,
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
  return parts.length > 0 ? parts.join(', ') : 'nothing new — this save already had all of it';
}
