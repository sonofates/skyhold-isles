import { LEVEL_16 } from '../levels/level16.ts';
import { campaignIsland, replaceWaveEnemy } from './campaignIsland.ts';
import { build } from './chapterIsland.ts';
import layout from './i16.json';

const sanctum = campaignIsland(LEVEL_16, layout, {
  waves: replaceWaveEnemy(LEVEL_16, 'Gatecrash', 'brute', 'kilnback'),
  startingGold: 360,
  enemyHpScale: 2.54,
  waveHpGrowth: 0.068,
  sites: {
    '7,4': 1,
    '4,9': 8,
    '1,5': 23,
    '8,11': 22,
    '6,4': 3,
    '15,8': 5,
    '7,2': 4,
    '13,4': 20,
    '4,4': 2,
    '15,5': 18,
    '9,12': 17,
    '15,10': 15,
    '9,2': 6,
    '6,2': 0,
    '2,3': 7,
    '2,10': 9,
    '8,10': 25,
    '11,4': 11,
    '16,3': 24,
    '15,4': 19,
    '15,3': 16,
    '2,5': 10,
    '2,4': 13,
    '4,8': 21,
  },
});

// Cover both roads and the eastern sky approach for 335 gold, then add Tesla on the north bend.
const opening = [
  build(0, 22, 'frost'), build(0, 23, 'archer'), build(0, 1, 'cannon'), build(0, 8, 'mortar'),
  build(1, 3, 'tesla'),
];

export const I16 = {
  ...sanctum,
  scriptedBuildOrder: [...opening, ...(sanctum.scriptedBuildOrder ?? []).filter(action => action.waveIndex > 1)],
  weakBuildOrder: [...opening, ...(sanctum.weakBuildOrder ?? []).filter(action => action.waveIndex > 1)],
};
