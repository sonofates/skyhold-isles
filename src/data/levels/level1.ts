import type { LevelDef } from './types.ts';

export const LEVEL_1: LevelDef = {
  id: 'sunlit-meadow',
  index: 0,
  name: 'Sunlit Meadow',
  subtitle: 'A gentle winding trail through wildflower meadows and a cozy cottage',
  difficulty: 'Breezy',
  cols: 14,
  rows: 11,
  layout: [
    '~ ~ T . . . T ~ ~ T . . ~ ~',
    'T . . . . . . T . . . . T ~',
    'S P P P . . . . . T . . . ~',
    'T . . P . T . . . P P P . T',
    '~ T . P P P P . . P . P . .',
    '~ . . . . . P . . P . P . T',
    'T . T . . . P P P P . P . ~',
    '~ . . . T . . . . . . P . T',
    '~ ~ T . . . . T . . . P P G',
    '~ ~ ~ T . . . . . T . . . T',
    '~ ~ ~ ~ T . . T ~ ~ ~ T ~ ~',
  ],
  pathWaypoints: [
    { col: 0, row: 2 },
    { col: 3, row: 2 },
    { col: 3, row: 4 },
    { col: 6, row: 4 },
    { col: 6, row: 6 },
    { col: 9, row: 6 },
    { col: 9, row: 3 },
    { col: 11, row: 3 },
    { col: 11, row: 8 },
    { col: 13, row: 8 },
  ],
  flightPath: [
    { col: 0, row: 2 },
    { col: 5, row: 5 },
    { col: 10, row: 6 },
    { col: 13, row: 8 },
  ],
  decorationSeed: 104729,
  startingGold: 185,
  enemyHpScale: 1.0,
  waveHpGrowth: 0.1,
  waves: [
    {
      name: 'Welcome Party',
      clearBonus: 12,
      groups: [
        { enemyType: 'grunt', count: 8, spawnInterval: 1.05, startDelay: 0 },
      ],
    },
    {
      name: 'Scouts Ahead',
      clearBonus: 15,
      groups: [
        { enemyType: 'grunt', count: 10, spawnInterval: 0.9, startDelay: 0 },
        { enemyType: 'runner', count: 4, spawnInterval: 0.75, startDelay: 4.5 },
      ],
    },
    {
      name: 'Zephyr Dash',
      clearBonus: 18,
      groups: [
        { enemyType: 'runner', count: 9, spawnInterval: 0.65, startDelay: 0 },
        { enemyType: 'grunt', count: 8, spawnInterval: 0.85, startDelay: 2.5 },
      ],
    },
    {
      name: 'Iron Knock',
      clearBonus: 20,
      groups: [
        { enemyType: 'grunt', count: 10, spawnInterval: 0.8, startDelay: 0 },
        { enemyType: 'brute', count: 3, spawnInterval: 1.8, startDelay: 3 },
      ],
    },
    {
      name: 'First Flight',
      clearBonus: 24,
      groups: [
        { enemyType: 'grunt', count: 8, spawnInterval: 0.8, startDelay: 0 },
        { enemyType: 'flyer', count: 6, spawnInterval: 1, startDelay: 2 },
      ],
    },
    {
      name: 'Iron Parade',
      clearBonus: 26,
      groups: [
        { enemyType: 'brute', count: 5, spawnInterval: 1.5, startDelay: 0 },
        { enemyType: 'healer', count: 2, spawnInterval: 2.5, startDelay: 1.5 },
        { enemyType: 'runner', count: 10, spawnInterval: 0.6, startDelay: 4 },
      ],
    },
    {
      name: 'Gull Squadron',
      clearBonus: 30,
      groups: [
        { enemyType: 'flyer', count: 14, spawnInterval: 0.6, startDelay: 0 },
        { enemyType: 'grunt', count: 8, spawnInterval: 0.7, startDelay: 1.5 },
        { enemyType: 'healer', count: 3, spawnInterval: 2.2, startDelay: 3.5 },
      ],
    },
    {
      name: 'Rush Hour',
      clearBonus: 34,
      groups: [
        { enemyType: 'brute', count: 7, spawnInterval: 1.25, startDelay: 0 },
        { enemyType: 'runner', count: 14, spawnInterval: 0.5, startDelay: 2 },
        { enemyType: 'healer', count: 3, spawnInterval: 2, startDelay: 3 },
      ],
    },
    {
      name: 'Gathering Storm',
      clearBonus: 38,
      groups: [
        { enemyType: 'grunt', count: 16, spawnInterval: 0.55, startDelay: 0 },
        { enemyType: 'flyer', count: 12, spawnInterval: 0.7, startDelay: 1.5 },
        { enemyType: 'brute', count: 8, spawnInterval: 1.1, startDelay: 3.5 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.8, startDelay: 4.5 },
      ],
    },
    {
      name: 'The Dreadnought Arrives',
      clearBonus: 60,
      groups: [
        { enemyType: 'brute', count: 6, spawnInterval: 1.2, startDelay: 0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.8, startDelay: 1.5 },
        { enemyType: 'flyer', count: 10, spawnInterval: 0.75, startDelay: 3 },
        { enemyType: 'boss', count: 1, spawnInterval: 1, startDelay: 5.5 },
      ],
    },
  ],
  scriptedBuildOrder: [
    { waveIndex: 0, action: 'build', col: 4, row: 2, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 4, row: 3, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 7, row: 5, towerType: 'frost', targetingMode: 'first' },

    { waveIndex: 1, action: 'build', col: 8, row: 5, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 1, action: 'upgrade', col: 4, row: 2 },
    { waveIndex: 2, action: 'build', col: 10, row: 4, towerType: 'tesla', targetingMode: 'first' },

    { waveIndex: 3, action: 'upgrade', col: 7, row: 5 },
    { waveIndex: 3, action: 'build', col: 7, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 4, action: 'upgrade', col: 4, row: 3 },
    { waveIndex: 4, action: 'build', col: 5, row: 5, towerType: 'cannon', targetingMode: 'first' },

    { waveIndex: 5, action: 'upgrade', col: 8, row: 5 },
    { waveIndex: 5, action: 'build', col: 5, row: 7, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 6, action: 'upgrade', col: 10, row: 4 },
    { waveIndex: 6, action: 'build', col: 10, row: 5, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 7, action: 'upgrade', col: 4, row: 2 },
    { waveIndex: 7, action: 'build', col: 8, row: 7, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 8, action: 'upgrade', col: 5, row: 7 },
    { waveIndex: 9, action: 'upgrade', col: 4, row: 3 },
  ],
  weakBuildOrder: [
    { waveIndex: 0, action: 'build', col: 4, row: 2, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 4, row: 3, towerType: 'cannon' },
    { waveIndex: 0, action: 'build', col: 7, row: 5, towerType: 'frost' },

    { waveIndex: 1, action: 'build', col: 8, row: 5, towerType: 'archer' },
    { waveIndex: 2, action: 'upgrade', col: 4, row: 2 },
    { waveIndex: 2, action: 'build', col: 10, row: 4, towerType: 'tesla' },

    { waveIndex: 3, action: 'upgrade', col: 7, row: 5 },
    { waveIndex: 4, action: 'build', col: 7, row: 3, towerType: 'archer' },
    { waveIndex: 4, action: 'upgrade', col: 4, row: 3 },
    { waveIndex: 5, action: 'upgrade', col: 8, row: 5 },

    { waveIndex: 6, action: 'build', col: 5, row: 7, towerType: 'mortar' },
    { waveIndex: 7, action: 'upgrade', col: 10, row: 4 },
    { waveIndex: 7, action: 'upgrade', col: 4, row: 2 },
    { waveIndex: 8, action: 'upgrade', col: 4, row: 3 },
    { waveIndex: 9, action: 'upgrade', col: 5, row: 7 },
    { waveIndex: 9, action: 'upgrade', col: 8, row: 5 },
  ],
};
