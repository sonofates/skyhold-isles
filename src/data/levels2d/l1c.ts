import type { TargetingMode, TowerType } from '../../core/types.ts';
import type { LevelDef, ScriptedBuildAction } from '../levels/types.ts';
import { gridSizeFor, parseLevel2D, type Level2DJson } from './loader.ts';
import l1cJson from './l1c.json';

/**
 * L1c "Meadow Crossing" — P0 2D vertical-slice island (plot map, side entry; not part of the
 * 16-island campaign). Lane 0 = entrance A (top-left, the long road), lane 1 = entrance B
 * (mid-left), merging into the shared road to the gate. Balance is tuned to the current trace;
 * re-run `npm run sim:balance -- --levels=l1c` whenever the trace changes.
 */
const LAYOUT = parseLevel2D(l1cJson as Level2DJson);
const GRID = gridSizeFor(LAYOUT);

const build = (waveIndex: number, plot: number, towerType: TowerType, targetingMode?: TargetingMode): ScriptedBuildAction => ({
  waveIndex,
  action: 'build',
  col: plot,
  row: 0,
  towerType,
  ...(targetingMode ? { targetingMode } : {}),
});
const upgrade = (waveIndex: number, plot: number): ScriptedBuildAction => ({
  waveIndex,
  action: 'upgrade',
  col: plot,
  row: 0,
});

