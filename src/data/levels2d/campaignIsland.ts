import type { EnemyType } from '../../core/types.ts';
import { ENEMY_DEFS } from '../enemies.ts';
import type { LevelDef, ScriptedBuildAction, WaveGroupDef } from '../levels/types.ts';
import { gridSizeFor, parseLevel2D, type Level2DJson } from './loader.ts';

interface FlyingGroupTuning {
  hpScale?: number;
  countScale?: number;
  intervalScale?: number;
}

interface PlotTuning {
  startingGold: number;
  enemyHpScale: number;
  waveHpGrowth: number;
  hexRadius?: number;
  waves?: LevelDef['waves'];
  /** Final formation values on the painted route, keyed by wave name and enemy type. */
  formations?: Readonly<Record<string, Partial<Record<EnemyType, Partial<Omit<WaveGroupDef, 'enemyType'>>>>>>;
  flyingGroups?: FlyingGroupTuning;
  /** Campaign build site "col,row" → index in the baked layout's plots. */
  sites: Readonly<Record<string, number>>;
}

/** Adjust only the air formations on this painted route, after any named-wave overrides. */
function tuneFlyingGroups(
  waves: LevelDef['waves'],
  { hpScale, countScale = 1, intervalScale = 1 }: FlyingGroupTuning,
): LevelDef['waves'] {
  return waves.map(wave => ({
    ...wave,
    groups: wave.groups.map(group => ENEMY_DEFS[group.enemyType].flying
      ? {
          ...group,
          ...(hpScale === undefined ? {} : { hpScale }),
          count: Math.max(1, Math.round(group.count * countScale)),
          spawnInterval: group.spawnInterval * intervalScale,
        }
      : group),
  }));
}

/** Override a formation on the painted island. Unspecified fields come from the source wave. */
export function replaceWaveEnemy(
  level: Pick<LevelDef, 'waves'>, waveName: string, from: EnemyType, to: EnemyType,
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
  const { sites, flyingGroups, formations, waves = source.waves, ...balance } = tuning;
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

  const paintedWaves = flyingGroups ? tuneFlyingGroups(waves, flyingGroups) : waves;
  return {
    ...source,
    ...gridSizeFor(layout2d),
    id: json.id,
    pathWaypoints: [],
    extraGroundPaths: [],
    flightPath: [],
    layout2d,
    ...balance,
    waves: formations ? paintedWaves.map(wave => {
      const changes = formations[wave.name ?? ''];
      return changes ? { ...wave, groups: wave.groups.map(g => ({ ...g, ...changes[g.enemyType] })) } : wave;
    }) : paintedWaves,
    scriptedBuildOrder: onPlots(source.scriptedBuildOrder),
    weakBuildOrder: onPlots(source.weakBuildOrder),
  };
}
