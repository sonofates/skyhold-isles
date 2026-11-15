import type { LevelDef } from './types.ts';

export const LEVEL_9: LevelDef = {
  id: 'grand-skyhold',
  index: 8,
  name: 'Grand Skyhold',
  subtitle: 'The crown citadel above the clouds — endure the full siege',
  difficulty: 'Master',
  cols: 17,
  rows: 13,
  layout: [
    '~ ~ ~ ~ ~ ~ ~ ~ T . . T . . T ~ ~',
    '~ ~ T . ~ ~ ~ T . . . . . . . T ~',
    '~ T . . ~ ~ T . P P P P P P P . ~',
    '~ . . . ~ ~ . . P . . . . . P . ~',
    '~ . . . ~ ~ . . P . P P G . P . T',
    '~ P P P ~ ~ . . P . P . . . P . .',
    '~ P . P P P P . P . P . T . P . .',
    '~ P . . ~ ~ P . P P P . . . P . T',
    'S P . T ~ ~ P . . . . . . . P . ~',
    '~ . . . ~ ~ P . . . . . . T P . ~',
    '~ ~ T . ~ ~ P P P P P P P P P . ~',
    '~ ~ ~ ~ ~ ~ ~ . T . . . . T . ~ ~',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ T . . T ~ ~ ~ ~',
  ],
  pathWaypoints: [
    { col: 0, row: 8 },
    { col: 1, row: 8 },
    { col: 1, row: 5 },
    { col: 3, row: 5 },
    { col: 3, row: 6 },
    { col: 6, row: 6 },
    { col: 6, row: 10 },
    { col: 14, row: 10 },
    { col: 14, row: 2 },
    { col: 8, row: 2 },
    { col: 8, row: 7 },
    { col: 10, row: 7 },
    { col: 10, row: 4 },
    { col: 12, row: 4 },
  ],
  flightPath: [
    { col: 0, row: 8 },
    { col: 2, row: 6 },
    { col: 5, row: 6 },
    { col: 9, row: 9 },
    { col: 13, row: 8 },
    { col: 12, row: 4 },
  ],
  decorationSeed: 996721,
  startingGold: 325,
  enemyHpScale: 1.54,
  waveHpGrowth: 0.345,
  waves: [
    {
      clearBonus: 18,
      groups: [
        { enemyType: 'grunt', count: 14, spawnInterval: 0.56, startDelay: 0 },
        { enemyType: 'runner', count: 6, spawnInterval: 0.45, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 20,
      groups: [
        { enemyType: 'runner', count: 14, spawnInterval: 0.38, startDelay: 0 },
        { enemyType: 'grunt', count: 12, spawnInterval: 0.48, startDelay: 1.6 },
      ],
    },
    {
      clearBonus: 22,
      groups: [
        { enemyType: 'brute', count: 4, spawnInterval: 0.95, startDelay: 0 },
        { enemyType: 'flyer', count: 8, spawnInterval: 0.54, startDelay: 1.4 },
        { enemyType: 'grunt', count: 10, spawnInterval: 0.48, startDelay: 2.6 },
      ],
    },
    {
      clearBonus: 24,
      groups: [
        { enemyType: 'grunt', count: 16, spawnInterval: 0.4, startDelay: 0 },
        { enemyType: 'healer', count: 2, spawnInterval: 1.4, startDelay: 1.5 },
        { enemyType: 'runner', count: 14, spawnInterval: 0.35, startDelay: 2.8 },
      ],
    },
    {
      clearBonus: 26,
      groups: [
        { enemyType: 'flyer', count: 16, spawnInterval: 0.45, startDelay: 0 },
        { enemyType: 'brute', count: 6, spawnInterval: 0.85, startDelay: 1.4 },
        { enemyType: 'grunt', count: 12, spawnInterval: 0.4, startDelay: 2.6 },
      ],
    },
    {
      clearBonus: 28,
      groups: [
        { enemyType: 'brute', count: 8, spawnInterval: 0.78, startDelay: 0 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.2, startDelay: 1.2 },
        { enemyType: 'runner', count: 16, spawnInterval: 0.32, startDelay: 2.4 },
      ],
    },
    {
      clearBonus: 32,
      groups: [
        { enemyType: 'flyer', count: 17, spawnInterval: 0.44, startDelay: 0 },
        { enemyType: 'grunt', count: 20, spawnInterval: 0.34, startDelay: 1.0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.1, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 34,
      groups: [
        { enemyType: 'brute', count: 10, spawnInterval: 0.68, startDelay: 0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.05, startDelay: 1.0 },
        { enemyType: 'flyer', count: 17, spawnInterval: 0.44, startDelay: 1.8 },
      ],
    },
    {
      clearBonus: 36,
      groups: [
        { enemyType: 'runner', count: 28, spawnInterval: 0.24, startDelay: 0 },
        { enemyType: 'brute', count: 10, spawnInterval: 0.65, startDelay: 1.2 },
        { enemyType: 'grunt', count: 16, spawnInterval: 0.32, startDelay: 2.4 },
      ],
    },
    {
      clearBonus: 40,
      groups: [
        { enemyType: 'brute', count: 12, spawnInterval: 0.62, startDelay: 0 },
        { enemyType: 'healer', count: 5, spawnInterval: 0.95, startDelay: 0.9 },
        { enemyType: 'flyer', count: 19, spawnInterval: 0.4, startDelay: 1.6 },
        { enemyType: 'runner', count: 16, spawnInterval: 0.28, startDelay: 2.8 },
      ],
    },
    {
      clearBonus: 42,
      groups: [
        { enemyType: 'flyer', count: 22, spawnInterval: 0.36, startDelay: 0 },
        { enemyType: 'runner', count: 24, spawnInterval: 0.24, startDelay: 1.2 },
        { enemyType: 'healer', count: 5, spawnInterval: 0.9, startDelay: 2.2 },
      ],
    },
    {
      clearBonus: 46,
      groups: [
        { enemyType: 'brute', count: 14, spawnInterval: 0.58, startDelay: 0 },
        { enemyType: 'healer', count: 6, spawnInterval: 0.88, startDelay: 0.9 },
        { enemyType: 'grunt', count: 26, spawnInterval: 0.28, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 50,
      groups: [
        { enemyType: 'flyer', count: 23, spawnInterval: 0.35, startDelay: 0 },
        { enemyType: 'brute', count: 15, spawnInterval: 0.56, startDelay: 1.2 },
        { enemyType: 'runner', count: 24, spawnInterval: 0.24, startDelay: 2.2 },
      ],
    },
    {
      clearBonus: 62,
      groups: [
        { enemyType: 'brute', count: 14, spawnInterval: 0.56, startDelay: 0 },
        { enemyType: 'healer', count: 6, spawnInterval: 0.88, startDelay: 0.9 },
        { enemyType: 'flyer', count: 23, spawnInterval: 0.35, startDelay: 1.6 },
        { enemyType: 'boss', count: 1, spawnInterval: 1.0, startDelay: 2.6 },
      ],
    },
    {
      clearBonus: 54,
      groups: [
        { enemyType: 'runner', count: 34, spawnInterval: 0.2, startDelay: 0 },
        { enemyType: 'flyer', count: 26, spawnInterval: 0.3, startDelay: 1.0 },
        { enemyType: 'healer', count: 6, spawnInterval: 0.85, startDelay: 2.0 },
        { enemyType: 'grunt', count: 20, spawnInterval: 0.28, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 58,
      groups: [
        { enemyType: 'brute', count: 19, spawnInterval: 0.5, startDelay: 0 },
        { enemyType: 'healer', count: 7, spawnInterval: 0.8, startDelay: 0.9 },
        { enemyType: 'flyer', count: 28, spawnInterval: 0.3, startDelay: 1.6 },
      ],
    },
    {
      clearBonus: 64,
      groups: [
        { enemyType: 'runner', count: 34, spawnInterval: 0.2, startDelay: 0 },
        { enemyType: 'brute', count: 19, spawnInterval: 0.5, startDelay: 1.0 },
        { enemyType: 'healer', count: 8, spawnInterval: 0.78, startDelay: 1.8 },
        { enemyType: 'flyer', count: 28, spawnInterval: 0.3, startDelay: 2.4 },
      ],
    },
    {
      clearBonus: 78,
      groups: [
        { enemyType: 'brute', count: 20, spawnInterval: 0.48, startDelay: 0 },
        { enemyType: 'healer', count: 8, spawnInterval: 0.78, startDelay: 0.9 },
        { enemyType: 'flyer', count: 31, spawnInterval: 0.28, startDelay: 1.6 },
        { enemyType: 'boss', count: 2, spawnInterval: 3.0, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 70,
      groups: [
        { enemyType: 'runner', count: 40, spawnInterval: 0.19, startDelay: 0 },
        { enemyType: 'flyer', count: 30, spawnInterval: 0.29, startDelay: 1.0 },
        { enemyType: 'brute', count: 21, spawnInterval: 0.46, startDelay: 1.8 },
      ],
    },
    {
      clearBonus: 76,
      groups: [
        { enemyType: 'brute', count: 24, spawnInterval: 0.44, startDelay: 0 },
        { enemyType: 'healer', count: 9, spawnInterval: 0.72, startDelay: 0.8 },
        { enemyType: 'flyer', count: 32, spawnInterval: 0.28, startDelay: 1.6 },
      ],
    },
    {
      clearBonus: 84,
      groups: [
        { enemyType: 'runner', count: 42, spawnInterval: 0.19, startDelay: 0 },
        { enemyType: 'brute', count: 24, spawnInterval: 0.42, startDelay: 1.0 },
        { enemyType: 'healer', count: 10, spawnInterval: 0.7, startDelay: 1.6 },
        { enemyType: 'flyer', count: 34, spawnInterval: 0.27, startDelay: 2.2 },
      ],
    },
    {
      clearBonus: 100,
      groups: [
        { enemyType: 'brute', count: 24, spawnInterval: 0.42, startDelay: 0 },
        { enemyType: 'healer', count: 10, spawnInterval: 0.7, startDelay: 0.7 },
        { enemyType: 'runner', count: 36, spawnInterval: 0.19, startDelay: 1.3 },
        { enemyType: 'flyer', count: 39, spawnInterval: 0.25, startDelay: 1.8 },
        { enemyType: 'boss', count: 3, spawnInterval: 2.6, startDelay: 2.6 },
      ],
    },
  ],
  scriptedBuildOrder: [
    // Pre-wave 1 (325g -> 50+65+90+50+50 = 305g, 20g left) [5 builds]
    { waveIndex: 0, action: 'build', col: 2, row: 6, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 7, row: 5, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 7, row: 7, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 9, row: 8, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 11, row: 5, towerType: 'archer', targetingMode: 'first' },

    // Wave 1-2 [7 builds]
    { waveIndex: 1, action: 'build', col: 9, row: 6, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 1, action: 'upgrade', col: 2, row: 6 },
    { waveIndex: 2, action: 'build', col: 13, row: 7, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 2, action: 'upgrade', col: 9, row: 6 },

    // Wave 3-4
    { waveIndex: 3, action: 'upgrade', col: 7, row: 7 },
    { waveIndex: 3, action: 'upgrade', col: 7, row: 5 },
    { waveIndex: 4, action: 'upgrade', col: 9, row: 8 },
    { waveIndex: 4, action: 'upgrade', col: 11, row: 5 },

    // Wave 5-6 [9 builds]
    { waveIndex: 5, action: 'build', col: 9, row: 9, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 5, action: 'upgrade', col: 13, row: 7 },
    { waveIndex: 6, action: 'build', col: 9, row: 5, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 6, action: 'upgrade', col: 9, row: 9 },

    // Wave 7-8 [10 builds]
    { waveIndex: 7, action: 'upgrade', col: 9, row: 5 },
    { waveIndex: 7, action: 'upgrade', col: 13, row: 7 },
    { waveIndex: 8, action: 'build', col: 2, row: 7, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 8, action: 'upgrade', col: 7, row: 7 },

    // Wave 9-10 [11 builds]
    { waveIndex: 9, action: 'upgrade', col: 2, row: 6 },
    { waveIndex: 9, action: 'upgrade', col: 9, row: 8 },
    { waveIndex: 9, action: 'upgrade', col: 9, row: 6 },
    { waveIndex: 9, action: 'upgrade', col: 2, row: 7 },

    { waveIndex: 10, action: 'build', col: 13, row: 8, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 10, action: 'upgrade', col: 13, row: 8 },
    { waveIndex: 10, action: 'upgrade', col: 11, row: 5 },

    // Wave 11-12 [13 builds]
    { waveIndex: 11, action: 'build', col: 7, row: 9, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 11, action: 'upgrade', col: 7, row: 9 },
    { waveIndex: 11, action: 'upgrade', col: 9, row: 5 },

    { waveIndex: 12, action: 'build', col: 11, row: 7, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 12, action: 'upgrade', col: 11, row: 7 },
    { waveIndex: 12, action: 'upgrade', col: 11, row: 7 },

    // Wave 13-14 (Boss 1) [15 builds]
    { waveIndex: 13, action: 'build', col: 11, row: 3, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 13, action: 'upgrade', col: 11, row: 3 },
    { waveIndex: 13, action: 'upgrade', col: 11, row: 3 },
    { waveIndex: 13, action: 'build', col: 3, row: 7, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 14, action: 'upgrade', col: 3, row: 7 },
    { waveIndex: 14, action: 'upgrade', col: 3, row: 7 },
    { waveIndex: 14, action: 'upgrade', col: 9, row: 9 },
    { waveIndex: 14, action: 'upgrade', col: 13, row: 8 },

    // Wave 15-17 [18 builds]
    { waveIndex: 14, action: 'build', col: 15, row: 6, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 14, action: 'upgrade', col: 15, row: 6 },
    { waveIndex: 15, action: 'upgrade', col: 15, row: 6 },

    { waveIndex: 15, action: 'build', col: 11, row: 9, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 15, action: 'upgrade', col: 11, row: 9 },
    { waveIndex: 15, action: 'upgrade', col: 11, row: 9 },

    { waveIndex: 16, action: 'build', col: 12, row: 9, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 16, action: 'upgrade', col: 12, row: 9 },
    { waveIndex: 16, action: 'upgrade', col: 12, row: 9 },
    { waveIndex: 16, action: 'upgrade', col: 7, row: 9 },
    { waveIndex: 16, action: 'upgrade', col: 7, row: 5 },

    { waveIndex: 17, action: 'build', col: 13, row: 5, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 17, action: 'upgrade', col: 13, row: 5 },
    { waveIndex: 17, action: 'upgrade', col: 13, row: 5 },
    { waveIndex: 17, action: 'upgrade', col: 2, row: 7 },

    // Wave 18-22 [25 builds total]
    { waveIndex: 18, action: 'build', col: 9, row: 3, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 18, action: 'upgrade', col: 9, row: 3 },
    { waveIndex: 18, action: 'upgrade', col: 9, row: 3 },

    { waveIndex: 19, action: 'build', col: 13, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 19, action: 'upgrade', col: 13, row: 3 },
    { waveIndex: 19, action: 'upgrade', col: 13, row: 3 },

    { waveIndex: 20, action: 'build', col: 7, row: 3, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 20, action: 'upgrade', col: 7, row: 3 },
    { waveIndex: 20, action: 'upgrade', col: 7, row: 3 },

    { waveIndex: 21, action: 'build', col: 7, row: 6, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 21, action: 'upgrade', col: 7, row: 6 },
    { waveIndex: 21, action: 'upgrade', col: 7, row: 6 },
    { waveIndex: 21, action: 'build', col: 3, row: 4, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 21, action: 'upgrade', col: 3, row: 4 },
    { waveIndex: 21, action: 'upgrade', col: 3, row: 4 },
    { waveIndex: 21, action: 'build', col: 1, row: 9, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 21, action: 'upgrade', col: 1, row: 9 },
    { waveIndex: 21, action: 'upgrade', col: 1, row: 9 },
  ],
  weakBuildOrder: [
    // 17 towers vs greedy's 25 (17/25 = 0.680), 0 targeting changes
    // Single frost & single mortar, heavy archer/cannon mix, omits eastern anti-air teslas & 2nd frost
    { waveIndex: 0, action: 'build', col: 2, row: 6, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 7, row: 5, towerType: 'frost' },
    { waveIndex: 0, action: 'build', col: 7, row: 7, towerType: 'tesla' },
    { waveIndex: 0, action: 'build', col: 9, row: 8, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 11, row: 5, towerType: 'archer' },

    { waveIndex: 1, action: 'build', col: 9, row: 6, towerType: 'cannon' },
    { waveIndex: 2, action: 'upgrade', col: 2, row: 6 },
    { waveIndex: 3, action: 'build', col: 13, row: 7, towerType: 'archer' },

    { waveIndex: 4, action: 'upgrade', col: 9, row: 6 },
    { waveIndex: 5, action: 'upgrade', col: 7, row: 7 },
    { waveIndex: 6, action: 'upgrade', col: 7, row: 5 },
    { waveIndex: 6, action: 'build', col: 9, row: 5, towerType: 'mortar' },

    { waveIndex: 7, action: 'upgrade', col: 9, row: 8 },
    { waveIndex: 8, action: 'upgrade', col: 11, row: 5 },
    { waveIndex: 8, action: 'build', col: 9, row: 9, towerType: 'tesla' },
    { waveIndex: 9, action: 'build', col: 2, row: 7, towerType: 'cannon' },
    { waveIndex: 9, action: 'upgrade', col: 13, row: 7 },

    { waveIndex: 11, action: 'upgrade', col: 9, row: 5 },
    { waveIndex: 12, action: 'upgrade', col: 2, row: 6 },
    { waveIndex: 12, action: 'upgrade', col: 2, row: 7 },

    { waveIndex: 13, action: 'build', col: 3, row: 7, towerType: 'archer' },
    { waveIndex: 13, action: 'upgrade', col: 3, row: 7 },
    { waveIndex: 14, action: 'upgrade', col: 9, row: 9 },
    { waveIndex: 14, action: 'upgrade', col: 7, row: 7 },

    { waveIndex: 15, action: 'build', col: 11, row: 3, towerType: 'cannon' },
    { waveIndex: 15, action: 'upgrade', col: 11, row: 3 },
    { waveIndex: 15, action: 'upgrade', col: 9, row: 5 },

    { waveIndex: 16, action: 'build', col: 13, row: 8, towerType: 'archer' },
    { waveIndex: 16, action: 'upgrade', col: 13, row: 8 },
    { waveIndex: 16, action: 'upgrade', col: 11, row: 5 },

    { waveIndex: 17, action: 'build', col: 7, row: 9, towerType: 'cannon' },
    { waveIndex: 17, action: 'upgrade', col: 7, row: 9 },
    { waveIndex: 17, action: 'upgrade', col: 9, row: 6 },

    { waveIndex: 18, action: 'build', col: 11, row: 9, towerType: 'archer' },
    { waveIndex: 18, action: 'upgrade', col: 11, row: 9 },
    { waveIndex: 18, action: 'upgrade', col: 13, row: 7 },

    { waveIndex: 19, action: 'build', col: 13, row: 3, towerType: 'cannon' },
    { waveIndex: 19, action: 'upgrade', col: 13, row: 3 },
    { waveIndex: 19, action: 'upgrade', col: 9, row: 8 },

    { waveIndex: 20, action: 'build', col: 15, row: 6, towerType: 'archer' },
    { waveIndex: 20, action: 'upgrade', col: 15, row: 6 },
    { waveIndex: 20, action: 'upgrade', col: 3, row: 7 },

    { waveIndex: 21, action: 'upgrade', col: 7, row: 5 },
    { waveIndex: 21, action: 'upgrade', col: 9, row: 9 },
    { waveIndex: 21, action: 'upgrade', col: 11, row: 3 },
    { waveIndex: 21, action: 'upgrade', col: 13, row: 8 },
    { waveIndex: 21, action: 'upgrade', col: 7, row: 9 },
    { waveIndex: 21, action: 'upgrade', col: 2, row: 7 },
  ],
};
