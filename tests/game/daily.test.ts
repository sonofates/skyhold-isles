import { describe, expect, it } from 'vitest';
import { CHALLENGES, isChallengeId } from '../../src/data/challenges.ts';
import {
  applyDailyWin,
  createDailyRecord,
  dailyChallengeFor,
  liveStreak,
  sanitizeDailyRecord,
  utcDayNumber,
} from '../../src/data/daily.ts';
import { starWallet } from '../../src/game/progression.ts';
import { createDefaultProgress, migrateProgress } from '../../src/platform/storage.ts';

describe('daily squall selection', () => {
  it('is locked until an island is cleared', () => {
    expect(dailyChallengeFor(20000, [])).toBeNull();
  });

  it('is deterministic per day, varies across days, and stays on cleared islands', () => {
    const cleared = [0, 1, 2, 3, 4, 5];
    const a = dailyChallengeFor(20000, cleared)!;
    expect(dailyChallengeFor(20000, cleared)).toEqual(a);
    const islands = new Set<number>();
    const firsts = new Set<string>();
    for (let d = 20000; d < 20060; d++) {
      const c = dailyChallengeFor(d, cleared)!;
      expect(cleared).toContain(c.levelIndex);
      expect(c.challenges).toHaveLength(2);
      expect(c.challenges[0]).not.toBe(c.challenges[1]);
      for (const id of c.challenges) expect(isChallengeId(id)).toBe(true);
      const bans = c.challenges.filter((id) => (CHALLENGES[id].patch.bannedTowers?.length ?? 0) > 0);
      expect(bans.length).toBeLessThanOrEqual(1);
      islands.add(c.levelIndex);
      firsts.add(c.challenges[0]);
    }
    expect(islands.size).toBeGreaterThanOrEqual(5);
    expect(firsts.size).toBeGreaterThanOrEqual(6);
  });

  it('day numbers are UTC days', () => {
    expect(utcDayNumber(0)).toBe(0);
    expect(utcDayNumber(86_400_000 - 1)).toBe(0);
    expect(utcDayNumber(Date.UTC(2026, 10, 17, 23, 59))).toBe(utcDayNumber(Date.UTC(2026, 10, 17, 0, 1)));
  });
});

describe('daily record', () => {
  it('counts once per day and builds a streak on consecutive days', () => {
    const r = createDailyRecord();
    expect(applyDailyWin(r, 100)).toEqual({ counted: true, streak: 1 });
    expect(applyDailyWin(r, 100).counted).toBe(false);
    expect(applyDailyWin(r, 101).streak).toBe(2);
    expect(applyDailyWin(r, 103).streak).toBe(1);
    expect(r.total).toBe(3);
    expect(r.bestStreak).toBe(2);
    // An older day (run started before midnight) never double-counts or rewinds.
    expect(applyDailyWin(r, 102).counted).toBe(false);
  });

  it('a streak is only live if yesterday or today was won', () => {
    const r = createDailyRecord();
    applyDailyWin(r, 50);
    applyDailyWin(r, 51);
    expect(liveStreak(r, 51)).toBe(2);
    expect(liveStreak(r, 52)).toBe(2);
    expect(liveStreak(r, 53)).toBe(0);
  });

  it('daily wins are Workshop stars and survive save migration', () => {
    const p = createDefaultProgress(5);
    applyDailyWin(p.daily, 10);
    applyDailyWin(p.daily, 11);
    expect(starWallet(p).challenge).toBe(2);
    const back = migrateProgress(JSON.parse(JSON.stringify(p)), 5);
    expect(back.daily).toEqual(p.daily);
    expect(sanitizeDailyRecord({ lastDay: 'x', streak: -4, total: 3.9, bestStreak: 1 })).toEqual({
      lastDay: -1,
      streak: 0,
      bestStreak: 1,
      total: 3,
    });
    // v1 saves get an empty record.
    expect(migrateProgress({ unlockedLevelIndex: 1, bestStars: [2] }, 5).daily).toEqual(createDailyRecord());
  });
});
