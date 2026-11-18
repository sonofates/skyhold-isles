import { LEVEL_10 } from '../levels/level10.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i10.json';

export const I10 = campaignIsland(LEVEL_10, layout, {
  startingGold: 360,
  enemyHpScale: 0.9575,
  waveHpGrowth: 0.2,
  sites: {
    '9,8': 13,
    '5,8': 10,
    '9,9': 4,
    '11,6': 14,
    '4,4': 9,
    '7,8': 3,
    '11,8': 23,
    '13,4': 20,
    '7,5': 11,
    '12,6': 18,
    '9,4': 15,
    '2,8': 8,
    '13,7': 24,
    '7,9': 2,
    '5,6': 5,
    '11,4': 17,
    '8,2': 16,
    '15,6': 21,
    '3,9': 1,
    '8,11': 12,
    '2,5': 7,
    '12,9': 22,
    '9,6': 19,
  },
});