export const LEVEL_L1C: LevelDef = {
  id: 'l1c',
  index: 100,
  name: 'Meadow Crossing',
  subtitle: 'Two raider gates, one road to the keep',
  difficulty: 'Breezy',
  cols: GRID.cols,
  rows: GRID.rows,
  layout: GRID.layout,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 2026,
  startingGold: 200,
  enemyHpScale: 1.38,
  waveHpGrowth: 0.13,
  layout2d: LAYOUT,
  waves: [
    {
      name: 'Welcome Party',
      clearBonus: 12,
      groups: [{ enemyType: 'grunt', count: 8, spawnInterval: 1.05, startDelay: 0, lane: 0 }],
    },
    {
      name: 'Second Gate',
      clearBonus: 15,
      groups: [
        { enemyType: 'grunt', count: 6, spawnInterval: 1.0, startDelay: 0, lane: 0 },
        { enemyType: 'grunt', count: 6, spawnInterval: 1.0, startDelay: 3, lane: 1 },
      ],
    },
    {
      name: 'Zephyr Dash',
      clearBonus: 18,
      groups: [
        { enemyType: 'grunt', count: 8, spawnInterval: 0.9, startDelay: 0, lane: 0 },
        { enemyType: 'runner', count: 8, spawnInterval: 0.7, startDelay: 2.5, lane: 1 },
      ],
    },
    {
      name: 'Iron Knock',
      clearBonus: 20,
      groups: [
        { enemyType: 'grunt', count: 10, spawnInterval: 0.8, startDelay: 0, lane: 0 },
        { enemyType: 'brute', count: 3, spawnInterval: 1.8, startDelay: 3, lane: 1 },
      ],
    },
    {
      name: 'First Flight',
      clearBonus: 24,
      groups: [
        { enemyType: 'grunt', count: 8, spawnInterval: 0.8, startDelay: 0, lane: 1 },
        { enemyType: 'flyer', count: 6, spawnInterval: 1.0, startDelay: 2 },
      ],
    },
    {
      name: 'Iron Parade',
      clearBonus: 26,
      groups: [
        { enemyType: 'brute', count: 5, spawnInterval: 1.5, startDelay: 0, lane: 0 },
        { enemyType: 'runner', count: 10, spawnInterval: 0.6, startDelay: 3, lane: 1 },
      ],
    },
    {
      name: 'Gull Squadron',
      clearBonus: 30,
      groups: [
        { enemyType: 'flyer', count: 10, spawnInterval: 0.7, startDelay: 0 },
        { enemyType: 'grunt', count: 10, spawnInterval: 0.7, startDelay: 1.5, lane: 0 },
        { enemyType: 'grunt', count: 8, spawnInterval: 0.75, startDelay: 3, lane: 1 },
      ],
    },
    {
      name: 'Rush Hour',
      clearBonus: 34,
      groups: [
        { enemyType: 'brute', count: 4, spawnInterval: 1.5, startDelay: 0, lane: 1 },
        { enemyType: 'runner', count: 12, spawnInterval: 0.55, startDelay: 2, lane: 0 },
        { enemyType: 'grunt', count: 8, spawnInterval: 0.75, startDelay: 5, lane: 1 },
      ],
    },
    {
      name: 'Gathering Storm',
      clearBonus: 38,
      groups: [
        { enemyType: 'grunt', count: 16, spawnInterval: 0.55, startDelay: 0, lane: 0 },
        { enemyType: 'flyer', count: 10, spawnInterval: 0.7, startDelay: 1.5 },
        { enemyType: 'brute', count: 6, spawnInterval: 1.1, startDelay: 3.5, lane: 1 },
      ],
    },
    {
      name: 'The Long March',
      clearBonus: 60,
      groups: [
        { enemyType: 'brute', count: 6, spawnInterval: 1.2, startDelay: 0, lane: 0 },
        { enemyType: 'brute', count: 5, spawnInterval: 1.3, startDelay: 1, lane: 1 },
        { enemyType: 'runner', count: 16, spawnInterval: 0.45, startDelay: 3, lane: 1 },
        { enemyType: 'flyer', count: 12, spawnInterval: 0.65, startDelay: 5 },
      ],
    },
  ],
  // Plots: 0-3 top row, 4-6 upper-left, 7-9 upper-right, 10-11 between the lanes, 12-15 bottom row.
  // Barracks: plot 14 rallies on the shared final road, plot 12 at the merge (both lanes pass).
  // The pre-barracks scripts are kept as L1C_SCRIPTS_NO_BARRACKS for the on/off comparison.
  scriptedBuildOrder: [
    build(0, 11, 'archer'),
    build(0, 6, 'archer'),
    build(0, 13, 'cannon'),
    build(1, 10, 'archer'),
    upgrade(1, 11),
    build(2, 7, 'tesla'),
    upgrade(3, 6),
    build(3, 14, 'barracks'),
    upgrade(4, 13),
    build(4, 5, 'archer'),
    upgrade(5, 10),
    build(5, 8, 'tesla'),
    upgrade(6, 7),
    build(6, 12, 'barracks'),
    upgrade(7, 11),
    build(7, 15, 'cannon'),
    upgrade(8, 14),
    upgrade(8, 8),
    upgrade(9, 13),
    upgrade(9, 6),
  ],
  weakBuildOrder: [
    build(0, 11, 'archer'),
    build(0, 6, 'archer'),
    build(0, 13, 'cannon'),
    build(1, 10, 'archer'),
    upgrade(2, 11),
    build(2, 7, 'tesla'),
    upgrade(3, 6),
    build(4, 14, 'barracks'),
    upgrade(4, 13),
    upgrade(5, 10),
    upgrade(6, 7),
    build(6, 5, 'archer'),
    upgrade(7, 11),
    upgrade(8, 14),
  ],
};

/**
 * L1c build scripts before the barracks existed (cannon on plot 14, archer on plot 12). Used by
 * `scripts/barracksCompare.ts` to report barracks on/off; not part of the balance gate.
 */
export const L1C_SCRIPTS_NO_BARRACKS: {
  readonly greedy: readonly ScriptedBuildAction[];
  readonly weak: readonly ScriptedBuildAction[];
} = {
  greedy: (LEVEL_L1C.scriptedBuildOrder ?? []).map((a) =>
    a.action === 'build' && a.towerType === 'barracks'
      ? { ...a, towerType: a.col === 14 ? 'cannon' : 'archer' }
      : a,
  ),
  weak: (LEVEL_L1C.weakBuildOrder ?? []).map((a) =>
    a.action === 'build' && a.towerType === 'barracks' ? { ...a, towerType: 'cannon' } : a,
  ),
};
