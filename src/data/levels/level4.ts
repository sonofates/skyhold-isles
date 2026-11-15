import type { LevelDef } from './types.ts';

export const LEVEL_4: LevelDef = {
  id: 'emerald-stepping-stones',
  index: 3,
  name: 'Emerald Stepping Stones',
  subtitle: 'Three terraced sky-islets joined by narrow timber viaducts',
  difficulty: 'Challenging',
  cols: 15,
  rows: 12,
  layout: [
    '~ T . . ~ ~ ~ T . . T ~ ~ ~ ~',
    'S P . . ~ ~ . P P P P T ~ ~ ~',
    '. P . . ~ ~ . P . . P . ~ ~ ~',
    '. P . P P P P P . . P . ~ ~ ~',
    'T P . P ~ ~ . . . . P T ~ ~ ~',
    '~ P P P ~ ~ . P P P P ~ ~ ~ ~',
    '~ T . . ~ ~ . P . . ~ ~ ~ ~ ~',
    '~ ~ ~ ~ ~ ~ . P . ~ ~ . . . T',
    '~ ~ ~ ~ ~ ~ . P P P P P P P .',
    '~ ~ ~ ~ ~ ~ ~ T . ~ ~ . . P .',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ G P P T',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ T . ~',
  ],
  pathWaypoints: [
    { col: 0, row: 1 },
    { col: 1, row: 1 },
    { col: 1, row: 5 },
    { col: 3, row: 5 },
    { col: 3, row: 3 },
    { col: 7, row: 3 },
    { col: 7, row: 1 },
    { col: 10, row: 1 },
    { col: 10, row: 5 },
    { col: 7, row: 5 },
    { col: 7, row: 8 },
    { col: 13, row: 8 },
    { col: 13, row: 10 },
    { col: 11, row: 10 },
  ],
  flightPath: [
    { col: 0, row: 1 },
    { col: 2, row: 4 },
    { col: 6, row: 3 },
    { col: 10, row: 5 },
    { col: 11, row: 8 },
    { col: 11, row: 10 },
  ],
  decorationSeed: 441907,
  startingGold: 250,
  enemyHpScale: 1.24,
  waveHpGrowth: 0.258,
  waves: [
    {
      clearBonus: 14,
      groups: [
        { enemyType: 'grunt', count: 12, spawnInterval: 0.8, startDelay: 0 },
        { enemyType: 'runner', count: 6, spawnInterval: 0.6, startDelay: 4.0 },
      ],
    },
    {
      clearBonus: 16,
      groups: [
        { enemyType: 'runner', count: 14, spawnInterval: 0.52, startDelay: 0 },
        { enemyType: 'grunt', count: 10, spawnInterval: 0.72, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 18,
      groups: [
        { enemyType: 'flyer', count: 10, spawnInterval: 0.68, startDelay: 0 },
        { enemyType: 'grunt', count: 14, spawnInterval: 0.65, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 20,
      groups: [
        { enemyType: 'brute', count: 6, spawnInterval: 1.3, startDelay: 0 },
        { enemyType: 'runner', count: 14, spawnInterval: 0.48, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 22,
      groups: [
        { enemyType: 'flyer', count: 14, spawnInterval: 0.56, startDelay: 0 },
        { enemyType: 'brute', count: 6, spawnInterval: 1.25, startDelay: 1.5 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.8, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 24,
      groups: [
        { enemyType: 'grunt', count: 18, spawnInterval: 0.5, startDelay: 0 },
        { enemyType: 'runner', count: 16, spawnInterval: 0.42, startDelay: 2.0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.6, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 26,
      groups: [
        { enemyType: 'flyer', count: 20, spawnInterval: 0.46, startDelay: 0 },
        { enemyType: 'runner', count: 18, spawnInterval: 0.4, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 28,
      groups: [
        { enemyType: 'brute', count: 11, spawnInterval: 0.95, startDelay: 0 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.45, startDelay: 1.2 },
        { enemyType: 'flyer', count: 16, spawnInterval: 0.5, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 32,
      groups: [
        { enemyType: 'runner', count: 26, spawnInterval: 0.34, startDelay: 0 },
        { enemyType: 'grunt', count: 20, spawnInterval: 0.44, startDelay: 2.0 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.4, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 36,
      groups: [
        { enemyType: 'brute', count: 13, spawnInterval: 0.85, startDelay: 0 },
        { enemyType: 'flyer', count: 18, spawnInterval: 0.48, startDelay: 1.5 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.3, startDelay: 2.2 },
      ],
    },
    {
      clearBonus: 40,
      groups: [
        { enemyType: 'runner', count: 28, spawnInterval: 0.32, startDelay: 0 },
        { enemyType: 'brute', count: 12, spawnInterval: 0.85, startDelay: 1.8 },
        { enemyType: 'flyer', count: 20, spawnInterval: 0.45, startDelay: 2.8 },
      ],
    },
    {
      clearBonus: 44,
      groups: [
        { enemyType: 'brute', count: 15, spawnInterval: 0.78, startDelay: 0 },
        { enemyType: 'healer', count: 7, spawnInterval: 1.15, startDelay: 1.2 },
        { enemyType: 'flyer', count: 22, spawnInterval: 0.42, startDelay: 2.2 },
      ],
    },
    {
      clearBonus: 50,
      groups: [
        { enemyType: 'brute', count: 14, spawnInterval: 0.78, startDelay: 0 },
        { enemyType: 'runner', count: 26, spawnInterval: 0.32, startDelay: 1.8 },
        { enemyType: 'flyer', count: 24, spawnInterval: 0.4, startDelay: 2.8 },
        { enemyType: 'healer', count: 7, spawnInterval: 1.15, startDelay: 3.2 },
      ],
    },
    {
      clearBonus: 75,
      groups: [
        { enemyType: 'brute', count: 16, spawnInterval: 0.74, startDelay: 0 },
        { enemyType: 'healer', count: 8, spawnInterval: 1.1, startDelay: 1.0 },
        { enemyType: 'flyer', count: 28, spawnInterval: 0.38, startDelay: 2.0 },
        { enemyType: 'boss', count: 2, spawnInterval: 4.0, startDelay: 4.0 },
      ],
    },
  ],
  scriptedBuildOrder: [
    { waveIndex: 0, action: 'build', col: 2, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 2, row: 4, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 3, row: 2, towerType: 'cannon', targetingMode: 'first' },

    { waveIndex: 1, action: 'build', col: 2, row: 2, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 1, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 2, action: 'build', col: 7, row: 4, towerType: 'tesla', targetingMode: 'first' },

    { waveIndex: 3, action: 'upgrade', col: 3, row: 2 },
    { waveIndex: 3, action: 'upgrade', col: 2, row: 4 },
    { waveIndex: 4, action: 'build', col: 8, row: 3, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 4, action: 'upgrade', col: 2, row: 2 },

    { waveIndex: 5, action: 'build', col: 6, row: 6, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 5, action: 'upgrade', col: 7, row: 4 },
    { waveIndex: 6, action: 'build', col: 9, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 6, action: 'upgrade', col: 8, row: 3 },

    { waveIndex: 7, action: 'build', col: 6, row: 4, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 7, action: 'upgrade', col: 6, row: 6 },
    { waveIndex: 8, action: 'build', col: 8, row: 6, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 8, action: 'upgrade', col: 9, row: 3 },

    { waveIndex: 9, action: 'build', col: 8, row: 7, towerType: 'tesla', targetingMode: 'strongest' },
    { waveIndex: 9, action: 'upgrade', col: 7, row: 4 },
    { waveIndex: 9, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 10, action: 'upgrade', col: 6, row: 6 },
    { waveIndex: 10, action: 'upgrade', col: 8, row: 7 },
    { waveIndex: 10, action: 'build', col: 12, row: 7, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 11, action: 'build', col: 11, row: 9, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 11, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 11, action: 'build', col: 12, row: 9, towerType: 'tesla', targetingMode: 'first' },

    { waveIndex: 12, action: 'upgrade', col: 12, row: 7 },
    { waveIndex: 12, action: 'upgrade', col: 11, row: 9 },
    { waveIndex: 12, action: 'upgrade', col: 12, row: 9 },
    { waveIndex: 12, action: 'build', col: 8, row: 9, towerType: 'mortar', targetingMode: 'strongest' },

    { waveIndex: 13, action: 'build', col: 9, row: 4, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 13, action: 'build', col: 11, row: 7, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 13, action: 'upgrade', col: 8, row: 9 },
    { waveIndex: 13, action: 'upgrade', col: 8, row: 3 },
    { waveIndex: 13, action: 'upgrade', col: 2, row: 4 },
    { waveIndex: 13, action: 'upgrade', col: 6, row: 4 },
    { waveIndex: 13, action: 'upgrade', col: 9, row: 4 },
    { waveIndex: 13, action: 'upgrade', col: 11, row: 7 },
  ],
  weakBuildOrder: [
    { waveIndex: 0, action: 'build', col: 2, row: 3, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 2, row: 4, towerType: 'frost' },
    { waveIndex: 0, action: 'build', col: 3, row: 2, towerType: 'cannon' },

    { waveIndex: 1, action: 'build', col: 2, row: 2, towerType: 'archer' },
    { waveIndex: 2, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 2, action: 'build', col: 7, row: 4, towerType: 'tesla' },

    { waveIndex: 3, action: 'upgrade', col: 3, row: 2 },
    { waveIndex: 4, action: 'upgrade', col: 2, row: 4 },
    { waveIndex: 5, action: 'build', col: 8, row: 3, towerType: 'cannon' },

    { waveIndex: 6, action: 'upgrade', col: 2, row: 2 },
    { waveIndex: 6, action: 'build', col: 9, row: 3, towerType: 'archer' },
    { waveIndex: 7, action: 'upgrade', col: 7, row: 4 },
    { waveIndex: 8, action: 'upgrade', col: 8, row: 3 },

    { waveIndex: 9, action: 'build', col: 8, row: 6, towerType: 'cannon' },
    { waveIndex: 9, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 10, action: 'build', col: 8, row: 7, towerType: 'tesla' },
    { waveIndex: 10, action: 'upgrade', col: 9, row: 3 },

    { waveIndex: 11, action: 'build', col: 11, row: 9, towerType: 'cannon' },
    { waveIndex: 11, action: 'upgrade', col: 8, row: 7 },
    { waveIndex: 11, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 12, action: 'build', col: 12, row: 7, towerType: 'archer' },
    { waveIndex: 12, action: 'upgrade', col: 11, row: 9 },

    { waveIndex: 12, action: 'upgrade', col: 3, row: 2 },
    { waveIndex: 13, action: 'build', col: 12, row: 9, towerType: 'cannon' },
    { waveIndex: 13, action: 'upgrade', col: 12, row: 7 },
    { waveIndex: 13, action: 'upgrade', col: 12, row: 9 },
    { waveIndex: 13, action: 'upgrade', col: 7, row: 4 },
    { waveIndex: 13, action: 'upgrade', col: 8, row: 3 },
    { waveIndex: 13, action: 'upgrade', col: 2, row: 4 },
    { waveIndex: 13, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 13, action: 'upgrade', col: 9, row: 3 },
    { waveIndex: 13, action: 'upgrade', col: 8, row: 7 },
    { waveIndex: 13, action: 'upgrade', col: 11, row: 9 },
    { waveIndex: 13, action: 'upgrade', col: 12, row: 9 },
  ],
};
