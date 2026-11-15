import type { LevelDef } from './types.ts';

export const LEVEL_2: LevelDef = {
  id: 'twin-bridge-cay',
  index: 1,
  name: 'Twin-Bridge Cay',
  subtitle: 'Twin viaducts spanning a turquoise channel between split mesas',
  difficulty: 'Challenging',
  cols: 15,
  rows: 12,
  layout: [
    '~ ~ T . . . T ~ ~ ~ T . . ~ ~',
    '~ . . . . . . ~ ~ T . . . T ~',
    'S P P P . T . ~ ~ . . T . . ~',
    '~ T . P . . ~ ~ ~ . P P P . T',
    '~ . . P P P P P P P P . P . ~',
    '~ . . . . . ~ ~ ~ . . . P . ~',
    '~ . T . . . ~ ~ ~ T . . P . T',
    '~ . . . P P P P P P P P P . ~',
    '~ T . . P . ~ ~ ~ . . . . . ~',
    '~ ~ . . P P P . ~ . T . . ~ ~',
    '~ ~ ~ T . . P G ~ ~ ~ ~ ~ ~ ~',
    '~ ~ ~ ~ T . ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ],
  pathWaypoints: [
    { col: 0, row: 2 },
    { col: 3, row: 2 },
    { col: 3, row: 4 },
    { col: 10, row: 4 },
    { col: 10, row: 3 },
    { col: 12, row: 3 },
    { col: 12, row: 7 },
    { col: 4, row: 7 },
    { col: 4, row: 9 },
    { col: 6, row: 9 },
    { col: 6, row: 10 },
    { col: 7, row: 10 },
  ],
  flightPath: [
    { col: 0, row: 2 },
    { col: 5, row: 4 },
    { col: 11, row: 5 },
    { col: 7, row: 7 },
    { col: 5, row: 8 },
    { col: 7, row: 10 },
  ],
  decorationSeed: 224737,
  startingGold: 240,
  enemyHpScale: 1.21,
  waveHpGrowth: 0.255,
  waves: [
    {
      clearBonus: 14,
      groups: [{ enemyType: 'grunt', count: 10, spawnInterval: 0.9, startDelay: 0 }],
    },
    {
      clearBonus: 20,
      groups: [
        { enemyType: 'grunt', count: 10, spawnInterval: 0.85, startDelay: 0 },
        { enemyType: 'runner', count: 6, spawnInterval: 0.65, startDelay: 3.5 },
      ],
    },
    {
      clearBonus: 18,
      groups: [
        { enemyType: 'runner', count: 12, spawnInterval: 0.55, startDelay: 0 },
        { enemyType: 'flyer', count: 5, spawnInterval: 0.95, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 20,
      groups: [
        { enemyType: 'brute', count: 4, spawnInterval: 1.5, startDelay: 0 },
        { enemyType: 'grunt', count: 12, spawnInterval: 0.7, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 22,
      groups: [
        { enemyType: 'flyer', count: 10, spawnInterval: 0.75, startDelay: 0 },
        { enemyType: 'healer', count: 2, spawnInterval: 2.0, startDelay: 2.5 },
        { enemyType: 'runner', count: 10, spawnInterval: 0.5, startDelay: 4.0 },
      ],
    },
    {
      clearBonus: 24,
      groups: [
        { enemyType: 'brute', count: 6, spawnInterval: 1.3, startDelay: 0 },
        { enemyType: 'healer', count: 3, spawnInterval: 2.0, startDelay: 1.5 },
        { enemyType: 'grunt', count: 14, spawnInterval: 0.6, startDelay: 3.5 },
      ],
    },
    {
      clearBonus: 26,
      groups: [
        { enemyType: 'runner', count: 18, spawnInterval: 0.42, startDelay: 0 },
        { enemyType: 'flyer', count: 12, spawnInterval: 0.65, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 28,
      groups: [
        { enemyType: 'brute', count: 8, spawnInterval: 1.15, startDelay: 0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.7, startDelay: 1.5 },
        { enemyType: 'flyer', count: 10, spawnInterval: 0.7, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 32,
      groups: [
        { enemyType: 'grunt', count: 22, spawnInterval: 0.45, startDelay: 0 },
        { enemyType: 'runner', count: 16, spawnInterval: 0.42, startDelay: 3.0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.5, startDelay: 4.0 },
      ],
    },
    {
      clearBonus: 36,
      groups: [
        { enemyType: 'brute', count: 10, spawnInterval: 1.0, startDelay: 0 },
        { enemyType: 'flyer', count: 14, spawnInterval: 0.58, startDelay: 1.5 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.4, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 40,
      groups: [
        { enemyType: 'runner', count: 22, spawnInterval: 0.36, startDelay: 0 },
        { enemyType: 'brute', count: 10, spawnInterval: 0.95, startDelay: 2.5 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.4, startDelay: 3.5 },
      ],
    },
    {
      clearBonus: 45,
      groups: [
        { enemyType: 'flyer', count: 18, spawnInterval: 0.5, startDelay: 0 },
        { enemyType: 'brute', count: 12, spawnInterval: 0.85, startDelay: 2.0 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.3, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 52,
      groups: [
        { enemyType: 'brute', count: 12, spawnInterval: 0.85, startDelay: 0 },
        { enemyType: 'runner', count: 24, spawnInterval: 0.35, startDelay: 2.0 },
        { enemyType: 'flyer', count: 16, spawnInterval: 0.52, startDelay: 3.5 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.25, startDelay: 4.0 },
      ],
    },
    {
      clearBonus: 80,
      groups: [
        { enemyType: 'brute', count: 10, spawnInterval: 0.9, startDelay: 0 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.3, startDelay: 1.0 },
        { enemyType: 'flyer', count: 16, spawnInterval: 0.52, startDelay: 2.5 },
        { enemyType: 'boss', count: 2, spawnInterval: 5.5, startDelay: 4.5 },
      ],
    },
  ],
  scriptedBuildOrder: [
    { waveIndex: 0, action: 'build', col: 2, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 4, row: 5, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 2, row: 5, towerType: 'cannon', targetingMode: 'first' },

    { waveIndex: 1, action: 'build', col: 5, row: 8, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 1, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 2, action: 'build', col: 5, row: 5, towerType: 'tesla', targetingMode: 'first' },

    { waveIndex: 3, action: 'upgrade', col: 2, row: 5 },
    { waveIndex: 3, action: 'upgrade', col: 4, row: 5 },
    { waveIndex: 4, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 5, action: 'build', col: 11, row: 5, towerType: 'cannon', targetingMode: 'strongest' },

    { waveIndex: 6, action: 'build', col: 5, row: 6, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 6, action: 'upgrade', col: 5, row: 5 },
    { waveIndex: 7, action: 'upgrade', col: 11, row: 5 },
    { waveIndex: 8, action: 'build', col: 3, row: 8, towerType: 'tesla', targetingMode: 'first' },

    { waveIndex: 8, action: 'build', col: 4, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 9, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 9, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 9, action: 'upgrade', col: 5, row: 8 },

    { waveIndex: 10, action: 'upgrade', col: 5, row: 5 },
    { waveIndex: 10, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 10, action: 'upgrade', col: 3, row: 8 },
    { waveIndex: 11, action: 'build', col: 7, row: 9, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 11, action: 'build', col: 10, row: 5, towerType: 'tesla', targetingMode: 'strongest' },
    { waveIndex: 12, action: 'upgrade', col: 10, row: 5 },
    { waveIndex: 12, action: 'upgrade', col: 11, row: 5 },
    { waveIndex: 12, action: 'build', col: 11, row: 6, towerType: 'frost', targetingMode: 'first' },

    { waveIndex: 13, action: 'build', col: 9, row: 8, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 13, action: 'upgrade', col: 7, row: 9 },
    { waveIndex: 13, action: 'upgrade', col: 10, row: 5 },
    { waveIndex: 13, action: 'upgrade', col: 9, row: 8 },
    { waveIndex: 13, action: 'upgrade', col: 4, row: 3 },
  ],
  weakBuildOrder: [
    { waveIndex: 0, action: 'build', col: 2, row: 3, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 4, row: 5, towerType: 'frost' },
    { waveIndex: 0, action: 'build', col: 2, row: 5, towerType: 'cannon' },

    { waveIndex: 1, action: 'build', col: 5, row: 8, towerType: 'archer' },
    { waveIndex: 2, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 2, action: 'build', col: 5, row: 5, towerType: 'tesla' },

    { waveIndex: 3, action: 'upgrade', col: 2, row: 5 },
    { waveIndex: 4, action: 'upgrade', col: 4, row: 5 },
    { waveIndex: 5, action: 'upgrade', col: 5, row: 8 },

    { waveIndex: 6, action: 'build', col: 11, row: 5, towerType: 'cannon' },
    { waveIndex: 7, action: 'upgrade', col: 5, row: 5 },
    { waveIndex: 7, action: 'build', col: 3, row: 8, towerType: 'tesla' },
    { waveIndex: 8, action: 'upgrade', col: 11, row: 5 },

    { waveIndex: 9, action: 'build', col: 7, row: 9, towerType: 'archer' },
    { waveIndex: 9, action: 'upgrade', col: 3, row: 8 },
    { waveIndex: 10, action: 'build', col: 5, row: 6, towerType: 'mortar' },
    { waveIndex: 10, action: 'upgrade', col: 7, row: 9 },

    { waveIndex: 11, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 11, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 12, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 12, action: 'upgrade', col: 5, row: 5 },

    { waveIndex: 13, action: 'upgrade', col: 11, row: 5 },
    { waveIndex: 13, action: 'upgrade', col: 3, row: 8 },
    { waveIndex: 13, action: 'upgrade', col: 2, row: 5 },
    { waveIndex: 13, action: 'upgrade', col: 7, row: 9 },
  ],
};
