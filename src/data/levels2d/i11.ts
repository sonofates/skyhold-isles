import { LEVEL_11 } from '../levels/level11.ts';
import type { ScriptedBuildAction } from '../levels/types.ts';
import { campaignIsland } from './campaignIsland.ts';
import layout from './i11.json';

const spires = campaignIsland(LEVEL_11, layout, {
  startingGold: 255,
  enemyHpScale: 1.45,
  waveHpGrowth: 0.11,
  sites: {
    '6,3': 0,
    '4,4': 5,
    '7,4': 18,
    '10,7': 17,
    '11,3': 23,
    '5,4': 6,
    '13,6': 19,
    '5,7': 22,
    '10,8': 1,
    '4,7': 4,
    '7,10': 20,
    '9,6': 7,
    '13,3': 16,
    '6,10': 8,
    '8,10': 21,
    '11,6': 13,
    '2,8': 9,
    '4,3': 15,
    '9,10': 14,
    '8,3': 2,
    '13,8': 12,
    '4,10': 11,
    '12,4': 10,
  },
});

// Strengthen anti-air coverage along the shorter western flight crescent (p18, p22, p20).
const retune = (order: readonly ScriptedBuildAction[] = []): ScriptedBuildAction[] =>
  order.map((a) => {
    if (a.action === 'build' && a.col === 18) return { ...a, towerType: 'archer' };
    if (a.action === 'build' && a.col === 22) return { ...a, towerType: 'tesla' };
    if (a.action === 'build' && a.col === 20) return { ...a, towerType: 'archer' };
    return a;
  });

export const I11 = {
  ...spires,
  scriptedBuildOrder: retune(spires.scriptedBuildOrder),
  weakBuildOrder: retune(spires.weakBuildOrder),
};
