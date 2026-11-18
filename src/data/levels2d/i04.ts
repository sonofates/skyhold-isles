import { LEVEL_4 } from '../levels/level4.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i04.json';

export const I04 = campaignIsland(LEVEL_4, layout, {
  startingGold: 265,
  enemyHpScale: 1.143,
  waveHpGrowth: 0.18,
  sites: {
    '2,3': 1,
    '2,4': 2,
    '3,2': 6,
    '2,2': 0,
    '7,4': 7,
    '8,3': 8,
    '6,6': 12,
    '9,3': 13,
    '6,4': 5,
    '8,6': 14,
    '8,7': 16,
    '12,7': 18,
    '11,9': 17,
    '12,9': 19,
    '8,9': 15,
    '9,4': 9,
    '11,7': 11,
  },
});
