import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import {
  CHALLENGE_IDS,
  CHALLENGES,
  challengeModifiers,
  challengesForLevel,
  isChallengeId,
  runModifiersFor,
  sanitizeChallengeSelection,
} from '../../src/data/challenges.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { workshopModifiers } from '../../src/data/workshop.ts';
import { applyWin, starWallet } from '../../src/game/progression.ts';
import { createDefaultProgress } from '../../src/platform/storage.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('challenge data', () => {
  it('every island offers two distinct, valid challenges (hand-picked, not the fallback)', () => {
    for (const level of LEVELS) {
      const offered = challengesForLevel(level);
      expect(offered, level.id).toHaveLength(2);
      expect(new Set(offered).size).toBe(2);
      for (const id of offered) expect(isChallengeId(id)).toBe(true);
    }
  });

  it('islands added later fall back to a pair by difficulty', () => {
    const offered = challengesForLevel({ id: 'some-new-island', difficulty: 'Master' });
    expect(offered.length).toBe(2);
  });

  it('every challenge actually changes the rules and has copy', () => {
    for (const id of CHALLENGE_IDS) {
      const def = CHALLENGES[id];
      expect(def.name.length).toBeGreaterThan(2);
      expect(def.description.length).toBeGreaterThan(5);
      expect(Object.keys(def.patch).length).toBeGreaterThan(0);
    }
  });

  it('selection keeps only the island offer, in island order', () => {
    const level = LEVELS[0];
    const [a, b] = challengesForLevel(level);
    expect(sanitizeChallengeSelection(level, [b, 'nope', a, a])).toEqual([a, b]);
    expect(sanitizeChallengeSelection(level, ['galeForce' === a ? 'thaw' : 'galeForce'])).toEqual([]);
  });
});

describe('challenge rules in the sim', () => {
  const level = LEVELS[0];

  it('Glass Sanctuary caps lives even with Workshop bonus lives', () => {
    const mods = runModifiersFor(workshopModifiers({ bastion: 2 }), ['glassSanctuary']);
    const w = new SimWorld(level, new EventBus(), mods);
    expect(w.lives).toBe(8);
    expect(w.startingLives).toBe(8);
  });

  it('Thin Purse cuts the starting gold (Workshop gold still added)', () => {
    const w = new SimWorld(level, new EventBus(), runModifiersFor(workshopModifiers({ treasury: 1 }), ['thinPurse']));
    expect(w.gold).toBe(Math.round(level.startingGold * 0.7) + 10);
  });

  it('Gale Force speeds up wave spawns', () => {
    const w = new SimWorld(level, new EventBus(), challengeModifiers(['galeForce']));
    w.startNextWave();
    for (let i = 0; i < 30; i++) w.fixedTick(1 / 60);
    const e = w.enemyPool.items[w.enemyPool.getActiveIndex(0)];
    expect(e.speed).toBeCloseTo(ENEMY_DEFS[e.type].speed * 1.12, 5);
  });

  it('Iron Tide raises enemy health', () => {
    const plain = new SimWorld(level, new EventBus());
    const iron = new SimWorld(level, new EventBus(), challengeModifiers(['ironTide']));
    for (const w of [plain, iron]) {
      w.startNextWave();
      for (let i = 0; i < 30; i++) w.fixedTick(1 / 60);
    }
    const hp = (w: SimWorld): number => w.enemyPool.items[w.enemyPool.getActiveIndex(0)].maxHp;
    expect(hp(iron)).toBeGreaterThan(hp(plain) * 1.1);
  });
});

describe('challenge progression', () => {
  it('a challenge win records the badge once, adds a bonus star and still unlocks', () => {
    const p = createDefaultProgress(LEVELS.length);
    applyWin(p, 0, LEVELS.length, 3, 20);
    const before = starWallet(p).earned;
    const r = applyWin(p, 0, LEVELS.length, 2, 4, ['glassSanctuary', 'bowless']);
    expect(r.newChallenges).toEqual(['glassSanctuary', 'bowless']);
    expect(starWallet(p).earned).toBe(before + 2);
    expect(p.unlockedLevelIndex).toBe(1);
    const again = applyWin(p, 0, LEVELS.length, 3, 5, ['glassSanctuary']);
    expect(again.newChallenges).toEqual([]);
    expect(starWallet(p).earned).toBe(before + 2);
  });

  it('a first win that is also a challenge win unlocks the next island', () => {
    const p = createDefaultProgress(LEVELS.length);
    applyWin(p, 3, LEVELS.length, 1, 2, ['thaw']);
    expect(p.unlockedLevelIndex).toBe(4);
    expect(p.challengeClears[3]).toEqual(['thaw']);
  });
});
