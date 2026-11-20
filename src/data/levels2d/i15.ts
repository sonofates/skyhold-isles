import { LEVEL_15 } from '../levels/level15.ts';
import { campaignIsland, replaceWaveEnemy } from './campaignIsland.ts';
import { build } from './chapterIsland.ts';
import layout from './i15.json';

const moonwell = campaignIsland(LEVEL_15, layout, {
  waves: replaceWaveEnemy(LEVEL_15, 'Veil of Mist', 'flyer', 'draftwing'),
  startingGold: 360,
  enemyHpScale: 4.1038,
  waveHpGrowth: 0.052,
  sites: {
    '6,3': 3,
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
    // Cover the crossing and the incoming flight path before buying the two ground mortars.
    build(0, 3, 'frost'), build(0, 7, 'frost', 'strongest'),
    build(0, 24, 'mortar'), build(0, 15, 'mortar'), build(0, 5, 'archer'),
    build(1, 6, 'tesla'), build(1, 4, 'ballista'),
    ...(moonwell.scriptedBuildOrder ?? []).filter(action => action.waveIndex > 1 || action.action !== 'build'),
  ],
};
