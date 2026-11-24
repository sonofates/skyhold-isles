import { LEVEL_3 } from '../levels/level3.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i03.json';

export const I03 = campaignIsland(LEVEL_3, layout, {
  startingGold: 280,
  enemyHpScale: 1.66,
  waveHpGrowth: 0.4693,
  waveCount: 10,
  flyingGroups: { hpScale: 0.75 },
  sites: {
    '4,3': 2,
    '3,4': 0,
    '3,6': 15,
    '5,6': 16,
    '5,7': 3,
    '2,5': 1,
    '8,4': 18,
    '6,6': 20,
    '10,6': 13,
    '8,8': 17,
    '3,7': 21,
    '5,8': 14,
    '7,6': 19,
    '11,4': 5,
    '8,6': 12,
    '6,3': 4,
    '10,7': 8,
  },
});
