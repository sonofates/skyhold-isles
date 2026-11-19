import { LEVEL_3 } from '../levels/level3.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i03.json';

export const I03 = campaignIsland(LEVEL_3, layout, {
  startingGold: 280,
  enemyHpScale: 1.6232,
  waveHpGrowth: 0.18,
  sites: {
    '4,3': 2,
    '3,4': 0,
    '3,6': 16,
    '5,6': 15,
    '5,7': 19,
    '2,5': 1,
    '8,4': 14,
    '6,6': 3,
    '10,6': 13,
    '8,8': 21,
    '3,7': 17,
    '5,8': 18,
    '7,6': 20,
    '11,4': 5,
    '8,6': 12,
    '6,3': 4,
    '10,7': 8,
  },
});
