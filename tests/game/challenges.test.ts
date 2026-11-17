import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import {
  CHALLENGE_IDS,
  CHALLENGES,
  HAND_PICKED_CHALLENGE_ISLANDS,
  challengeModifiers,
  challengesForLevel,
  isChallengeId,
  runModifiersFor,
  sanitizeChallengeSelection,
} from '../../src/data/challenges.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { workshopModifiers } from '../../src/data/workshop.ts';
import { applyWin, isIslandMastered, starWallet, summarizeProgress } from '../../src/game/progression.ts';
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

  it('every island has a hand-picked pair; extra ids are only the known CONTENT islands', () => {
    const known = new Set(LEVELS.map((l) => l.id));
    for (const level of LEVELS) expect(HAND_PICKED_CHALLENGE_ISLANDS, level.id).toContain(level.id);
    const pending = HAND_PICKED_CHALLENGE_ISLANDS.filter((id) => !known.has(id));
    // Islands authored on the CONTENT branch; once merged they are real levels (pending shrinks).
    for (const id of pending) {
      expect(['amberstone-mesa', 'moonwell-crossing', 'emberglass-sanctum']).toContain(id);
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

describe('mastery', () => {
  it('needs 3 stars and every offered challenge', () => {
    const p = createDefaultProgress(LEVELS.length);
    const offered = challengesForLevel(LEVELS[0]);
    applyWin(p, 0, LEVELS.length, 3, 20, [offered[0]]);
    expect(isIslandMastered(p, 0, offered)).toBe(false);
    applyWin(p, 0, LEVELS.length, 1, 3, [offered[1]]);
    expect(isIslandMastered(p, 0, offered)).toBe(true);
    const q = createDefaultProgress(LEVELS.length);
    applyWin(q, 0, LEVELS.length, 2, 12, [...offered]);
    expect(isIslandMastered(q, 0, offered)).toBe(false);
  });
});

describe('logbook summary', () => {
  it('counts stars, badges, mastery, clears and the best endless island', () => {
    const p = createDefaultProgress(LEVELS.length);
    expect(summarizeProgress(p)).toMatchObject({ campaignStars: 0, badges: 0, mastered: 0, cleared: 0, bestEndless: 0, bestEndlessIsland: null });
    const offered = challengesForLevel(LEVELS[0]);
    applyWin(p, 0, LEVELS.length, 3, 20, [...offered]);
    applyWin(p, 1, LEVELS.length, 2, 12);
    p.bestEndlessWaves[1] = 21;
    const sum = summarizeProgress(p);
    expect(sum.campaignStars).toBe(5);
    expect(sum.badges).toBe(2);
    expect(sum.badgesMax).toBe(LEVELS.length * 2);
    expect(sum.mastered).toBe(1);
    expect(sum.cleared).toBe(2);
    expect(sum.totalWins).toBe(2);
    expect(sum.bestEndless).toBe(21);
    expect(sum.bestEndlessIsland).toBe(LEVELS[1].name);
  });
});
