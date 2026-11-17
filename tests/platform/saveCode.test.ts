import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/data/levels/index.ts';
import { starWallet } from '../../src/game/progression.ts';
import { decodeSaveCode, describeMergeGain, encodeSaveCode, mergeProgress } from '../../src/platform/saveCode.ts';
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
