import { LEVEL_14 } from '../levels/level14.ts';
import { campaignIsland, replaceWaveEnemy } from './campaignIsland.ts';
import layout from './i14.json';

export const I14 = campaignIsland(LEVEL_14, layout, {
  // The pipers follow the golems through the same gate, entering one at a time behind the column.
  waves: replaceWaveEnemy(LEVEL_14, 'Salt Wind', 'healer', 'reedpiper', {
    lane: 2, startDelay: 5.6, spawnInterval: 2.4,
  }),
  startingGold: 295,
  enemyHpScale: 3.2809,
  waveHpGrowth: 0.0768,
  flyingGroups: { hpScale: 0.55, intervalScale: 1.2 },
  sites: {
    '9,7': 8,
    '12,7': 20,
    '8,3': 10,
    '3,9': 2,
    '12,5': 21,
    '13,7': 15,
    '8,4': 13,
    '13,11': 16,
    '13,5': 22,
    '13,9': 19,
    '11,7': 12,
    '4,0': 9,
    '10,3': 11,
    '2,12': 1,
    '8,7': 5,
    '4,2': 7,
    '2,10': 0,
    '13,10': 14,
    '1,10': 3,
    '14,3': 23,
    '6,3': 6,
    '5,10': 4,
    '11,3': 18,
    '13,8': 17,
  },
});
