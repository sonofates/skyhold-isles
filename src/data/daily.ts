import { CHALLENGES, CHALLENGE_IDS, type ChallengeId } from './challenges.ts';

/**
 * Daily Squall: one island + two challenges per UTC day, the same for every player on that day.
 * Pure and deterministic — the caller passes the day number (days since the Unix epoch, UTC), so
 * nothing here reads the clock. Winning it once per day gives +1★ and extends the streak.
 */
export interface DailyChallenge {
  readonly day: number;
  readonly levelIndex: number;
  readonly challenges: readonly ChallengeId[];
}

/** Days since 1970-01-01 (UTC) for a millisecond timestamp. */
export function utcDayNumber(epochMs: number): number {
  return Math.floor(epochMs / 86_400_000);
}

/** Small integer hash (xorshift-multiply) so consecutive days look unrelated. */
function hashDay(day: number, salt: number): number {
  let h = (Math.floor(day) * 0x9e3779b1 + salt * 0x85ebca6b) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

const isBan = (id: ChallengeId): boolean => (CHALLENGES[id].patch.bannedTowers?.length ?? 0) > 0;

/**
 * Today's challenge among the first `clearedIslands` islands (the player must have won them, so a
 * daily is always on familiar ground). Two different challenges, at most one tower ban.
 * Returns null until at least one island is cleared.
 */
export function dailyChallengeFor(day: number, clearedIslands: readonly number[]): DailyChallenge | null {
  if (clearedIslands.length === 0) return null;
  const levelIndex = clearedIslands[hashDay(day, 1) % clearedIslands.length];
  const first = CHALLENGE_IDS[hashDay(day, 2) % CHALLENGE_IDS.length];
  const pool = CHALLENGE_IDS.filter((id) => id !== first && !(isBan(first) && isBan(id)));
  const second = pool[hashDay(day, 3) % pool.length];
  return { day, levelIndex, challenges: [first, second] };
}

/** Saved daily record. */
export interface DailyRecord {
  /** Day number of the last completed daily (-1 = never). */
  lastDay: number;
  streak: number;
  bestStreak: number;
  /** Dailies won in total (each worth one Workshop star). */
  total: number;
}

export function createDailyRecord(): DailyRecord {
  return { lastDay: -1, streak: 0, bestStreak: 0, total: 0 };
}

/**
 * Repairs a record written with a clock that ran ahead (lastDay in the future): otherwise the
 * Daily would stay "won" and unpaid until that date. Returns the same object.
 */
export function normalizeDailyRecord(rec: DailyRecord, today: number): DailyRecord {
  if (rec.lastDay > today) {
    rec.lastDay = today - 2;
    rec.streak = 0;
  }
  return rec;
}

/** Streak still alive today? (completed yesterday or today) */
export function liveStreak(rec: DailyRecord, today: number): number {
  if (rec.lastDay > today) return 0;
  return rec.lastDay === today || rec.lastDay === today - 1 ? rec.streak : 0;
}

/**
 * Records a daily win for `day`, judged at `today`. Counts once per day, and only for today's
 * daily or yesterday's (grace for a run that crossed midnight) — an old daily kept alive with
 * Retry pays nothing.
 */
export function applyDailyWin(
  rec: DailyRecord,
  day: number,
  today: number,
): { counted: boolean; streak: number } {
  normalizeDailyRecord(rec, today);
  if (day > today || day < today - 1 || day <= rec.lastDay) return { counted: false, streak: rec.streak };
  rec.streak = rec.lastDay === day - 1 ? rec.streak + 1 : 1;
  rec.lastDay = day;
  rec.bestStreak = Math.max(rec.bestStreak, rec.streak);
  rec.total += 1;
  return { counted: true, streak: rec.streak };
}

export function sanitizeDailyRecord(raw: unknown): DailyRecord {
  const rec = createDailyRecord();
  if (!raw || typeof raw !== 'object') return rec;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown, min: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : null;
  rec.lastDay = int(r.lastDay, -1) ?? -1;
  rec.streak = int(r.streak, 0) ?? 0;
  rec.total = int(r.total, 0) ?? 0;
  rec.bestStreak = Math.max(int(r.bestStreak, 0) ?? 0, rec.streak);
  return rec;
}
