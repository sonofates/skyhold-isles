import type { EnemyType, TargetingMode, TowerType } from '../../core/types.ts';
import type { ChapterEnemyType } from '../enemies.ts';
import type { LevelDef, ScriptedBuildAction, WaveDef, WaveGroupDef } from '../levels/types.ts';

type ChapterGroup = Omit<WaveGroupDef, 'enemyType'> & { readonly enemyType: EnemyType | ChapterEnemyType };
type ChapterWave = Omit<WaveDef, 'groups'> & { readonly groups: readonly ChapterGroup[] };
export type ChapterIsland = Omit<LevelDef, 'waves'> & { readonly waves: readonly ChapterWave[] };

export function group(enemyType: ChapterGroup['enemyType'], count: number, spawnInterval: number, startDelay = 0, lane = 0): ChapterGroup {
  return { enemyType, count, spawnInterval, startDelay, lane };
}

export function build(waveIndex: number, col: number, towerType: TowerType, targetingMode: TargetingMode = 'first'): ScriptedBuildAction {
  return { waveIndex, col, row: 0, action: 'build', towerType, targetingMode };
}

export function upgrade(waveIndex: number, col: number): ScriptedBuildAction {
  return { waveIndex, col, row: 0, action: 'upgrade' };
}
