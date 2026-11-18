import { LEVEL_5 } from '../levels/level5.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i05.json';

export const I05 = campaignIsland(LEVEL_5, layout, {
  startingGold: 270,
  enemyHpScale: 1.192,
  waveHpGrowth: 0.167,
  sites: {
    '8,7': 7,
    '8,6': 14,
    '7,6': 6,
    '9,5': 16,
    '8,5': 11,
    '10,2': 18,
    '7,7': 8,
    '7,5': 5,
    '9,7': 13,
    '9,4': 15,
    '12,2': 17,
    '8,8': 9,
    '3,4': 3,
    '3,3': 4,
    '9,6': 12,
    '12,1': 1,
    '5,3': 2,
    '1,6': 0,
  },
});
