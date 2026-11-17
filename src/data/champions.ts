import type { EnemyType } from '../core/types.ts';
import type { LevelDef, WaveDef } from './levels/types.ts';

/** Bosses and colossi are already set pieces: Champion Host never empowers them. */
const NEVER_CHAMPION: ReadonlySet<EnemyType> = new Set<EnemyType>(['boss', 'tempest']);

/**
 * Champion Host: in every story wave the group with the most foes (ties → the earliest) arrives
 * Empowered, unless the wave already has an elite group. Pure: returns a new level object with
 * rewritten waves (the shared level data is never mutated); the HUD wave preview reads the same
 * wave defs, so it marks the champions too.
 */
export function championWave(wave: WaveDef): WaveDef {
  if (wave.groups.some((g) => g.elite)) return wave;
  let pick = -1;
  for (let i = 0; i < wave.groups.length; i++) {
    const g = wave.groups[i];
    if (NEVER_CHAMPION.has(g.enemyType)) continue;
    if (pick < 0 || g.count > wave.groups[pick].count) pick = i;
  }
  if (pick < 0) return wave;
  return { ...wave, groups: wave.groups.map((g, i) => (i === pick ? { ...g, elite: true } : g)) };
}

export function championLevel(level: LevelDef): LevelDef {
  return { ...level, waves: level.waves.map(championWave) };
}
