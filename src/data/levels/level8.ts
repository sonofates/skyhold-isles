import type { LevelDef } from './types.ts';

export const LEVEL_8: LevelDef = {
  id: 'sunken-bastion',
  index: 7,
  name: 'Sunken Bastion',
  subtitle: 'Outer terraced ramparts feeding a moated inner keep',
  difficulty: 'Master',
  cols: 16,
  rows: 13,
  layout: [
    '~ ~ T . . T ~ ~ ~ ~ T . . T ~ ~',
    '~ T . . . P P P P P . . . . T ~',
    '~ . P P P P . . . P P P P . . ~',
    '~ . P . ~ ~ ~ ~ ~ ~ ~ ~ P . T ~',
    '~ . P . ~ . P P P P . ~ P . . ~',
    '~ . P . ~ . P G . P . ~ P P . T',
    '~ T P . ~ . . . . P . ~ . P . ~',
    'S P P . ~ . . P P P . ~ . P . ~',
    '~ . . . ~ ~ ~ P ~ ~ ~ ~ P P . ~',
    '~ T . . ~ ~ ~ P ~ ~ ~ ~ P . T ~',
    '~ ~ . . . . . P P P . . P . ~ ~',
    '~ ~ T . . . T . . P P P P . ~ ~',
    '~ ~ ~ ~ T . . T ~ ~ . . T ~ ~ ~',
  ],
  pathWaypoints: [
    { col: 0, row: 7 },
    { col: 2, row: 7 },
    { col: 2, row: 2 },
    { col: 5, row: 2 },
    { col: 5, row: 1 },
    { col: 9, row: 1 },
    { col: 9, row: 2 },
    { col: 12, row: 2 },
    { col: 12, row: 5 },
    { col: 13, row: 5 },
    { col: 13, row: 8 },
    { col: 12, row: 8 },
    { col: 12, row: 11 },
    { col: 9, row: 11 },
    { col: 9, row: 10 },
    { col: 7, row: 10 },
    { col: 7, row: 7 },
    { col: 9, row: 7 },
    { col: 9, row: 4 },
    { col: 6, row: 4 },
    { col: 6, row: 5 },
    { col: 7, row: 5 },
  ],
  flightPath: [
    { col: 0, row: 7 },
    { col: 2, row: 4 },
    { col: 7, row: 2 },
    { col: 11, row: 6 },
    { col: 7, row: 5 },
  ],
  decorationSeed: 885137,
  startingGold: 300,
  enemyHpScale: 1.46,
  waveHpGrowth: 0.33,
  waves: [
    {
      clearBonus: 18,
      groups: [
        { enemyType: 'grunt', count: 16, spawnInterval: 0.62, startDelay: 0 },
        { enemyType: 'runner', count: 8, spawnInterval: 0.5, startDelay: 2.8 },
      ],
    },
    {
      clearBonus: 20,
      groups: [
        { enemyType: 'runner', count: 18, spawnInterval: 0.45, startDelay: 0 },
        { enemyType: 'grunt', count: 14, spawnInterval: 0.58, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 22,
      groups: [
        { enemyType: 'brute', count: 5, spawnInterval: 1.3, startDelay: 0 },
        { enemyType: 'flyer', count: 9, spawnInterval: 0.72, startDelay: 1.8 },
        { enemyType: 'grunt', count: 10, spawnInterval: 0.52, startDelay: 3.6 },
      ],
    },
    {
      clearBonus: 24,
      groups: [
        { enemyType: 'grunt', count: 20, spawnInterval: 0.46, startDelay: 0 },
        { enemyType: 'healer', count: 3, spawnInterval: 2.2, startDelay: 1.8 },
        { enemyType: 'runner', count: 14, spawnInterval: 0.44, startDelay: 4.0 },
      ],
    },
    {
      clearBonus: 26,
      groups: [
        { enemyType: 'flyer', count: 15, spawnInterval: 0.56, startDelay: 0 },
        { enemyType: 'brute', count: 7, spawnInterval: 1.1, startDelay: 1.6 },
        { enemyType: 'grunt', count: 12, spawnInterval: 0.48, startDelay: 3.4 },
      ],
    },
    {
      clearBonus: 28,
      groups: [
        { enemyType: 'brute', count: 10, spawnInterval: 0.92, startDelay: 0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.6, startDelay: 1.4 },
        { enemyType: 'grunt', count: 20, spawnInterval: 0.42, startDelay: 2.8 },
      ],
    },
    {
      clearBonus: 30,
      groups: [
        { enemyType: 'runner', count: 28, spawnInterval: 0.3, startDelay: 0 },
        { enemyType: 'flyer', count: 20, spawnInterval: 0.44, startDelay: 1.2 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.45, startDelay: 2.8 },
      ],
    },
    {
      clearBonus: 32,
      groups: [
        { enemyType: 'brute', count: 13, spawnInterval: 0.8, startDelay: 0 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.28, startDelay: 1.0 },
        { enemyType: 'flyer', count: 18, spawnInterval: 0.45, startDelay: 2.4 },
      ],
    },
    {
      clearBonus: 34,
      groups: [
        { enemyType: 'runner', count: 34, spawnInterval: 0.27, startDelay: 0 },
        { enemyType: 'brute', count: 13, spawnInterval: 0.78, startDelay: 1.6 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.25, startDelay: 2.4 },
      ],
    },
    {
      clearBonus: 38,
      groups: [
        { enemyType: 'brute', count: 15, spawnInterval: 0.72, startDelay: 0 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.15, startDelay: 1.0 },
        { enemyType: 'flyer', count: 18, spawnInterval: 0.42, startDelay: 2.0 },
        { enemyType: 'boss', count: 1, spawnInterval: 1.0, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 40,
      groups: [
        { enemyType: 'grunt', count: 28, spawnInterval: 0.32, startDelay: 0 },
        { enemyType: 'brute', count: 16, spawnInterval: 0.72, startDelay: 1.2 },
        { enemyType: 'healer', count: 7, spawnInterval: 1.08, startDelay: 2.0 },
        { enemyType: 'flyer', count: 24, spawnInterval: 0.36, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 44,
      groups: [
        { enemyType: 'flyer', count: 32, spawnInterval: 0.32, startDelay: 0 },
        { enemyType: 'runner', count: 32, spawnInterval: 0.25, startDelay: 1.2 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.05, startDelay: 2.4 },
      ],
    },
    {
      clearBonus: 48,
      groups: [
        { enemyType: 'brute', count: 22, spawnInterval: 0.62, startDelay: 0 },
        { enemyType: 'healer', count: 10, spawnInterval: 0.9, startDelay: 0.8 },
        { enemyType: 'grunt', count: 24, spawnInterval: 0.3, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 52,
      groups: [
        { enemyType: 'flyer', count: 30, spawnInterval: 0.32, startDelay: 0 },
        { enemyType: 'brute', count: 20, spawnInterval: 0.62, startDelay: 1.2 },
        { enemyType: 'runner', count: 30, spawnInterval: 0.24, startDelay: 2.2 },
        { enemyType: 'healer', count: 9, spawnInterval: 0.9, startDelay: 2.8 },
      ],
    },
    {
      clearBonus: 56,
      groups: [
        { enemyType: 'brute', count: 25, spawnInterval: 0.5, startDelay: 0 },
        { enemyType: 'healer', count: 12, spawnInterval: 0.76, startDelay: 0.8 },
        { enemyType: 'flyer', count: 36, spawnInterval: 0.28, startDelay: 1.8 },
        { enemyType: 'boss', count: 2, spawnInterval: 2.8, startDelay: 2.2 },
      ],
    },
    {
      clearBonus: 60,
      groups: [
        { enemyType: 'flyer', count: 48, spawnInterval: 0.24, startDelay: 0 },
        { enemyType: 'runner', count: 44, spawnInterval: 0.2, startDelay: 1.2 },
        { enemyType: 'healer', count: 11, spawnInterval: 0.78, startDelay: 2.2 },
      ],
    },
    {
      clearBonus: 64,
      groups: [
        { enemyType: 'brute', count: 32, spawnInterval: 0.46, startDelay: 0 },
        { enemyType: 'healer', count: 15, spawnInterval: 0.68, startDelay: 0.8 },
        { enemyType: 'flyer', count: 40, spawnInterval: 0.26, startDelay: 1.8 },
      ],
    },
    {
      clearBonus: 68,
      groups: [
        { enemyType: 'flyer', count: 46, spawnInterval: 0.24, startDelay: 0 },
        { enemyType: 'brute', count: 28, spawnInterval: 0.46, startDelay: 1.0 },
        { enemyType: 'healer', count: 13, spawnInterval: 0.72, startDelay: 1.8 },
        { enemyType: 'boss', count: 2, spawnInterval: 2.6, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 72,
      groups: [
        { enemyType: 'runner', count: 48, spawnInterval: 0.19, startDelay: 0 },
        { enemyType: 'brute', count: 32, spawnInterval: 0.42, startDelay: 1.0 },
        { enemyType: 'healer', count: 15, spawnInterval: 0.66, startDelay: 1.8 },
        { enemyType: 'flyer', count: 46, spawnInterval: 0.24, startDelay: 2.4 },
      ],
    },
    {
      clearBonus: 90,
      groups: [
        { enemyType: 'brute', count: 34, spawnInterval: 0.4, startDelay: 0 },
        { enemyType: 'healer', count: 16, spawnInterval: 0.64, startDelay: 0.8 },
        { enemyType: 'flyer', count: 54, spawnInterval: 0.22, startDelay: 1.5 },
        { enemyType: 'boss', count: 2, spawnInterval: 2.4, startDelay: 2.0 },
      ],
    },
  ],
  scriptedBuildOrder: [
    { waveIndex: 0, action: 'build', col: 3, row: 5, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 3, row: 6, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 3, row: 4, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 0, action: 'build', col: 8, row: 5, towerType: 'tesla', targetingMode: 'first' },

    { waveIndex: 1, action: 'build', col: 6, row: 2, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 1, action: 'upgrade', col: 3, row: 5 },
    { waveIndex: 2, action: 'upgrade', col: 3, row: 4 },
    { waveIndex: 2, action: 'build', col: 7, row: 2, towerType: 'frost', targetingMode: 'first' },

    { waveIndex: 3, action: 'upgrade', col: 6, row: 2 },
    { waveIndex: 3, action: 'build', col: 7, row: 6, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 4, action: 'build', col: 8, row: 2, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 4, action: 'upgrade', col: 8, row: 2 },

    { waveIndex: 5, action: 'upgrade', col: 7, row: 6 },
    { waveIndex: 5, action: 'build', col: 8, row: 6, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 6, action: 'upgrade', col: 8, row: 5 },
    { waveIndex: 6, action: 'upgrade', col: 3, row: 6 },

    { waveIndex: 7, action: 'upgrade', col: 7, row: 2 },
    { waveIndex: 7, action: 'build', col: 10, row: 5, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 8, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 8, action: 'upgrade', col: 3, row: 5 },

    { waveIndex: 9, action: 'build', col: 10, row: 6, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 9, action: 'upgrade', col: 10, row: 6 },
    { waveIndex: 9, action: 'upgrade', col: 10, row: 5 },

    { waveIndex: 10, action: 'build', col: 6, row: 6, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 10, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 10, action: 'upgrade', col: 6, row: 2 },

    { waveIndex: 11, action: 'build', col: 12, row: 6, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 11, action: 'upgrade', col: 12, row: 6 },
    { waveIndex: 11, action: 'upgrade', col: 8, row: 2 },

    { waveIndex: 12, action: 'build', col: 5, row: 6, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 12, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 12, action: 'upgrade', col: 3, row: 4 },

    { waveIndex: 13, action: 'build', col: 10, row: 4, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 13, action: 'upgrade', col: 10, row: 4 },
    { waveIndex: 13, action: 'upgrade', col: 8, row: 5 },
    { waveIndex: 13, action: 'upgrade', col: 10, row: 4 },

    { waveIndex: 14, action: 'build', col: 5, row: 5, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 14, action: 'upgrade', col: 5, row: 5 },
    { waveIndex: 14, action: 'upgrade', col: 10, row: 6 },
    { waveIndex: 14, action: 'upgrade', col: 10, row: 5 },

    { waveIndex: 15, action: 'upgrade', col: 5, row: 5 },
    { waveIndex: 15, action: 'upgrade', col: 12, row: 6 },
    { waveIndex: 15, action: 'upgrade', col: 6, row: 6 },
    { waveIndex: 15, action: 'upgrade', col: 7, row: 6 },

    { waveIndex: 16, action: 'build', col: 10, row: 7, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 16, action: 'upgrade', col: 10, row: 7 },
    { waveIndex: 16, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 16, action: 'upgrade', col: 7, row: 2 },

    { waveIndex: 17, action: 'build', col: 12, row: 7, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 17, action: 'upgrade', col: 12, row: 7 },
    { waveIndex: 17, action: 'upgrade', col: 12, row: 7 },
    { waveIndex: 17, action: 'upgrade', col: 3, row: 6 },

    { waveIndex: 18, action: 'build', col: 6, row: 10, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 18, action: 'upgrade', col: 6, row: 10 },
    { waveIndex: 18, action: 'upgrade', col: 6, row: 10 },
    { waveIndex: 18, action: 'upgrade', col: 10, row: 7 },
    { waveIndex: 18, action: 'build', col: 1, row: 5, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 18, action: 'upgrade', col: 1, row: 5 },
    { waveIndex: 18, action: 'upgrade', col: 1, row: 5 },

    { waveIndex: 19, action: 'build', col: 8, row: 11, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 19, action: 'upgrade', col: 8, row: 11 },
    { waveIndex: 19, action: 'upgrade', col: 8, row: 11 },
    { waveIndex: 19, action: 'build', col: 5, row: 10, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 19, action: 'upgrade', col: 5, row: 10 },
    { waveIndex: 19, action: 'upgrade', col: 5, row: 10 },
    { waveIndex: 19, action: 'build', col: 3, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 19, action: 'upgrade', col: 3, row: 3 },
    { waveIndex: 19, action: 'upgrade', col: 3, row: 3 },
    { waveIndex: 19, action: 'upgrade', col: 6, row: 6 },
    { waveIndex: 19, action: 'build', col: 6, row: 7, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 19, action: 'upgrade', col: 6, row: 7 },
    { waveIndex: 19, action: 'upgrade', col: 6, row: 7 },
    { waveIndex: 19, action: 'build', col: 5, row: 7, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 19, action: 'upgrade', col: 5, row: 7 },
    { waveIndex: 19, action: 'upgrade', col: 5, row: 7 },
  ],
  weakBuildOrder: [
    { waveIndex: 0, action: 'build', col: 3, row: 5, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 3, row: 6, towerType: 'frost' },
    { waveIndex: 0, action: 'build', col: 3, row: 4, towerType: 'cannon' },
    { waveIndex: 0, action: 'build', col: 8, row: 5, towerType: 'tesla' },

    { waveIndex: 1, action: 'build', col: 6, row: 2, towerType: 'tesla' },
    { waveIndex: 1, action: 'upgrade', col: 3, row: 5 },
    { waveIndex: 2, action: 'upgrade', col: 3, row: 4 },
    { waveIndex: 2, action: 'build', col: 7, row: 2, towerType: 'frost' },

    { waveIndex: 3, action: 'upgrade', col: 6, row: 2 },
    { waveIndex: 3, action: 'build', col: 7, row: 6, towerType: 'cannon' },
    { waveIndex: 4, action: 'build', col: 8, row: 2, towerType: 'archer' },
    { waveIndex: 4, action: 'upgrade', col: 8, row: 2 },

    { waveIndex: 5, action: 'upgrade', col: 7, row: 6 },
    { waveIndex: 5, action: 'build', col: 8, row: 6, towerType: 'mortar' },
    { waveIndex: 6, action: 'upgrade', col: 8, row: 5 },
    { waveIndex: 6, action: 'upgrade', col: 3, row: 6 },

    { waveIndex: 7, action: 'upgrade', col: 7, row: 2 },
    { waveIndex: 7, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 8, action: 'build', col: 10, row: 5, towerType: 'tesla' },
    { waveIndex: 8, action: 'upgrade', col: 3, row: 5 },

    { waveIndex: 9, action: 'build', col: 10, row: 6, towerType: 'archer' },
    { waveIndex: 9, action: 'upgrade', col: 10, row: 6 },
    { waveIndex: 9, action: 'upgrade', col: 10, row: 5 },

    { waveIndex: 10, action: 'build', col: 6, row: 6, towerType: 'frost' },
    { waveIndex: 10, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 10, action: 'upgrade', col: 6, row: 2 },

    { waveIndex: 11, action: 'build', col: 12, row: 6, towerType: 'tesla' },
    { waveIndex: 11, action: 'upgrade', col: 12, row: 6 },
    { waveIndex: 11, action: 'upgrade', col: 8, row: 2 },

    { waveIndex: 12, action: 'build', col: 5, row: 6, towerType: 'mortar' },
    { waveIndex: 12, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 12, action: 'upgrade', col: 3, row: 4 },

    { waveIndex: 13, action: 'build', col: 1, row: 5, towerType: 'archer' },
    { waveIndex: 13, action: 'upgrade', col: 1, row: 5 },
    { waveIndex: 13, action: 'upgrade', col: 1, row: 5 },

    { waveIndex: 14, action: 'build', col: 6, row: 10, towerType: 'cannon' },
    { waveIndex: 14, action: 'upgrade', col: 6, row: 10 },
    { waveIndex: 14, action: 'upgrade', col: 3, row: 6 },

    { waveIndex: 15, action: 'build', col: 10, row: 4, towerType: 'archer' },
    { waveIndex: 15, action: 'upgrade', col: 10, row: 4 },
    { waveIndex: 15, action: 'upgrade', col: 10, row: 6 },
    { waveIndex: 15, action: 'upgrade', col: 10, row: 4 },
  ],
};
