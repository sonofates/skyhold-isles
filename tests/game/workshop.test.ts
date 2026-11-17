import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { combineRunModifiers, isNeutralRun, NEUTRAL_RUN_MODIFIERS } from '../../src/data/runModifiers.ts';
import {
  buyRank,
  maxedWorkshopRanks,
  nextRankCost,
  rankOf,
  sanitizeRanks,
  WORKSHOP_UPGRADES,
  workshopModifiers,
  workshopStarsSpent,
  workshopTotalCost,
} from '../../src/data/workshop.ts';
import { starWallet } from '../../src/game/progression.ts';
import { createDefaultProgress, migrateProgress } from '../../src/platform/storage.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('workshop ranks', () => {
  it('buys ranks in order while stars last, never past max', () => {
    let ranks: Record<string, number> = {};
    let stars = 3;
    const c1 = nextRankCost(ranks, 'treasury')!;
    ranks = buyRank(ranks, 'treasury', stars)!;
    stars -= c1;
    expect(rankOf(ranks, 'treasury')).toBe(1);
    const c2 = nextRankCost(ranks, 'treasury')!;
    ranks = buyRank(ranks, 'treasury', stars)!;
    stars -= c2;
    expect(rankOf(ranks, 'treasury')).toBe(2);
    expect(nextRankCost(ranks, 'treasury')).toBeNull();
    expect(buyRank(ranks, 'treasury', 99)).toBeNull();
    expect(buyRank(ranks, 'bastion', stars)).toBeNull(); // 0 stars left
    expect(workshopStarsSpent(ranks)).toBe(3);
  });

  it('sanitizes saved ranks', () => {
    expect(sanitizeRanks({ treasury: 9, bogus: 2, bastion: -1, storm: 1.7 })).toEqual({ treasury: 2, storm: 1 });
    expect(sanitizeRanks('x')).toEqual({});
  });

  it('every upgrade has a cost and text per rank', () => {
    for (const def of WORKSHOP_UPGRADES) {
      expect(def.rankText).toHaveLength(def.costs.length);
      for (const c of def.costs) expect(c).toBeGreaterThan(0);
    }
    // The whole tree fits within the campaign's stars (3 per island).
    expect(workshopTotalCost()).toBeLessThanOrEqual(LEVELS.length * 3);
  });

  it('total power stays modest when everything is maxed', () => {
    const m = workshopModifiers(maxedWorkshopRanks());
    expect(m.startGoldBonus).toBeLessThanOrEqual(30);
    expect(m.killGoldMul).toBeLessThanOrEqual(1.05);
    expect(m.bonusLives).toBeLessThanOrEqual(2);
    expect(m.abilityCooldownMul).toBeGreaterThanOrEqual(0.85);
    for (const v of Object.values(m.towerFireRateMul)) expect(v).toBeLessThanOrEqual(1.03);
    // Upgrades never handicap a run.
    expect(m.enemyHpMul).toBe(1);
    expect(m.enemySpeedMul).toBe(1);
    expect(m.bannedTowers).toHaveLength(0);
  });
});

describe('star wallet + refunds', () => {
  it('available = campaign + challenge stars - spent', () => {
    const p = createDefaultProgress(4);
    p.bestStars = [3, 2, 1, 0];
    p.challengeClears[0] = ['no-frost'];
    p.workshop = { treasury: 1, bastion: 1 };
    const w = starWallet(p);
    expect(w).toEqual({ campaign: 6, challenge: 1, earned: 7, spent: 3, available: 4 });
  });

  it('a save that spends more than it earned is refunded on load, not kept negative', () => {
    const p = migrateProgress({ unlockedLevelIndex: 1, bestStars: [1], workshop: { bastion: 2, storm: 2 } }, 4);
    expect(p.workshop).toEqual({});
    expect(p.bestStars[0]).toBe(1);
    const ok = migrateProgress({ unlockedLevelIndex: 2, bestStars: [3, 3], workshop: { bastion: 2 } }, 4);
    expect(ok.workshop).toEqual({ bastion: 2 });
  });
});

describe('run modifiers in the sim', () => {
  const level = LEVELS[0];

  it('neutral modifiers reproduce the classic start', () => {
    const w = new SimWorld(level, new EventBus());
    expect(w.gold).toBe(level.startingGold);
    expect(w.lives).toBe(BALANCE.startingLives);
    expect(isNeutralRun(w.mods)).toBe(true);
    expect(isNeutralRun(NEUTRAL_RUN_MODIFIERS)).toBe(true);
  });

  it('workshop upgrades change start gold, lives and cooldowns', () => {
    const mods = workshopModifiers({ treasury: 2, bastion: 2, quickcast: 2 });
    const w = new SimWorld(level, new EventBus(), mods);
    expect(w.gold).toBe(level.startingGold + 20);
    expect(w.lives).toBe(BALANCE.startingLives + 2);
    expect(w.startingLives).toBe(22);
    expect(w.abilitySystem.getMaxCooldown('meteor')).toBeLessThan(
      new SimWorld(level, new EventBus()).abilitySystem.getMaxCooldown('meteor'),
    );
    // Stars are rated on lives lost: a perfect run with bonus lives is still exactly 3 stars.
    expect(w.computeStars()).toBe(3);
    w.lives = 19; // lost 3 of 22
    expect(w.computeStars()).toBe(2);
  });

  it('combines patches: multipliers multiply, bans union, max lives takes the lowest', () => {
    const m = combineRunModifiers(
      { killGoldMul: 1.1, bannedTowers: ['frost'], maxLives: 10 },
      { killGoldMul: 0.5, bannedTowers: ['frost', 'tesla'], maxLives: 5, towerFireRateMul: { archer: 1.02 } },
      { towerFireRateMul: { archer: 1.02 } },
    );
    expect(m.killGoldMul).toBeCloseTo(0.55);
    expect([...m.bannedTowers].sort()).toEqual(['frost', 'tesla']);
    expect(m.maxLives).toBe(5);
    expect(m.towerFireRateMul.archer).toBeCloseTo(1.0404);
  });

  it('banned towers cannot be placed and disabled abilities cannot be cast', () => {
    const w = new SimWorld(level, new EventBus(), combineRunModifiers({ bannedTowers: ['archer'], abilitiesDisabled: true }));
    let placed = false;
    for (let r = 0; r < level.rows && !placed; r++) {
      for (let c = 0; c < level.cols && !placed; c++) {
        if (w.grid.canPlaceTower(c, r)) {
          expect(w.placeTower(c, r, 'archer')).toBeNull();
          expect(w.placeTower(c, r, 'cannon')).not.toBeNull();
          placed = true;
        }
      }
    }
    expect(placed).toBe(true);
    w.startNextWave();
    expect(w.castOvercharge()).toBe(false);
    expect(w.castMeteor(0, 0)).toBe(false);
  });

  it('a modded run stays deterministic', () => {
    const mods = workshopModifiers(maxedWorkshopRanks());
    const run = (): string => {
      const w = new SimWorld(level, new EventBus(), mods);
      w.startNextWave();
      for (let i = 0; i < 60 * 40; i++) w.fixedTick(1 / 60);
      return `${w.gold}|${w.lives}|${w.enemiesKilledTotal}`;
    };
    expect(run()).toBe(run());
  });
});
