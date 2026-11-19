import { LEVEL_6 } from '../levels/level6.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i06.json';

export const I06 = campaignIsland(LEVEL_6, layout, {
  startingGold: 280,
  enemyHpScale: 1.3623,
  waveHpGrowth: 0.306,
  sites: {
    '3,3': 6,
    '5,2': 4,
    '8,3': 20,
    '11,4': 14,
    '6,2': 12,
    '9,6': 5,
    '11,8': 19,
    '10,2': 23,
    '10,8': 22,
    '8,9': 13,
    '11,2': 15,
    '13,5': 16,
    '6,1': 0,
    '13,6': 17,
    '3,5': 9,
    '12,4': 21,
    '10,1': 8,
  },
});
