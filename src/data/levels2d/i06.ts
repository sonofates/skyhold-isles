import { LEVEL_6 } from '../levels/level6.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i06.json';

export const I06 = campaignIsland(LEVEL_6, layout, {
  startingGold: 280,
  enemyHpScale: 1.23,
  waveHpGrowth: 0.18,
  sites: {
    '3,3': 2,
    '5,2': 4,
    '8,3': 9,
    '11,4': 10,
    '6,2': 7,
    '9,6': 3,
    '11,8': 18,
    '10,2': 23,
    '10,8': 20,
    '8,9': 19,
    '11,2': 11,
    '13,5': 13,
    '6,1': 8,
    '13,6': 12,
    '3,5': 1,
    '12,4': 21,
    '10,1': 6,
  },
});
