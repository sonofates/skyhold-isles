import type { LevelDef, ScriptedBuildAction } from '../levels/types.ts';
import { gridSizeFor, parseLevel2D, type Level2DJson } from './loader.ts';

interface PlotTuning {
  startingGold: number;
  enemyHpScale: number;
  waveHpGrowth: number;
  /** Campaign build site "col,row" → index in the baked layout's plots. */
  sites: Readonly<Record<string, number>>;
}

/** Keep each campaign purchase, upgrade and targeting order on the corresponding painted plot. */
export function campaignIsland(source: LevelDef, json: Level2DJson, tuning: PlotTuning): LevelDef {
  const layout2d = parseLevel2D(json);
  function onPlots(actions: readonly ScriptedBuildAction[] = []): ScriptedBuildAction[] {
    return actions.map((action) => {
      const site = `${action.col},${action.row}`;
      const col = tuning.sites[site];
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
    startingGold: tuning.startingGold,
    enemyHpScale: tuning.enemyHpScale,
    waveHpGrowth: tuning.waveHpGrowth,
    scriptedBuildOrder: onPlots(source.scriptedBuildOrder),
    weakBuildOrder: onPlots(source.weakBuildOrder),
  };
}
