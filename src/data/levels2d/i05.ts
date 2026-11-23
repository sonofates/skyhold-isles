import { LEVEL_5 } from '../levels/level5.ts';
import { campaignIsland, replaceWaveEnemy } from './campaignIsland.ts';
import layout from './i05.json';

export const I05 = campaignIsland(LEVEL_5, layout, {
  waves: replaceWaveEnemy(LEVEL_5, 'Whirlwind', 'flyer', 'flyer', { count: 9 }),
  formations: {
    'Gale Force': { flyer: { hpScale: 0.85 } },
    'Harvest Dreadnought': { boss: { hpScale: 1.3 }, flyer: { count: 28 } },
  },
  startingGold: 270,
  enemyHpScale: 1.6688,
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
