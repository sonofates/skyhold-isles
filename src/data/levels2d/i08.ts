import { LEVEL_8 } from '../levels/level8.ts';
import type { ScriptedBuildAction } from '../levels/types.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i08.json';

const bastion = campaignIsland(LEVEL_8, layout, {
  startingGold: 250,
  enemyHpScale: 1.82,
  waveHpGrowth: 0.14,
  sites: {
    '3,5': 2,
    '3,6': 1,
    '3,4': 26,
    '8,5': 27,
    '6,2': 5,
    '7,2': 4,
    '7,6': 25,
    '8,2': 0,
    '8,6': 3,
    '10,5': 23,
    '10,6': 24,
    '6,6': 20,
    '12,6': 11,
    '5,6': 22,
    '10,4': 8,
    '5,5': 21,
    '1,5': 14,
    '3,3': 6,
    '12,7': 16,
    '10,7': 18,
    '6,10': 19,
    '8,11': 17,
    '5,10': 13,
    '6,7': 9,
    '5,7': 15,
  },
});

// Replace opening ground cannon (p26) and W6 mortar (p3) with anti-air towers on the air crescent.
const retune = (order: readonly ScriptedBuildAction[] = []): ScriptedBuildAction[] =>
  order.map((a) => {
    if (a.action === 'build' && a.col === 26) return { ...a, towerType: 'archer' };
    if (a.action === 'build' && a.col === 3) return { ...a, towerType: 'tesla', targetingMode: 'first' };
    return a;
  });

export const I08 = {
  ...bastion,
  scriptedBuildOrder: retune(bastion.scriptedBuildOrder),
  weakBuildOrder: retune(bastion.weakBuildOrder),
};
