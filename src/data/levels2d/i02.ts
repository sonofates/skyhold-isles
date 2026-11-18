import { LEVEL_2 } from '../levels/level2.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i02.json';

export const I02 = campaignIsland(LEVEL_2, layout, {
  startingGold: 300,
  enemyHpScale: 1.736,
  waveHpGrowth: 0.162,
  sites: {
    '2,3': 2,
    '4,5': 3,
    '2,5': 14,
    '5,8': 13,
    '5,5': 4,
    '4,3': 1,
    '11,5': 11,
    '5,6': 15,
    '3,8': 17,
    '10,6': 5,
    '11,6': 12,
    '7,9': 18,
    '9,8': 9,
  },
});
