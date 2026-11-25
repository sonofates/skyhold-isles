/**
 * Chapter five, islands i37–i39 (docs/handoff-ch5-waves-1.md): where the Dusk Hound enters the story
 * waves, that every pack is tight enough for its enrage to trigger, the wave card's "New" tag, and
 * that the campaign-kit greedy script really sets packs howling. The Normal campaign windows for these
 * islands run in chapterEnemies.test.ts (`evaluateBalance`) and in `npm run sim:difficulty`.
 */
import { describe, expect, it } from 'vitest';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { campaignKit } from '../../scripts/lib/campaignKit.ts';
import { balanceBuildOrder } from '../../scripts/lib/specializationBuilds.ts';
import { CHAPTER5_ENEMY_DEFS, CHAPTER5_ENEMY_TYPES } from '../../src/data/enemies.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { getLevelById, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { FoesSeen, seenFromCleared, waveTypes } from '../../src/render2d/ui/newFoes2d.ts';

const island = (id: string): LevelDef => getLevelById(id)!;
const houndGroups = (level: LevelDef) => level.waves.flatMap(w => w.groups.filter(g => g.enemyType === 'duskhound'));
const houndWaves = (level: LevelDef): number[] =>
  level.waves.flatMap((w, i) => (w.groups.some(g => g.enemyType === 'duskhound') ? [i] : []));
const chapterFiveFoes = (level: LevelDef): Set<string> =>
  new Set(level.waves.flatMap(w => w.groups.map(g => g.enemyType)).filter(t => (CHAPTER5_ENEMY_TYPES as readonly string[]).includes(t)));
/** The seen-foe seed of a player who cleared every island before `id` (main2d.ts does the same). */
const seedBefore = (id: string) => {
  const at = LEVELS_2D.findIndex(l => l.id === id);
  return seenFromCleared(LEVELS_2D, i => i < at);
};

describe('chapter five waves, i37–i39', () => {
  it('keep 14 waves; i37 opens without new foes, i38 and i39 field only the Dusk Hound', () => {
    for (const id of ['i37', 'i38', 'i39']) expect(island(id).waves).toHaveLength(14);
    expect(chapterFiveFoes(island('i37')).size).toBe(0);
    expect([...chapterFiveFoes(island('i38'))]).toEqual(['duskhound']);
    expect([...chapterFiveFoes(island('i39'))]).toEqual(['duskhound']);
  });

  it('every hound group is one pack: 4–6 hounds, close enough that a kill enrages the rest', () => {
    const pack = CHAPTER5_ENEMY_DEFS.duskhound.ability;
    for (const id of ['i38', 'i39']) {
      for (const g of houndGroups(island(id))) {
        expect(g.count).toBeGreaterThanOrEqual(4);
        expect(g.count).toBeLessThanOrEqual(6);
        // First to last hound on the road, at walking speed, well inside the enrage radius.
        const spread = g.spawnInterval * (g.count - 1) * CHAPTER5_ENEMY_DEFS.duskhound.speed;
        expect(spread).toBeLessThan(pack.radius / 2);
      }
    }
  });

  it('i38 introduces the hound on wave 2 as two five-strong packs, then brings packs back a few times', () => {
    const level = island('i38');
    const waves = houndWaves(level);
    expect(waves[0]).toBe(1);
    const intro = level.waves[1].groups.filter(g => g.enemyType === 'duskhound');
    expect(intro.map(g => g.count)).toEqual([5, 5]);
    expect(waves.length).toBeGreaterThanOrEqual(4);
    expect(waves.length).toBeLessThan(level.waves.length / 2);
  });

  it('i39 uses packs as a regular threat on both lanes, always mixed with the older roster', () => {
    const level = island('i39');
    const waves = houndWaves(level);
    expect(waves.length).toBeGreaterThanOrEqual(level.waves.length / 2);
    for (const i of waves) expect(waveTypes(level, i).filter(t => t !== 'duskhound').length).toBeGreaterThanOrEqual(1);
    // Most hound waves bring at least two older groups along.
    expect(waves.filter(i => waveTypes(level, i).length >= 3).length).toBeGreaterThan(waves.length / 2);
    const lanes = new Set(waves.flatMap(i => level.waves[i].groups.filter(g => g.enemyType === 'duskhound').map(g => g.lane ?? 0)));
    expect(lanes).toEqual(new Set(level.layout2d!.paths.map((_, lane) => lane)));
  });

  it('the wave card tags the hound "New" on i38’s wave 2 only, and never on i39 after clearing i38', () => {
    const level = island('i38');
    const seed = seedBefore('i38');
    expect(seed.has('duskhound')).toBe(false);
    const seen = new FoesSeen(seed);
    expect(waveTypes(level, 0).filter(t => !seen.has(t))).toEqual([]);
    expect(waveTypes(level, 1).filter(t => !seen.has(t))).toEqual(['duskhound']);
    expect(seen.mark(waveTypes(level, 1))).toEqual(['duskhound']);
    for (let w = 2; w < level.waves.length; w++) expect(waveTypes(level, w).filter(t => !seen.has(t))).toEqual([]);
    const grove = island('i39');
    const veteran = new FoesSeen(seedBefore('i39'));
    for (let w = 0; w < grove.waves.length; w++) expect(waveTypes(grove, w).filter(t => !veteran.has(t))).toEqual([]);
  });

  it('the campaign-kit greedy script sets every i38 pack howling, and the enrage costs it hounds on wave 2', () => {
    const level = island('i38');
    // About the hero XP and Workshop stars a player brings to i38 (sim:balance entry: 21,814 XP, 79 stars).
    const res = runLevelBalanceSim(level, 'greedy', balanceBuildOrder(level, 'greedy'), campaignKit(21_800, 79));
    expect(res.outcome).toBe('won');
    expect(res.shadow.packHowls).toBeGreaterThanOrEqual(houndGroups(level).length * 3);
    // Each howl reaches more than one mate: the packs stay together.
    expect(res.shadow.houndsEnraged).toBeGreaterThan(res.shadow.packHowls * 2);
    expect(res.waves[1].leaksByType.duskhound ?? 0).toBeGreaterThan(0);
  }, 30_000);
});
