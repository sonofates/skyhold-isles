import { LEVEL_9 } from '../levels/level9.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i09.json';

export const I09 = campaignIsland(LEVEL_9, layout, {
  formations: {
    'Twin Warlords': { boss: { hpScale: 1.35, spawnInterval: 4.5 } },
  },
  startingGold: 336,
  enemyHpScale: 1.9549,
  waveHpGrowth: 0.63,
  waveCount: 11,
  flyingGroups: { hpScale: 0.75 },
  sites: {
    '2,6': 2,
    '7,5': 21,
    '7,7': 25,
    '9,8': 23,
    '11,5': 24,
    '9,6': 22,
    '13,7': 16,
    '9,9': 9,
    '9,5': 20,
    '2,7': 0,
    '13,8': 13,
    '7,9': 8,
    '11,7': 26,
    '11,3': 19,
    '3,7': 1,
    '15,6': 17,
    '11,9': 12,
    '12,9': 14,
    '13,5': 18,
    '9,3': 5,
    '13,3': 15,
    '7,3': 4,
    '7,6': 6,
    '3,4': 3,
    '1,9': 7,
  },
});
