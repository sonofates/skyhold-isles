import { LEVEL_13 } from '../levels/level13.ts';
import type { ScriptedBuildAction } from '../levels/types.ts';
import { campaignIsland, replaceWaveEnemy } from './campaignIsland.ts';
import layout from './i13.json';

const causeway = campaignIsland(LEVEL_13, layout, {
  // Let the main-road raiders draw fire before the hares sprint down the northern shortcut.
  waves: replaceWaveEnemy(LEVEL_13, 'North Road', 'mite', 'bellrunner', {
    count: 4, startDelay: 3.6, spawnInterval: 1,
  }),
  startingGold: 360,
  enemyHpScale: 1.82,
  waveHpGrowth: 0.095,
  sites: {
    '11,7': 4,
    '12,8': 23,
    '8,8': 6,
    '9,4': 27,
    '7,6': 8,
    '14,8': 7,
    '10,10': 10,
    '9,7': 18,
    '12,6': 9,
    '6,8': 5,
    '12,4': 17,
    '15,5': 19,
    '6,4': 22,
    '13,10': 20,
    '4,8': 24,
    '10,8': 2,
    '7,10': 12,
    '14,4': 1,
    '3,10': 3,
    '8,6': 25,
    '11,4': 0,
    '15,9': 16,
    '15,6': 14,
    '15,3': 26,
  },
});

// Repurpose two ground cannons near the southern sea approach (p6, p5) into anti-air towers.
const retune = (order: readonly ScriptedBuildAction[] = []): ScriptedBuildAction[] =>
  order.map((a) => {
    if (a.action === 'build' && a.col === 6) return { ...a, towerType: 'archer' };
    if (a.action === 'build' && a.col === 5) return { ...a, towerType: 'tesla' };
    return a;
  });

export const I13 = {
  ...causeway,
  scriptedBuildOrder: retune(causeway.scriptedBuildOrder),
  weakBuildOrder: retune(causeway.weakBuildOrder),
};
