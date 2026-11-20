import type { EnemyType } from '../../core/types.ts';
import type { LevelDef, ScriptedBuildAction, WaveGroupDef } from '../levels/types.ts';
import { gridSizeFor, parseLevel2D, type Level2DJson } from './loader.ts';

interface PlotTuning {
  startingGold: number;
  enemyHpScale: number;
  waveHpGrowth: number;
  hexRadius?: number;
  waves?: LevelDef['waves'];
  /** Campaign build site "col,row" → index in the baked layout's plots. */
  sites: Readonly<Record<string, number>>;
}

/** Override a formation on the painted island. Unspecified fields come from the source wave. */
export function replaceWaveEnemy(
  level: LevelDef, waveName: string, from: EnemyType, to: EnemyType,
  formation: Partial<Omit<WaveGroupDef, 'enemyType'>> = {},
): LevelDef['waves'] {
  return level.waves.map(wave => {
    if (wave.name !== waveName) return wave;
    const groups = wave.groups.map(group => group.enemyType === from ? { ...group, ...formation, enemyType: to } : group);
    return { ...wave, groups };
  });
}

/** Keep each campaign purchase, upgrade and targeting order on the corresponding painted plot. */
export function campaignIsland(source: LevelDef, json: Level2DJson, tuning: PlotTuning): LevelDef {
  const { sites, ...balance } = tuning;
  const layout2d = parseLevel2D(json);
  function onPlots(actions: readonly ScriptedBuildAction[] = []): ScriptedBuildAction[] {
    return actions.map((action) => {
      const site = `${action.col},${action.row}`;
      const col = sites[site];
      if (!Number.isInteger(col) || !layout2d.plots[col]) {
        throw new Error(`${json.id}: missing plot for campaign site ${site}`);
      }
      return { ...action, col, row: 0 };
    });
  }

  return {
    ...source,
    ...gridSizeFor(layout2d),
    id: json.id,
    pathWaypoints: [],
    extraGroundPaths: [],
    flightPath: [],
    layout2d,
    ...balance,
    scriptedBuildOrder: onPlots(source.scriptedBuildOrder),
    weakBuildOrder: onPlots(source.weakBuildOrder),
  };
}
