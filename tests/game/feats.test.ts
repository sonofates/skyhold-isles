import { describe, expect, it } from 'vitest';
import { challengesForLevel } from '../../src/data/challenges.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { earnedFeatIds, FEATS, featStatuses, newlyEarnedFeats } from '../../src/game/feats.ts';
import { applyEndlessRecord, applyWin } from '../../src/game/progression.ts';
import { createDefaultProgress, migrateProgress } from '../../src/platform/storage.ts';

const byId = (p: ReturnType<typeof createDefaultProgress>) =>
  Object.fromEntries(featStatuses(p).map((s) => [s.def.id, s]));

describe('feats', () => {
  it('have unique ids, copy and positive targets', () => {
    const ids = new Set(FEATS.map((f) => f.id));
    expect(ids.size).toBe(FEATS.length);
    const fresh = createDefaultProgress(LEVELS.length);
    for (const s of featStatuses(fresh)) {
      expect(s.def.name.length).toBeGreaterThan(3);
      expect(s.def.description.length).toBeGreaterThan(5);
      expect(s.target).toBeGreaterThanOrEqual(1);
      expect(s.earned).toBe(false);
      expect(s.current).toBe(0);
    }
  });

  it('a first win earns First Landing; a 3-star win also Starcatcher', () => {
    const p = createDefaultProgress(LEVELS.length);
    const before = earnedFeatIds(p);
    applyWin(p, 0, LEVELS.length, 2, 14, []);
    expect(newlyEarnedFeats(before, p).map((f) => f.id)).toEqual(['firstLanding']);
    const mid = earnedFeatIds(p);
    applyWin(p, 0, LEVELS.length, 3, 19, []);
    expect(newlyEarnedFeats(mid, p).map((f) => f.id)).toEqual(['starcatcher']);
    // Replaying never re-announces.
    const after = earnedFeatIds(p);
    applyWin(p, 0, LEVELS.length, 3, 19, []);
    expect(newlyEarnedFeats(after, p)).toEqual([]);
  });

  it('Crowned needs 3 stars and every offered badge on one island', () => {
    const p = createDefaultProgress(LEVELS.length);
    const offered = challengesForLevel(LEVELS[0]);
    applyWin(p, 0, LEVELS.length, 3, 20, [offered[0]]);
    expect(byId(p).crowned.earned).toBe(false);
    applyWin(p, 0, LEVELS.length, 2, 12, [offered[1]]);
    expect(byId(p).crowned.earned).toBe(true);
    expect(byId(p).badgeHunter.current).toBe(2);
  });

  it('Master Stroke only counts Master islands', () => {
    const p = createDefaultProgress(LEVELS.length);
    const master = LEVELS.findIndex((l) => l.difficulty === 'Master');
    const breezy = LEVELS.findIndex((l) => l.difficulty === 'Breezy');
    p.bestStars[breezy] = 3;
    expect(byId(p).masterStroke.earned).toBe(false);
    p.bestStars[master] = 3;
    expect(byId(p).masterStroke.earned).toBe(true);
  });

  it('Storm Chaser follows the endless Gold medal; progress is the best tier', () => {
    const p = createDefaultProgress(LEVELS.length);
    const story = LEVELS[2].waves.length;
    applyEndlessRecord(p, 2, story + 1 + 6); // 6 endless waves cleared → Silver
    expect(byId(p).stormChaser.current).toBe(2);
    expect(byId(p).stormChaser.earned).toBe(false);
    applyEndlessRecord(p, 2, story + 1 + 10);
    expect(byId(p).stormChaser.earned).toBe(true);
  });

  it('Daily feats read the daily record; star totals cap the progress at the target', () => {
    const p = createDefaultProgress(LEVELS.length);
    p.daily = { lastDay: 10, streak: 3, bestStreak: 3, total: 9 };
    const s = byId(p);
    expect(s.steadyWinds.earned).toBe(true);
    expect(s.squallRider.earned).toBe(true);
    expect(s.squallRider.current).toBe(s.squallRider.target);
    for (let i = 0; i < LEVELS.length; i++) p.bestStars[i] = 3;
    expect(byId(p).fullFirmament.earned).toBe(true);
    expect(byId(p).stargazer.earned).toBe(true);
  });

  it('an old v1 save shows its feats straight away (no new save data)', () => {
    const v1 = {
      unlockedLevelIndex: 6,
      bestStars: [3, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      bestEndlessWaves: new Array(13).fill(0),
    };
    const p = migrateProgress(v1, LEVELS.length);
    const s = byId(p);
    expect(s.firstLanding.earned).toBe(true);
    expect(s.islandHopper.earned).toBe(true);
    expect(s.starcatcher.earned).toBe(true);
    expect(s.skyCharted.earned).toBe(false);
  });

  it('junk numbers never produce NaN or negative progress', () => {
    const p = createDefaultProgress(LEVELS.length);
    p.daily = { lastDay: -1, streak: -4, bestStreak: Number.NaN, total: -2 };
    for (const st of featStatuses(p)) {
      expect(Number.isFinite(st.current)).toBe(true);
      expect(st.current).toBeGreaterThanOrEqual(0);
    }
  });
});
