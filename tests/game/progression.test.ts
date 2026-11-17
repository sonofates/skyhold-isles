import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/data/levels/index.ts';
import { computeStarsForLivesLost, STAR_RULES, type Difficulty } from '../../src/data/stars.ts';
import { applyEndlessRecord, applyWin, totalCampaignStars } from '../../src/game/progression.ts';
import { createDefaultProgress, migrateProgress, PROGRESS_SAVE_VERSION } from '../../src/platform/storage.ts';
import { computeStarRating } from '../../src/sim/world.ts';

describe('star rules per difficulty', () => {
  it('rates on lives lost with the documented table', () => {
    expect(computeStarsForLivesLost(0, 'Breezy')).toBe(3);
    expect(computeStarsForLivesLost(2, 'Breezy')).toBe(3);
    expect(computeStarsForLivesLost(3, 'Breezy')).toBe(2);
    expect(computeStarsForLivesLost(10, 'Breezy')).toBe(2);
    expect(computeStarsForLivesLost(11, 'Breezy')).toBe(1);

    expect(computeStarsForLivesLost(3, 'Challenging')).toBe(3);
    expect(computeStarsForLivesLost(4, 'Challenging')).toBe(2);
    expect(computeStarsForLivesLost(5, 'Heroic')).toBe(3);
    expect(computeStarsForLivesLost(12, 'Heroic')).toBe(2);
    expect(computeStarsForLivesLost(13, 'Heroic')).toBe(1);
    expect(computeStarsForLivesLost(7, 'Master')).toBe(3);
    expect(computeStarsForLivesLost(14, 'Master')).toBe(2);
    expect(computeStarsForLivesLost(19, 'Master')).toBe(1);
  });

  it('harder islands are never stricter than easier ones', () => {
    const order: Difficulty[] = ['Breezy', 'Challenging', 'Heroic', 'Master'];
    for (let i = 1; i < order.length; i++) {
      expect(STAR_RULES[order[i]].threeStarMaxLost).toBeGreaterThanOrEqual(STAR_RULES[order[i - 1]].threeStarMaxLost);
      expect(STAR_RULES[order[i]].twoStarMaxLost).toBeGreaterThanOrEqual(STAR_RULES[order[i - 1]].twoStarMaxLost);
    }
    for (const d of order) {
      expect(STAR_RULES[d].twoStarMaxLost).toBeGreaterThan(STAR_RULES[d].threeStarMaxLost);
      expect(STAR_RULES[d].twoStarMaxLost).toBeLessThan(20);
    }
  });

  it('junk input still yields a valid rating', () => {
    expect(computeStarsForLivesLost(-5, 'Master')).toBe(3);
    expect(computeStarsForLivesLost(Number.NaN, 'Heroic')).toBe(3);
  });

  it('bonus lives do not inflate stars (rated on lives lost from the run start)', () => {
    // 22-life run that lost 4 lives on a Breezy island: 2 stars, same as 20 → 16.
    expect(computeStarRating(18, 'Breezy', 22)).toBe(2);
    expect(computeStarRating(16, 'Breezy', 20)).toBe(2);
    // Classic default reproduces the old 18 / 10 thresholds.
    expect(computeStarRating(18)).toBe(3);
    expect(computeStarRating(17)).toBe(2);
    expect(computeStarRating(10)).toBe(2);
    expect(computeStarRating(9)).toBe(1);
  });
});

describe('applyWin', () => {
  it('first clear unlocks the next island and records the best result', () => {
    const p = createDefaultProgress(5);
    const r = applyWin(p, 0, 5, 2, 14);
    expect(r.firstClear).toBe(true);
    expect(r.starsGained).toBe(2);
    expect(r.unlockedIndex).toBe(1);
    expect(p.unlockedLevelIndex).toBe(1);
    expect(p.bestStars[0]).toBe(2);
    expect(p.bestLives[0]).toBe(14);
    expect(p.clears[0]).toBe(1);
  });

  it('a worse replay never lowers the record, a better one reports the gain', () => {
    const p = createDefaultProgress(5);
    applyWin(p, 0, 5, 3, 19);
    const worse = applyWin(p, 0, 5, 1, 4);
    expect(worse.firstClear).toBe(false);
    expect(worse.starsGained).toBe(0);
    expect(worse.unlockedIndex).toBeNull();
    expect(p.bestStars[0]).toBe(3);
    expect(p.bestLives[0]).toBe(19);
    expect(p.clears[0]).toBe(2);

    const q = createDefaultProgress(5);
    applyWin(q, 0, 5, 1, 5);
    const better = applyWin(q, 0, 5, 3, 20);
    expect(better.starsGained).toBe(2);
    expect(better.previousBestStars).toBe(1);
  });

  it('winning the last island keeps the unlock in range', () => {
    const p = createDefaultProgress(3);
    p.unlockedLevelIndex = 2;
    const r = applyWin(p, 2, 3, 1, 3);
    expect(r.unlockedIndex).toBeNull();
    expect(p.unlockedLevelIndex).toBe(2);
  });

  it('replaying an early island never re-locks later ones', () => {
    const p = createDefaultProgress(5);
    p.unlockedLevelIndex = 4;
    applyWin(p, 0, 5, 1, 1);
    expect(p.unlockedLevelIndex).toBe(4);
  });

  it('endless records keep the personal best', () => {
    const p = createDefaultProgress(3);
    expect(applyEndlessRecord(p, 1, 24).isNewBest).toBe(true);
    const r = applyEndlessRecord(p, 1, 20);
    expect(r.isNewBest).toBe(false);
    expect(r.best).toBe(24);
    expect(p.bestEndlessWaves[1]).toBe(24);
  });

  it('totals campaign stars', () => {
    const p = createDefaultProgress(4);
    p.bestStars = [3, 2, 0, 1];
    expect(totalCampaignStars(p)).toBe(6);
  });
});

describe('save migration v1 → v2', () => {
  it('keeps a v1 save intact and adds the new fields', () => {
    const v1 = { unlockedLevelIndex: 4, bestStars: [3, 2, 2, 1], bestEndlessWaves: [0, 31] };
    const p = migrateProgress(v1, LEVELS.length);
    expect(p.version).toBe(PROGRESS_SAVE_VERSION);
    expect(p.unlockedLevelIndex).toBe(4);
    expect(p.bestStars.slice(0, 5)).toEqual([3, 2, 2, 1, 0]);
    expect(p.bestEndlessWaves[1]).toBe(31);
    expect(p.bestLives).toHaveLength(LEVELS.length);
    // Islands with stars count as cleared once.
    expect(p.clears.slice(0, 5)).toEqual([1, 1, 1, 1, 0]);
  });

  it('round-trips a v2 save', () => {
    const p = createDefaultProgress(LEVELS.length);
    applyWin(p, 0, LEVELS.length, 3, 20);
    applyWin(p, 0, LEVELS.length, 2, 15);
    const back = migrateProgress(JSON.parse(JSON.stringify(p)), LEVELS.length);
    expect(back).toEqual(p);
  });

  it('never throws on garbage', () => {
    for (const junk of [null, 5, 'x', [], { bestLives: 'no', clears: [NaN, -3, 2.7] }]) {
      const p = migrateProgress(junk, 6);
      expect(p.bestStars).toHaveLength(6);
      expect(p.unlockedLevelIndex).toBe(0);
    }
    expect(migrateProgress({ clears: [NaN, -3, 2.7] }, 3).clears).toEqual([0, 0, 2]);
  });
});
