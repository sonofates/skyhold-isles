import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/data/levels/index.ts';
import { starWallet } from '../../src/game/progression.ts';
import {
  decodeSaveCode,
  describeMergeGain,
  encodeSaveCode,
  mergeDaily,
  mergeProgress,
} from '../../src/platform/saveCode.ts';
import { createDefaultProgress } from '../../src/platform/storage.ts';

const N = LEVELS.length;

function sample() {
  const p = createDefaultProgress(N);
  p.unlockedLevelIndex = 4;
  p.bestStars.splice(0, 4, 3, 2, 2, 1);
  p.bestLives.splice(0, 4, 20, 14, 11, 6);
  p.clears.splice(0, 4, 3, 1, 2, 1);
  p.bestEndlessWaves[2] = 22;
  p.challengeClears[0] = ['bowless'];
  p.workshop = { treasury: 1 };
  p.daily = { lastDay: 20400, streak: 2, bestStreak: 4, total: 6 };
  return p;
}

describe('save codes', () => {
  it('round-trip a save exactly', () => {
    const p = sample();
    const code = encodeSaveCode(p);
    expect(code.startsWith('SKY2-')).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const res = decodeSaveCode(code, N);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.progress).toEqual(p);
  });

  it('a fresh save makes a short code that decodes to a fresh save', () => {
    const fresh = createDefaultProgress(N);
    const code = encodeSaveCode(fresh);
    expect(code.length).toBeLessThan(200);
    const res = decodeSaveCode(code, N);
    expect(res.ok && res.progress).toEqual(fresh);
  });

  it('tolerates whitespace / line breaks from chat apps', () => {
    const code = encodeSaveCode(sample());
    const messy = `  ${code.slice(0, 20)}\n${code.slice(20, 50)} ${code.slice(50)}\n`;
    expect(decodeSaveCode(messy, N).ok).toBe(true);
  });

  it('rejects foreign text, truncated and edited codes with a readable reason', () => {
    const code = encodeSaveCode(sample());
    for (const bad of ['', 'hello', 'SKY2-', code.slice(0, code.length - 3), code.replace('SKY2-e', 'SKY2-f')]) {
      const res = decodeSaveCode(bad, N);
      expect(res.ok, bad).toBe(false);
      if (!res.ok) expect(res.error.length).toBeGreaterThan(5);
    }
    // A checksummed code whose payload is not JSON.
    const body = btoa('not json').replace(/=+$/, '');
    expect(decodeSaveCode(`SKY2-${body}-0000000`, N).ok).toBe(false);
  });

  it('a code from a build with fewer islands loads (padded) and keeps unlocks', () => {
    const short = createDefaultProgress(9);
    short.unlockedLevelIndex = 8;
    short.bestStars.fill(3);
    short.clears.fill(1);
    const res = decodeSaveCode(encodeSaveCode(short), N);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.progress.bestStars).toHaveLength(N);
    expect(res.progress.unlockedLevelIndex).toBeGreaterThanOrEqual(8);
  });
});

describe('mergeProgress', () => {
  it('never lowers a record on either side', () => {
    const a = sample();
    const b = createDefaultProgress(N);
    b.unlockedLevelIndex = 6;
    b.bestStars.splice(0, 6, 1, 3, 1, 1, 2, 2);
    b.clears.splice(0, 6, 1, 1, 1, 1, 1, 1);
    b.bestEndlessWaves[2] = 15;
    b.bestEndlessWaves[4] = 30;
    b.challengeClears[0] = ['glassSanctuary'];
    b.daily = { lastDay: 20410, streak: 1, bestStreak: 2, total: 3 };
    const m = mergeProgress(a, b, N);
    for (let i = 0; i < N; i++) {
      expect(m.bestStars[i]).toBe(Math.max(a.bestStars[i], b.bestStars[i]));
      expect(m.bestEndlessWaves[i]).toBe(Math.max(a.bestEndlessWaves[i], b.bestEndlessWaves[i]));
      expect(m.clears[i]).toBe(Math.max(a.clears[i], b.clears[i]));
    }
    expect(m.unlockedLevelIndex).toBe(6);
    expect(new Set(m.challengeClears[0])).toEqual(new Set(['bowless', 'glassSanctuary']));
    // Daily: the latest day's streak, the best of totals / best streaks.
    expect(m.daily).toEqual({ lastDay: 20410, streak: 1, bestStreak: 4, total: 6 });
    expect(starWallet(m).available).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent and keeps the bigger Workshop investment', () => {
    const a = sample();
    const b = sample();
    b.workshop = { treasury: 2, bastion: 1 };
    const m = mergeProgress(a, b, N);
    expect(m.workshop).toEqual(b.workshop);
    expect(mergeProgress(m, m, N)).toEqual(m);
  });

  it('describes what a merge adds', () => {
    const a = createDefaultProgress(N);
    const b = sample();
    expect(describeMergeGain(a, mergeProgress(a, b, N))).toContain('+8★');
    expect(describeMergeGain(b, mergeProgress(b, a, N))).toMatch(/nothing new/);
  });
});

