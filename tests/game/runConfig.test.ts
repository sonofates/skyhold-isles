import { describe, expect, it } from 'vitest';
import { challengesForLevel, type ChallengeId } from '../../src/data/challenges.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { badgesForWin, resolveRunConfig } from '../../src/game/runConfig.ts';

const level = LEVELS[2];
const offered = challengesForLevel(level);
const foreign = (['thaw', 'quietGuns', 'bowless', 'galeForce', 'silentSkies'] as ChallengeId[]).find(
  (id) => !offered.includes(id),
)!;

describe('resolveRunConfig', () => {
  it('an uncleared island always gets a plain run', () => {
    expect(resolveRunConfig(level, false, { endless: true })).toEqual({ endless: false, challenges: [], daily: null });
    expect(resolveRunConfig(level, false, { challenges: [...offered] }).challenges).toEqual([]);
    expect(resolveRunConfig(level, false, { daily: 5, challenges: [foreign] }).daily).toBeNull();
  });

  it('campaign challenges are limited to the island offer', () => {
    const r = resolveRunConfig(level, true, { challenges: [foreign, offered[1], offered[0]] });
    expect(r).toEqual({ endless: false, challenges: [offered[0], offered[1]], daily: null });
  });

  it('endless drops challenges', () => {
    expect(resolveRunConfig(level, true, { endless: true, challenges: [...offered] })).toEqual({
      endless: true,
      challenges: [],
      daily: null,
    });
  });

  it('the daily keeps any valid challenge, deduplicated, and never runs as endless', () => {
    const r = resolveRunConfig(level, true, {
      daily: 20409,
      challenges: [foreign, foreign, 'nope' as ChallengeId, offered[0]],
    });
    expect(r).toEqual({ endless: false, challenges: [foreign, offered[0]], daily: 20409 });
    expect(resolveRunConfig(level, true, { daily: 1, endless: true }).daily).toBeNull();
  });

  it('a plain request stays plain (no leaks from defaults)', () => {
    expect(resolveRunConfig(level, true, {})).toEqual({ endless: false, challenges: [], daily: null });
  });

  it('badges are only the island own challenges', () => {
    expect(badgesForWin(offered, [foreign, offered[1]])).toEqual([offered[1]]);
  });
});
