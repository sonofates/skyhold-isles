import { LEVEL_1 } from '../levels/level1.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i01.json';

export const I01 = campaignIsland(LEVEL_1, layout, {
  startingGold: 205,
  enemyHpScale: 1.144,
  waveHpGrowth: 0.08,
  sites: {
    '4,2': 1,
    '4,3': 3,
    '7,5': 5,
    '8,5': 9,
    '10,4': 11,
    '7,3': 4,
    '5,5': 6,
    '5,7': 7,
    '10,5': 8,
    '8,7': 10,
  },
});
