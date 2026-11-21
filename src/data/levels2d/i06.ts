import { LEVEL_6 } from '../levels/level6.ts';
import type { ScriptedBuildAction } from '../levels/types.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i06.json';

const lagoon = campaignIsland(LEVEL_6, layout, {
  startingGold: 280,
  enemyHpScale: 2.55,
  waveHpGrowth: 0.135,
  sites: {
    '3,3': 18,
    '5,2': 4,
    '8,3': 15,
    '11,4': 14,
    '6,2': 23,
    '9,6': 5,
    '11,8': 19,
    '10,2': 16,
    '10,8': 17,
    '8,9': 0,
    '11,2': 22,
    '13,5': 12,
    '6,1': 13,
    '13,6': 20,
    '3,5': 9,
    '12,4': 21,
    '10,1': 8,
  },
});

// Replace the opening cannon (p4) with a tesla so flyers don't dominate on the shorter arc.
const retune = (order: readonly ScriptedBuildAction[] = []): ScriptedBuildAction[] =>
  order.map((a) => (a.action === 'build' && a.col === 4 ? { ...a, towerType: 'tesla' } : a));

export const I06 = {
  ...lagoon,
  scriptedBuildOrder: retune(lagoon.scriptedBuildOrder),
  weakBuildOrder: retune(lagoon.weakBuildOrder),
};
