import { LEVEL_4 } from '../levels/level4.ts';
import { campaignIsland, replaceWaveEnemy } from './campaignIsland.ts';
import layout from './i04.json';

export const I04 = campaignIsland(LEVEL_4, layout, {
  waves: replaceWaveEnemy(LEVEL_4, 'Terrace Siege', 'flyer', 'flyer', { count: 16 }),
  startingGold: 265,
  enemyHpScale: 1.167,
  waveHpGrowth: 0.18,
  sites: {
    '2,3': 2,
    '2,4': 0,
    '3,2': 5,
    '2,2': 1,
    '7,4': 6,
    '8,3': 8,
    '6,6': 12,
    '9,3': 7,
    '6,4': 4,
    '8,6': 14,
    '8,7': 17,
    '12,7': 16,
    '11,9': 15,
    '12,9': 19,
    '8,9': 13,
    '9,4': 9,
    '11,7': 11,
  },
});
