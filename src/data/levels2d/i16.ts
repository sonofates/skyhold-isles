import { LEVEL_16 } from '../levels/level16.ts';
import { campaignIsland, replaceWaveEnemy } from './campaignIsland.ts';
import layout from './i16.json';

export const I16 = campaignIsland(LEVEL_16, layout, {
  waves: replaceWaveEnemy(LEVEL_16, 'Gatecrash', 'brute', 'kilnback'),
  startingGold: 100,
  enemyHpScale: 2.0336,
  waveHpGrowth: 0.066,
  sites: {
    '7,4': 23,
    '4,9': 8,
    '1,5': 1,
    '8,11': 24,
    '6,4': 3,
    '15,8': 19,
    '7,2': 4,
    '13,4': 20,
    '4,4': 2,
    '15,5': 18,
    '9,12': 11,
    '15,10': 15,
    '9,2': 5,
    '6,2': 0,
    '2,3': 7,
    '2,10': 9,
    '8,10': 25,
    '11,4': 22,
    '16,3': 17,
    '15,4': 6,
    '15,3': 16,
    '2,5': 10,
    '2,4': 13,
    '4,8': 21,
  },
});
