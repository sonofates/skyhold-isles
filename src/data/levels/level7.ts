import type { LevelDef } from './types.ts';

export const LEVEL_7: LevelDef = {
  id: 'skybridge-gauntlet',
  index: 6,
  name: 'Skybridge Gauntlet',
  subtitle: 'Twin cliffside forts crossed twice across a central sky-chasm',
  difficulty: 'Heroic',
  cols: 16,
  rows: 13,
  layout: [
    '~ ~ T . . T ~ ~ ~ ~ ~ T . . ~ ~',
    '~ . . . . . ~ ~ ~ ~ . . . . T ~',
    'S P P . . . . ~ ~ . P P P P . ~',
    '~ . P . P P P P P P P . . P . ~',
    '~ . P . P . . ~ ~ . . . T P . T',
    '~ T P P P . T ~ ~ ~ . P P P . ~',
    '~ . . . . . . ~ ~ ~ . P . . . ~',
    '~ . . T . . ~ ~ ~ ~ . P . T . ~',
    '~ . . . . . . ~ ~ . . P P P . ~',
    '~ G P . . P P P P P P . . P . T',
    '~ . P . . P . ~ ~ . P . . P . ~',
    '~ T P P P P . ~ ~ ~ P P P P T ~',
    '~ ~ ~ T . . ~ ~ ~ ~ ~ . T . ~ ~',
  ],
  pathWaypoints: [
    { col: 0, row: 2 },
    { col: 2, row: 2 },
    { col: 2, row: 5 },
    { col: 4, row: 5 },
    { col: 4, row: 3 },
    { col: 10, row: 3 },
    { col: 10, row: 2 },
    { col: 13, row: 2 },
    { col: 13, row: 5 },
    { col: 11, row: 5 },
    { col: 11, row: 8 },
    { col: 13, row: 8 },
    { col: 13, row: 11 },
    { col: 10, row: 11 },
    { col: 10, row: 9 },
    { col: 5, row: 9 },
    { col: 5, row: 11 },
    { col: 2, row: 11 },
    { col: 2, row: 9 },
    { col: 1, row: 9 },
  ],
  flightPath: [
    { col: 0, row: 2 },
    { col: 5, row: 3 },
    { col: 10, row: 4 },
    { col: 11, row: 7 },
    { col: 7, row: 9 },
    { col: 1, row: 9 },
  ],
  decorationSeed: 774203,
  startingGold: 280,
  enemyHpScale: 1.40,
  waveHpGrowth: 0.315,
  waves: [
    {
      clearBonus: 18,
      groups: [
        { enemyType: 'grunt', count: 12, spawnInterval: 0.8, startDelay: 0 },
        { enemyType: 'runner', count: 6, spawnInterval: 0.65, startDelay: 4.0 },
      ],
    },
    {
      clearBonus: 20,
      groups: [
        { enemyType: 'runner', count: 14, spawnInterval: 0.55, startDelay: 0 },
        { enemyType: 'grunt', count: 10, spawnInterval: 0.75, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 22,
      groups: [
        { enemyType: 'brute', count: 4, spawnInterval: 1.5, startDelay: 0 },
        { enemyType: 'flyer', count: 8, spawnInterval: 0.8, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 24,
      groups: [
        { enemyType: 'grunt', count: 14, spawnInterval: 0.6, startDelay: 0 },
        { enemyType: 'healer', count: 2, spawnInterval: 2.2, startDelay: 2.5 },
        { enemyType: 'runner', count: 10, spawnInterval: 0.55, startDelay: 4.5 },
      ],
    },
    {
      clearBonus: 26,
      groups: [
        { enemyType: 'flyer', count: 12, spawnInterval: 0.6, startDelay: 0 },
        { enemyType: 'brute', count: 6, spawnInterval: 1.2, startDelay: 1.8 },
      ],
    },
    {
      clearBonus: 28,
      groups: [
        { enemyType: 'brute', count: 7, spawnInterval: 1.15, startDelay: 0 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.8, startDelay: 1.8 },
        { enemyType: 'runner', count: 14, spawnInterval: 0.48, startDelay: 3.5 },
      ],
    },
    {
      clearBonus: 30,
      groups: [
        { enemyType: 'flyer', count: 12, spawnInterval: 0.6, startDelay: 0 },
        { enemyType: 'grunt', count: 18, spawnInterval: 0.48, startDelay: 1.5 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.6, startDelay: 3.5 },
      ],
    },
    {
      clearBonus: 32,
      groups: [
        { enemyType: 'brute', count: 10, spawnInterval: 1.0, startDelay: 0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.5, startDelay: 1.5 },
        { enemyType: 'flyer', count: 14, spawnInterval: 0.52, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 34,
      groups: [
        { enemyType: 'runner', count: 30, spawnInterval: 0.31, startDelay: 0 },
        { enemyType: 'brute', count: 11, spawnInterval: 0.85, startDelay: 2.2 },
        { enemyType: 'flyer', count: 14, spawnInterval: 0.48, startDelay: 4.0 },
      ],
    },
    {
      clearBonus: 38,
      groups: [
        { enemyType: 'brute', count: 11, spawnInterval: 0.88, startDelay: 0 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.3, startDelay: 1.5 },
        { enemyType: 'runner', count: 18, spawnInterval: 0.42, startDelay: 3.5 },
        { enemyType: 'boss', count: 1, spawnInterval: 1.0, startDelay: 5.0 },
      ],
    },
    {
      clearBonus: 40,
      groups: [
        { enemyType: 'flyer', count: 26, spawnInterval: 0.38, startDelay: 0 },
        { enemyType: 'runner', count: 28, spawnInterval: 0.32, startDelay: 1.8 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.15, startDelay: 3.2 },
      ],
    },
    {
      clearBonus: 44,
      groups: [
        { enemyType: 'brute', count: 15, spawnInterval: 0.78, startDelay: 0 },
        { enemyType: 'healer', count: 7, spawnInterval: 1.15, startDelay: 1.5 },
        { enemyType: 'grunt', count: 24, spawnInterval: 0.4, startDelay: 3.0 },
        { enemyType: 'flyer', count: 22, spawnInterval: 0.42, startDelay: 4.5 },
      ],
    },
    {
      clearBonus: 48,
      groups: [
        { enemyType: 'flyer', count: 28, spawnInterval: 0.36, startDelay: 0 },
        { enemyType: 'brute', count: 16, spawnInterval: 0.74, startDelay: 2.0 },
        { enemyType: 'healer', count: 7, spawnInterval: 1.1, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 52,
      groups: [
        { enemyType: 'runner', count: 38, spawnInterval: 0.26, startDelay: 0 },
        { enemyType: 'brute', count: 17, spawnInterval: 0.72, startDelay: 1.8 },
        { enemyType: 'flyer', count: 26, spawnInterval: 0.36, startDelay: 3.2 },
      ],
    },
    {
      clearBonus: 56,
      groups: [
        { enemyType: 'brute', count: 18, spawnInterval: 0.72, startDelay: 0 },
        { enemyType: 'healer', count: 8, spawnInterval: 1.0, startDelay: 1.4 },
        { enemyType: 'flyer', count: 28, spawnInterval: 0.36, startDelay: 3.0 },
        { enemyType: 'boss', count: 1, spawnInterval: 1.0, startDelay: 4.5 },
      ],
    },
    {
      clearBonus: 60,
      groups: [
        { enemyType: 'flyer', count: 34, spawnInterval: 0.32, startDelay: 0 },
        { enemyType: 'runner', count: 40, spawnInterval: 0.25, startDelay: 1.8 },
        { enemyType: 'brute', count: 20, spawnInterval: 0.64, startDelay: 3.0 },
        { enemyType: 'healer', count: 9, spawnInterval: 0.98, startDelay: 3.6 },
      ],
    },
    {
      clearBonus: 66,
      groups: [
        { enemyType: 'brute', count: 22, spawnInterval: 0.62, startDelay: 0 },
        { enemyType: 'healer', count: 10, spawnInterval: 0.94, startDelay: 1.4 },
        { enemyType: 'flyer', count: 30, spawnInterval: 0.34, startDelay: 2.2 },
        { enemyType: 'runner', count: 30, spawnInterval: 0.26, startDelay: 3.8 },
        { enemyType: 'boss', count: 1, spawnInterval: 1.0, startDelay: 5.5 },
      ],
    },
    {
      clearBonus: 80,
      groups: [
        { enemyType: 'brute', count: 26, spawnInterval: 0.56, startDelay: 0 },
        { enemyType: 'healer', count: 11, spawnInterval: 0.86, startDelay: 1.2 },
        { enemyType: 'flyer', count: 34, spawnInterval: 0.32, startDelay: 2.0 },
        { enemyType: 'runner', count: 28, spawnInterval: 0.27, startDelay: 3.6 },
        { enemyType: 'boss', count: 2, spawnInterval: 4.0, startDelay: 4.5 },
      ],
    },
  ],
  scriptedBuildOrder: [
    { waveIndex: 0, action: 'build', col: 3, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 3, row: 4, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 11, row: 4, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 11, row: 9, towerType: 'cannon', targetingMode: 'first' },

    { waveIndex: 1, action: 'build', col: 12, row: 6, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 1, action: 'build', col: 3, row: 9, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 2, action: 'upgrade', col: 3, row: 3 },
    { waveIndex: 2, action: 'upgrade', col: 11, row: 4 },

    { waveIndex: 3, action: 'upgrade', col: 11, row: 9 },
    { waveIndex: 3, action: 'upgrade', col: 3, row: 9 },
    { waveIndex: 4, action: 'build', col: 6, row: 6, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 4, action: 'upgrade', col: 12, row: 6 },

    { waveIndex: 5, action: 'build', col: 5, row: 8, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 5, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 6, action: 'upgrade', col: 6, row: 6 },
    { waveIndex: 6, action: 'build', col: 4, row: 8, towerType: 'frost', targetingMode: 'first' },

    { waveIndex: 7, action: 'upgrade', col: 4, row: 8 },
    { waveIndex: 7, action: 'upgrade', col: 11, row: 9 },
    { waveIndex: 8, action: 'upgrade', col: 6, row: 6 },
    { waveIndex: 8, action: 'upgrade', col: 5, row: 8 },

    { waveIndex: 9, action: 'upgrade', col: 11, row: 4 },
    { waveIndex: 9, action: 'upgrade', col: 3, row: 9 },
    { waveIndex: 10, action: 'build', col: 10, row: 4, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 10, action: 'upgrade', col: 10, row: 4 },

    { waveIndex: 10, action: 'upgrade', col: 12, row: 6 },
    { waveIndex: 11, action: 'build', col: 4, row: 9, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 11, action: 'upgrade', col: 4, row: 9 },
    { waveIndex: 11, action: 'upgrade', col: 4, row: 9 },

    { waveIndex: 12, action: 'upgrade', col: 10, row: 4 },
    { waveIndex: 12, action: 'build', col: 11, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 12, action: 'upgrade', col: 11, row: 3 },
    { waveIndex: 12, action: 'upgrade', col: 11, row: 3 },

    { waveIndex: 13, action: 'build', col: 12, row: 7, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 13, action: 'upgrade', col: 12, row: 7 },
    { waveIndex: 13, action: 'upgrade', col: 12, row: 7 },
    { waveIndex: 14, action: 'build', col: 3, row: 10, towerType: 'tesla', targetingMode: 'strongest' },

    { waveIndex: 14, action: 'upgrade', col: 3, row: 10 },
    { waveIndex: 14, action: 'upgrade', col: 3, row: 10 },
    { waveIndex: 14, action: 'upgrade', col: 3, row: 3 },
    { waveIndex: 15, action: 'build', col: 3, row: 6, towerType: 'cannon', targetingMode: 'strongest' },

    { waveIndex: 15, action: 'upgrade', col: 3, row: 6 },
    { waveIndex: 15, action: 'upgrade', col: 3, row: 6 },
    { waveIndex: 15, action: 'build', col: 12, row: 9, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 16, action: 'upgrade', col: 12, row: 9 },

    { waveIndex: 16, action: 'upgrade', col: 12, row: 9 },
    { waveIndex: 16, action: 'build', col: 11, row: 10, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 16, action: 'upgrade', col: 11, row: 10 },
    { waveIndex: 17, action: 'upgrade', col: 11, row: 10 },
    { waveIndex: 17, action: 'upgrade', col: 3, row: 4 },
    { waveIndex: 17, action: 'upgrade', col: 3, row: 4 },
    { waveIndex: 17, action: 'upgrade', col: 4, row: 8 },
    { waveIndex: 17, action: 'build', col: 12, row: 3, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 17, action: 'upgrade', col: 12, row: 3 },
    { waveIndex: 17, action: 'upgrade', col: 12, row: 3 },
  ],
  weakBuildOrder: [
    { waveIndex: 0, action: 'build', col: 3, row: 3, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 3, row: 4, towerType: 'frost' },
    { waveIndex: 0, action: 'build', col: 11, row: 4, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 11, row: 9, towerType: 'cannon' },

    { waveIndex: 1, action: 'build', col: 12, row: 6, towerType: 'tesla' },
    { waveIndex: 1, action: 'build', col: 3, row: 9, towerType: 'archer' },
    { waveIndex: 2, action: 'upgrade', col: 3, row: 3 },
    { waveIndex: 3, action: 'upgrade', col: 11, row: 4 },

    { waveIndex: 3, action: 'upgrade', col: 11, row: 9 },
    { waveIndex: 4, action: 'upgrade', col: 3, row: 9 },
    { waveIndex: 4, action: 'build', col: 6, row: 6, towerType: 'mortar' },
    { waveIndex: 5, action: 'upgrade', col: 12, row: 6 },

    { waveIndex: 5, action: 'build', col: 5, row: 8, towerType: 'tesla' },
    { waveIndex: 6, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 6, action: 'build', col: 4, row: 8, towerType: 'frost' },
    { waveIndex: 7, action: 'upgrade', col: 6, row: 6 },

    { waveIndex: 8, action: 'upgrade', col: 11, row: 9 },
    { waveIndex: 9, action: 'upgrade', col: 4, row: 8 },
    { waveIndex: 10, action: 'build', col: 10, row: 4, towerType: 'archer' },
    { waveIndex: 10, action: 'upgrade', col: 10, row: 4 },

    { waveIndex: 11, action: 'build', col: 4, row: 9, towerType: 'cannon' },
    { waveIndex: 11, action: 'upgrade', col: 4, row: 9 },
    { waveIndex: 12, action: 'build', col: 11, row: 3, towerType: 'archer' },
    { waveIndex: 12, action: 'upgrade', col: 11, row: 3 },

    { waveIndex: 13, action: 'upgrade', col: 3, row: 3 },
    { waveIndex: 13, action: 'upgrade', col: 11, row: 4 },
    { waveIndex: 14, action: 'upgrade', col: 3, row: 9 },
    { waveIndex: 14, action: 'upgrade', col: 3, row: 4 },

    { waveIndex: 15, action: 'upgrade', col: 11, row: 3 },
    { waveIndex: 16, action: 'upgrade', col: 12, row: 6 },
    { waveIndex: 17, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 17, action: 'upgrade', col: 4, row: 9 },
  ],
};
