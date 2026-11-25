/**
 * Chapter four, islands i28–i30 (docs/handoff-ch4-waves-1.md): where the Rime Beetle enters the
 * story waves, the wave card's "New" tag for it, and that its frost patch costs the greedy script
 * real fire time. The Normal campaign windows for these islands run in chapterEnemies.test.ts
 * (`evaluateBalance`, which also enforces the frost band) and in `npm run sim:difficulty`.
 */
import { describe, expect, it } from 'vitest';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { campaignKit } from '../../scripts/lib/campaignKit.ts';
import { balanceBuildOrder } from '../../scripts/lib/specializationBuilds.ts';
import { CHAPTER4_ENEMY_DEFS, CHAPTER4_ENEMY_TYPES } from '../../src/data/enemies.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { getLevelById, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { FoesSeen, seenFromCleared, waveTypes } from '../../src/render2d/ui/newFoes2d.ts';

const island = (id: string): LevelDef => getLevelById(id)!;
const beetleWaves = (level: LevelDef): number[] =>
  level.waves.flatMap((w, i) => (w.groups.some(g => g.enemyType === 'rimebeetle') ? [i] : []));
const chapterFourFoes = (level: LevelDef): Set<string> =>
  new Set(level.waves.flatMap(w => w.groups.map(g => g.enemyType)).filter(t => (CHAPTER4_ENEMY_TYPES as readonly string[]).includes(t)));
/** The seen-foe seed of a player who cleared every island before `id` (main2d.ts does the same). */
const seedBefore = (id: string) => {
  const at = LEVELS_2D.findIndex(l => l.id === id);
  return seenFromCleared(LEVELS_2D, i => i < at);
};

describe('chapter four waves, i28–i30', () => {
  it('keep 13 waves; i28 opens without new foes, i29 and i30 field only the Rime Beetle', () => {
    for (const id of ['i28', 'i29', 'i30']) expect(island(id).waves).toHaveLength(13);
    expect(chapterFourFoes(island('i28')).size).toBe(0);
    expect([...chapterFourFoes(island('i29'))]).toEqual(['rimebeetle']);
    expect([...chapterFourFoes(island('i30'))]).toEqual(['rimebeetle']);
  });

  it('i29 introduces the beetle on wave 2 out of the east boathouse, then brings it back a few times', () => {
    const level = island('i29');
    const waves = beetleWaves(level);
    expect(waves[0]).toBe(1);
    const first = level.waves[1].groups.find(g => g.enemyType === 'rimebeetle')!;
    const entrances = level.layout2d!.entrances;
    const east = entrances.reduce((best, e, lane) => (e.x > entrances[best].x ? lane : best), 0);
    expect(first.lane ?? 0).toBe(east);
    // A small file: the wave is not built around the newcomer.
    expect(first.count).toBeLessThanOrEqual(5);
    expect(waves.length).toBeGreaterThanOrEqual(4);
    expect(waves.length).toBeLessThan(level.waves.length / 2);
  });

  it('i30 uses the beetle as a regular threat, always mixed with the older roster', () => {
    const level = island('i30');
    const waves = beetleWaves(level);
    expect(waves.length).toBeGreaterThanOrEqual(level.waves.length / 2);
    for (const i of waves) expect(waveTypes(level, i).length).toBeGreaterThanOrEqual(3);
    // Both lanes see beetles over the island.
    const lanes = new Set(waves.flatMap(i => level.waves[i].groups.filter(g => g.enemyType === 'rimebeetle').map(g => g.lane ?? 0)));
    expect(lanes.size).toBe(2);
  });

  it('the wave card tags the beetle "New" on i29’s wave 2 only, and never on i30 after clearing i29', () => {
    const level = island('i29');
    const seed = seedBefore('i29');
    expect(seed.has('rimebeetle')).toBe(false);
    const seen = new FoesSeen(seed);
    expect(waveTypes(level, 0).filter(t => !seen.has(t))).toEqual([]);
    expect(waveTypes(level, 1).filter(t => !seen.has(t))).toEqual(['rimebeetle']);
    // Marching it records it (the bestiary toast fires once); later waves show no tag.
    expect(seen.mark(waveTypes(level, 1))).toEqual(['rimebeetle']);
    for (let w = 2; w < level.waves.length; w++) expect(waveTypes(level, w).filter(t => !seen.has(t))).toEqual([]);
    const ridge = island('i30');
    const veteran = new FoesSeen(seedBefore('i30'));
    for (let w = 0; w < ridge.waves.length; w++) expect(waveTypes(ridge, w).filter(t => !veteran.has(t))).toEqual([]);
  });

  it('beetle deaths slow the campaign-kit greedy towers on i29’s wave 2, and nothing is slowed before', () => {
    const level = island('i29');
    // About the hero XP and Workshop stars a player brings to i29 (sim:balance entry: 17,304 XP, 67 stars).
    const res = runLevelBalanceSim(level, 'greedy', balanceBuildOrder(level, 'greedy'), campaignKit(17_000, 66));
    const [w1, w2] = res.waves;
    expect(w1.frost.lostSec).toBe(0);
    expect(w2.frost.lostSec).toBeGreaterThan(0);
    expect(w2.frost.slowedSec).toBeGreaterThan(w2.frost.lostSec);
    // A patch slows by 40% (rateMul 0.6), never more: overlapping patches do not stack.
    expect(CHAPTER4_ENEMY_DEFS.rimebeetle.ability.rateMul).toBe(0.6);
    expect(w2.frost.lostSec).toBeCloseTo(w2.frost.slowedSec * 0.4, 6);
  }, 30_000);
});
