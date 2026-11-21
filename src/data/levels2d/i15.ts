import { LEVEL_15 } from '../levels/level15.ts';
import { campaignIsland, replaceWaveEnemy } from './campaignIsland.ts';
import { build } from './chapterIsland.ts';
import layout from './i15.json';

const moonwell = campaignIsland(LEVEL_15, layout, {
  waves: replaceWaveEnemy(LEVEL_15, 'Veil of Mist', 'flyer', 'draftwing'),
  startingGold: 360,
  enemyHpScale: 4.22,
  waveHpGrowth: 0.0545,
  sites: {
    '6,3': 14,
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

export const I15 = {
  ...moonwell,
  scriptedBuildOrder: [
    // Slow the west approach and cover the incoming flyers before buying the ground mortars.
    build(0, 14, 'frost'), build(0, 7, 'frost', 'strongest'),
    build(0, 4, 'ballista'), build(0, 5, 'archer'), build(0, 24, 'mortar'),
    build(1, 15, 'mortar'), build(1, 6, 'tesla'),
    ...(moonwell.scriptedBuildOrder ?? []).filter(action => action.waveIndex > 1 || action.action !== 'build'),
  ],
};
