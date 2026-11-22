import { LEVEL_7 } from '../levels/level7.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i07.json';

export const I07 = campaignIsland(LEVEL_7, layout, {
  startingGold: 290,
  enemyHpScale: 1.7108,
  waveHpGrowth: 0.18,
  flyingGroups: { hpScale: 0.65 },
  sites: {
    '3,3': 4,
    '3,4': 2,
    '11,4': 3,
    '11,9': 15,
    '12,6': 1,
    '3,9': 23,
    '6,6': 13,
    '5,8': 21,
    '4,8': 22,
    '10,4': 25,
    '4,9': 24,
    '11,3': 7,
    '12,7': 11,
    '3,10': 6,
    '3,6': 12,
    '12,9': 14,
    '11,10': 17,
    '12,3': 8,
  },
});
