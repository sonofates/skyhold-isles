import { LEVEL_13 } from '../levels/level13.ts';
import { campaignIsland, replaceWaveEnemy } from './campaignIsland.ts';
import layout from './i13.json';

const downpour = replaceWaveEnemy(LEVEL_13, 'Downpour', 'flyer', 'flyer', { count: 18 });

export const I13 = campaignIsland(LEVEL_13, layout, {
  // Let the main-road raiders draw fire before the hares sprint down the northern shortcut.
  waves: replaceWaveEnemy({ waves: downpour }, 'North Road', 'mite', 'bellrunner', {
    count: 4, startDelay: 3.6, spawnInterval: 1,
  }),
  startingGold: 360,
  enemyHpScale: 1.96,
  waveHpGrowth: 0.49,
  waveCount: 12,
  flyingGroups: { hpScale: 0.26 },
  sites: {
    '11,7': 4,
    '12,8': 21,
    '8,8': 0,
    '9,4': 26,
    '7,6': 8,
    '14,8': 7,
    '10,10': 10,
    '9,7': 18,
    '12,6': 5,
    '6,8': 23,
    '12,4': 2,
    '15,5': 19,
    '6,4': 22,
    '13,10': 20,
    '4,8': 24,
    '10,8': 17,
    '7,10': 12,
    '14,4': 1,
    '3,10': 3,
    '8,6': 25,
    '11,4': 6,
    '15,9': 16,
    '15,6': 14,
    '15,3': 27,
  },
});
