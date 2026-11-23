import { LEVEL_11 } from '../levels/level11.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i11.json';

export const I11 = campaignIsland(LEVEL_11, layout, {
  formations: {
    'Golden Freight': { golem: { hpScale: 1.45 } },
  },
  startingGold: 265,
  enemyHpScale: 1.9624,
  waveHpGrowth: 0.235,
  flyingGroups: { hpScale: 0.15 },
  sites: {
    '6,3': 0,
    '4,4': 5,
    '7,4': 7,
    '10,7': 17,
    '11,3': 23,
    '5,4': 6,
    '13,6': 10,
    '5,7': 19,
    '10,8': 15,
    '4,7': 4,
    '7,10': 16,
    '9,6': 18,
    '13,3': 9,
    '6,10': 8,
    '8,10': 14,
    '11,6': 13,
    '2,8': 20,
    '4,3': 1,
    '9,10': 22,
    '8,3': 2,
    '13,8': 12,
    '4,10': 21,
    '12,4': 11,
  },
});