describe('save code hardening (review fixes)', () => {
  it('a hand-made code with unknown / non-Latin challenge ids loads without them, and re-encodes', () => {
    const p = sample();
    p.challengeClears[1] = ['\u4e2d\u6587', 'notAChallenge', 'galeForce'];
    const code = encodeSaveCode(p); // UTF-8 safe: must not throw
    const res = decodeSaveCode(code, N);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.progress.challengeClears[1]).toEqual(['galeForce']);
    expect(() => encodeSaveCode(mergeProgress(sample(), res.progress, N))).not.toThrow();
  });
});

describe('mergeDaily', () => {
  it('chains a streak continued on another device', () => {
    // A won days 96..100 (streak 5); B won day 101 (streak 1).
    const m = mergeDaily(
      { lastDay: 100, streak: 5, bestStreak: 5, total: 10 },
      { lastDay: 101, streak: 1, bestStreak: 1, total: 1 },
    );
    expect(m).toEqual({ lastDay: 101, streak: 6, bestStreak: 6, total: 10 });
  });

  it('overlapping runs count each day once; a gap keeps only the latest run', () => {
    const overlap = mergeDaily(
      { lastDay: 100, streak: 3, bestStreak: 3, total: 3 },
      { lastDay: 101, streak: 3, bestStreak: 3, total: 3 },
    );
    expect(overlap.streak).toBe(4); // days 98..101
    const gap = mergeDaily(
      { lastDay: 100, streak: 4, bestStreak: 4, total: 4 },
      { lastDay: 103, streak: 2, bestStreak: 2, total: 2 },
    );
    expect(gap).toEqual({ lastDay: 103, streak: 2, bestStreak: 4, total: 4 });
  });

  it('is symmetric and idempotent (including same-day streak=0 ties)', () => {
    const a = { lastDay: 100, streak: 5, bestStreak: 7, total: 12 };
    const b = { lastDay: 101, streak: 2, bestStreak: 2, total: 2 };
    expect(mergeDaily(a, b)).toEqual(mergeDaily(b, a));
    const m = mergeDaily(a, b);
    expect(mergeDaily(m, m)).toEqual(m);
    expect(mergeDaily(m, a)).toEqual(m);

    // Same lastDay where one record has streak=0 must stay commutative and preserve the live streak.
    const sameZero = { lastDay: 100, streak: 0, bestStreak: 0, total: 0 };
    const sameLive = { lastDay: 100, streak: 3, bestStreak: 3, total: 3 };
    expect(mergeDaily(sameZero, sameLive)).toEqual({ lastDay: 100, streak: 3, bestStreak: 3, total: 3 });
    expect(mergeDaily(sameLive, sameZero)).toEqual({ lastDay: 100, streak: 3, bestStreak: 3, total: 3 });

    // describeMergeGain reports Daily Squall wins when that is the sole new record.
    const base = createDefaultProgress(N);
    const withDaily = createDefaultProgress(N);
    withDaily.daily = { lastDay: 20500, streak: 1, bestStreak: 1, total: 2 };
    expect(describeMergeGain(base, mergeProgress(base, withDaily, N))).toContain('+2 daily wins');
  });
});
