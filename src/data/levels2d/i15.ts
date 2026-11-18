import { LEVEL_15 } from '../levels/level15.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i15.json';

export const I15 = campaignIsland(LEVEL_15, layout, {
  startingGold: 360,
  enemyHpScale: 2.345,
  waveHpGrowth: 0.08,
  sites: {
    '6,3': 3,
    '5,4': 24,
    '6,4': 15,
    '11,8': 5,
    '7,4': 6,
    '10,8': 4,
    '11,9': 7,
    '4,3': 25,
    '2,7': 8,
    '1,4': 22,
    '12,9': 12,
    '9,3': 17,
    '14,10': 9,
    '14,1': 19,
    '10,9': 18,
    '10,3': 2,
    '13,3': 16,
    '13,1': 23,
    '1,3': 21,
    '14,8': 10,
    '11,11': 11,
    '1,5': 0,
    '14,4': 13,
    '7,8': 20,
  },
});
