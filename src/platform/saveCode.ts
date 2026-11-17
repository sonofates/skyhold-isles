import type { ProgressData } from '../core/types.ts';
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

function toBase64Url(ascii: string): string {
  return btoa(ascii).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  const std = b64.replace(/-/g, '+').replace(/_/g, '/');
  return atob(std + '='.repeat((4 - (std.length % 4)) % 4));
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
  // Challenge ids and upgrade ids are ASCII; the JSON is plain ASCII, safe for btoa.
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
  return { ok: true, progress };
}

/**
 * Best of both saves, record by record: a merge never lowers anything. Workshop ranks come from
 * whichever save had spent more (refunded if the merged wallet somehow cannot pay for them).
 */
export function mergeProgress(a: ProgressData, b: ProgressData, levelCount: number): ProgressData {
  const maxList = (x: readonly number[], y: readonly number[]): number[] =>
    Array.from({ length: levelCount }, (_, i) => Math.max(x[i] ?? 0, y[i] ?? 0));
  const daily =
    b.daily.lastDay > a.daily.lastDay
      ? { ...b.daily }
      : { ...a.daily };
  daily.total = Math.max(a.daily.total, b.daily.total);
  daily.bestStreak = Math.max(a.daily.bestStreak, b.daily.bestStreak, daily.streak);
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
