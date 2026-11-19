import { LEVEL_8 } from '../levels/level8.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i08.json';

export const I08 = campaignIsland(LEVEL_8, layout, {
  startingGold: 250,
  enemyHpScale: 2.0377,
  waveHpGrowth: 0.207,
  sites: {
    '3,5': 3,
    '3,6': 1,
    '3,4': 4,
    '8,5': 27,
    '6,2': 5,
    '7,2': 26,
    '7,6': 23,
    '8,2': 6,
    '8,6': 24,
    '10,5': 25,
    '10,6': 14,
    '6,6': 20,
    '12,6': 11,
    '5,6': 22,
    '10,4': 8,
    '5,5': 21,
    '1,5': 2,
    '3,3': 0,
    '12,7': 16,
    '10,7': 18,
    '6,10': 19,
    '8,11': 17,
    '5,10': 13,
    '6,7': 9,
    '5,7': 15,
  },
});
