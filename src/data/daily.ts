import { CHALLENGES, CHALLENGE_IDS, isChallengeId, type ChallengeId } from './challenges.ts';

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

/** Days since 1970-01-01 (UTC) for a millisecond timestamp (`0` for non-finite inputs). */
export function utcDayNumber(epochMs: number): number {
  if (!Number.isFinite(epochMs)) return 0;
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
 * Challenges that make every foe (or every coin) count against you. Two of them stacked lost almost
 * every scripted Heroic/Master run even with a maxed Workshop (PROGRESS round 2), so a daily takes
 * at most one.
 */
const STRONG_RULES: ReadonlySet<ChallengeId> = new Set<ChallengeId>(['ironTide', 'galeForce', 'thinPurse', 'championHost']);
export const isStrongRule = (id: ChallengeId): boolean => STRONG_RULES.has(id);

/** Two challenges that may share a daily: different, ≤ 1 tower ban, ≤ 1 strong rule. */
export function dailyPairAllowed(a: ChallengeId, b: ChallengeId): boolean {
  return a !== b && !(isBan(a) && isBan(b)) && !(isStrongRule(a) && isStrongRule(b));
}

/**
 * Today's challenge among the first `clearedIslands` islands (the player must have won them, so a
 * daily is always on familiar ground). Two different challenges from `challengePool` (defaults to
 * `CHALLENGE_IDS`; 2D passes `CHALLENGE_IDS_2D`), at most one tower ban and at most one strong rule
 * (see STRONG_RULES).
 * Returns null until at least one island is cleared.
 */
export function dailyChallengeFor(
  day: number,
  clearedIslands: readonly number[],
  challengePool: readonly ChallengeId[] = CHALLENGE_IDS,
): DailyChallenge | null {
  if (!Number.isFinite(day)) return null;
  const cleanDay = Math.floor(day);
  const validIslands: number[] = [];
  for (let i = 0; i < clearedIslands.length; i++) {
    const idx = clearedIslands[i];
    if (typeof idx === 'number' && Number.isFinite(idx) && idx >= 0) {
      const floored = Math.floor(idx);
      if (!validIslands.includes(floored)) validIslands.push(floored);
    }
  }
  const validPool: ChallengeId[] = [];
  for (let i = 0; i < challengePool.length; i++) {
    const id = challengePool[i];
    if (isChallengeId(id) && !validPool.includes(id)) validPool.push(id);
  }
  if (validIslands.length === 0 || validPool.length < 2) return null;
  const levelIndex = validIslands[hashDay(cleanDay, 1) % validIslands.length];
  const first = validPool[hashDay(cleanDay, 2) % validPool.length];
  const pool = validPool.filter((id) => dailyPairAllowed(first, id));
  if (pool.length === 0) return null;
  const second = pool[hashDay(cleanDay, 3) % pool.length];
  return { day: cleanDay, levelIndex, challenges: [first, second] };
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
  if (!Number.isFinite(today)) return rec;
  const cleanToday = Math.floor(today);
  if (rec.lastDay > cleanToday) {
    rec.lastDay = cleanToday - 2;
    rec.streak = 0;
  }
  return rec;
}

/** Streak still alive today? (completed yesterday or today) */
export function liveStreak(rec: DailyRecord, today: number): number {
  if (!Number.isFinite(today)) return 0;
  const cleanToday = Math.floor(today);
  if (rec.lastDay > cleanToday) return 0;
  return rec.lastDay === cleanToday || rec.lastDay === cleanToday - 1 ? Math.max(0, rec.streak) : 0;
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
  if (!Number.isFinite(day) || !Number.isFinite(today)) {
    return { counted: false, streak: Math.max(0, rec.streak) };
  }
  const cleanDay = Math.floor(day);
  const cleanToday = Math.floor(today);
  normalizeDailyRecord(rec, cleanToday);
  if (cleanDay > cleanToday || cleanDay < cleanToday - 1 || cleanDay <= rec.lastDay) {
    return { counted: false, streak: Math.max(0, rec.streak) };
  }
  rec.streak = rec.lastDay === cleanDay - 1 ? Math.max(0, rec.streak) + 1 : 1;
  rec.lastDay = cleanDay;
  rec.bestStreak = Math.max(rec.bestStreak, rec.streak);
  rec.total = Math.max(0, rec.total) + 1;
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
