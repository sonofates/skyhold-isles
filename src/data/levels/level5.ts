import type { LevelDef } from './types.ts';

export const LEVEL_5: LevelDef = {
  id: 'windmill-switchback',
  index: 4,
  name: 'Windmill Switchback',
  subtitle: 'Twin hairpins around golden wheat fields, creaking windmills and autumn orchards',
  difficulty: 'Challenging',
  cols: 15,
  rows: 12,
  layout: [
    '~ T . . . . . ~ ~ ~ ~ ~ T . ~',
    '~ . . . . . . ~ ~ ~ ~ ~ . G ~',
    '~ . P P P P P ~ ~ ~ . ~ . P ~',
    '~ . P . . . P ~ ~ . P P P P ~',
    '~ T P . . . P . T . P ~ . T ~',
    '~ . P . ~ ~ P . . . P ~ ~ ~ ~',
    '~ . P . ~ ~ P . . . P ~ ~ ~ ~',
    '~ . P ~ ~ ~ P . . . P ~ ~ ~ ~',
    '~ . P ~ ~ ~ P . . . P ~ ~ ~ ~',
    'S P P ~ ~ ~ P P P P P ~ ~ ~ ~',
    '~ . T ~ ~ ~ . . T . . ~ ~ ~ ~',
    '~ ~ ~ ~ ~ ~ ~ . . ~ ~ ~ ~ ~ ~',
  ],
  pathWaypoints: [
    { col: 0, row: 9 },
    { col: 2, row: 9 },
    { col: 2, row: 2 },
    { col: 6, row: 2 },
    { col: 6, row: 9 },
    { col: 10, row: 9 },
    { col: 10, row: 3 },
    { col: 13, row: 3 },
    { col: 13, row: 1 },
  ],
  flightPath: [
    { col: 0, row: 9 },
    { col: 4, row: 7 },
    { col: 7, row: 8 },
    { col: 9, row: 6 },
    { col: 8, row: 4 },
    { col: 11, row: 5 },
    { col: 11, row: 3 },
    { col: 13, row: 1 },
  ],
  decorationSeed: 552811,
  startingGold: 270,
  enemyHpScale: 1.2,
  waveHpGrowth: 0.185,
  waves: [
    {
      name: 'Early Harvest',
      clearBonus: 16,
      groups: [
        { enemyType: 'grunt', count: 9, spawnInterval: 0.85, startDelay: 0 },
      ],
    },
    {
      name: 'Field Hands',
      clearBonus: 18,
      groups: [
        { enemyType: 'grunt', count: 8, spawnInterval: 0.78, startDelay: 0 },
        { enemyType: 'runner', count: 7, spawnInterval: 0.55, startDelay: 2.5 },
      ],
    },
    {
      name: 'Whirlwind',
      clearBonus: 20,
      groups: [
        { enemyType: 'runner', count: 12, spawnInterval: 0.45, startDelay: 0 },
        { enemyType: 'flyer', count: 8, spawnInterval: 0.65, startDelay: 1.8 },
      ],
    },
    {
      name: 'Iron Plough',
      clearBonus: 22,
      groups: [
        { enemyType: 'brute', count: 5, spawnInterval: 1.25, startDelay: 0 },
        { enemyType: 'grunt', count: 10, spawnInterval: 0.6, startDelay: 1.5 },
      ],
    },
    {
      name: 'Crow Flock',
      clearBonus: 24,
      groups: [
        { enemyType: 'flyer', count: 16, spawnInterval: 0.42, startDelay: 0 },
        { enemyType: 'healer', count: 2, spawnInterval: 1.6, startDelay: 1.8 },
        { enemyType: 'runner', count: 10, spawnInterval: 0.4, startDelay: 3 },
      ],
    },
    {
      name: 'Hay Fire',
      clearBonus: 28,
      groups: [
        { enemyType: 'brute', count: 6, spawnInterval: 1.05, startDelay: 0 },
        { enemyType: 'splitter', count: 5, spawnInterval: 1, startDelay: 1.2 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.5, startDelay: 1.5 },
        { enemyType: 'grunt', count: 10, spawnInterval: 0.48, startDelay: 2.8 },
      ],
    },
    {
      name: 'Gale Force',
      clearBonus: 32,
      groups: [
        { enemyType: 'runner', count: 20, spawnInterval: 0.32, startDelay: 0 },
        { enemyType: 'flyer', count: 18, spawnInterval: 0.36, startDelay: 1.2 },
      ],
    },
    {
      name: 'Threshing Day',
      clearBonus: 36,
      groups: [
        { enemyType: 'brute', count: 9, spawnInterval: 0.88, startDelay: 0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.3, startDelay: 1 },
        { enemyType: 'flyer', count: 18, spawnInterval: 0.38, startDelay: 2 },
      ],
    },
    {
      name: 'Cinder Chaff',
      clearBonus: 40,
      groups: [
        { enemyType: 'grunt', count: 14, spawnInterval: 0.38, startDelay: 0 },
        { enemyType: 'splitter', count: 7, spawnInterval: 0.9, startDelay: 1.2 },
        { enemyType: 'runner', count: 16, spawnInterval: 0.3, startDelay: 2.2 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.25, startDelay: 3 },
      ],
    },
    {
      name: "Scarecrow's Gambit",
      clearBonus: 44,
      groups: [
        { enemyType: 'brute', count: 10, spawnInterval: 0.8, startDelay: 0 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.2, startDelay: 2 },
        { enemyType: 'flyer', count: 23, spawnInterval: 0.32, startDelay: 8.5 },
      ],
    },
    {
      name: 'Harvest Storm',
      clearBonus: 48,
      groups: [
        { enemyType: 'runner', count: 20, spawnInterval: 0.28, startDelay: 0 },
        { enemyType: 'splitter', count: 8, spawnInterval: 0.85, startDelay: 1.2 },
        { enemyType: 'brute', count: 10, spawnInterval: 0.78, startDelay: 2 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.15, startDelay: 2.8 },
      ],
    },
    {
      name: 'Hailstorm',
      clearBonus: 54,
      groups: [
        { enemyType: 'flyer', count: 25, spawnInterval: 0.3, startDelay: 0 },
        { enemyType: 'brute', count: 13, spawnInterval: 0.72, startDelay: 1.2 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.05, startDelay: 2.2 },
      ],
    },
    {
      name: 'Windmill Siege',
      clearBonus: 60,
      groups: [
        { enemyType: 'brute', count: 13, spawnInterval: 0.68, startDelay: 0 },
        { enemyType: 'splitter', count: 9, spawnInterval: 0.8, startDelay: 1 },
        { enemyType: 'runner', count: 20, spawnInterval: 0.28, startDelay: 1.8 },
        { enemyType: 'flyer', count: 23, spawnInterval: 0.32, startDelay: 2.4 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.05, startDelay: 3 },
      ],
    },
    {
      name: 'Locust Cloud',
      clearBonus: 68,
      groups: [
        { enemyType: 'flyer', count: 26, spawnInterval: 0.28, startDelay: 0 },
        { enemyType: 'brute', count: 16, spawnInterval: 0.62, startDelay: 1 },
        { enemyType: 'healer', count: 7, spawnInterval: 0.95, startDelay: 1.8 },
        { enemyType: 'grunt', count: 16, spawnInterval: 0.34, startDelay: 2.8 },
      ],
    },
    {
      name: 'Harvest Dreadnought',
      clearBonus: 90,
      groups: [
        { enemyType: 'brute', count: 14, spawnInterval: 0.65, startDelay: 0 },
        { enemyType: 'splitter', count: 8, spawnInterval: 0.85, startDelay: 0.9 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.05, startDelay: 1.2 },
        { enemyType: 'flyer', count: 25, spawnInterval: 0.29, startDelay: 1.8 },
        { enemyType: 'runner', count: 18, spawnInterval: 0.26, startDelay: 2.6 },
        { enemyType: 'boss', count: 2, spawnInterval: 5.5, startDelay: 3.8 },
      ],
    },
  ],
  scriptedBuildOrder: [
    { waveIndex: 0, action: 'build', col: 8, row: 7, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 8, row: 6, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 7, row: 6, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 9, row: 5, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 1, action: 'upgrade', col: 7, row: 6 },
    { waveIndex: 2, action: 'build', col: 8, row: 5, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 3, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 3, action: 'upgrade', col: 8, row: 7 },

    { waveIndex: 4, action: 'upgrade', col: 9, row: 5 },
    { waveIndex: 4, action: 'build', col: 10, row: 2, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 5, action: 'build', col: 7, row: 7, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 5, action: 'upgrade', col: 8, row: 5 },

    { waveIndex: 6, action: 'upgrade', col: 10, row: 2 },
    { waveIndex: 6, action: 'build', col: 7, row: 5, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 7, action: 'upgrade', col: 7, row: 7 },
    { waveIndex: 7, action: 'upgrade', col: 7, row: 5 },

    { waveIndex: 8, action: 'build', col: 9, row: 7, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 8, action: 'upgrade', col: 9, row: 7 },
    { waveIndex: 9, action: 'upgrade', col: 7, row: 6 },
    { waveIndex: 9, action: 'upgrade', col: 8, row: 5 },

    { waveIndex: 9, action: 'build', col: 9, row: 4, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 10, action: 'upgrade', col: 7, row: 7 },
    { waveIndex: 10, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 11, action: 'build', col: 12, row: 2, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 11, action: 'upgrade', col: 8, row: 7 },
    { waveIndex: 11, action: 'upgrade', col: 9, row: 4 },
    { waveIndex: 12, action: 'build', col: 8, row: 8, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 12, action: 'upgrade', col: 9, row: 7 },

    { waveIndex: 12, action: 'build', col: 3, row: 4, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 13, action: 'upgrade', col: 12, row: 2 },
    { waveIndex: 13, action: 'build', col: 3, row: 3, towerType: 'tesla', targetingMode: 'strongest' },
    { waveIndex: 13, action: 'upgrade', col: 3, row: 3 },

    { waveIndex: 13, action: 'upgrade', col: 9, row: 5 },
    { waveIndex: 14, action: 'build', col: 9, row: 6, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 14, action: 'upgrade', col: 9, row: 6 },
    { waveIndex: 14, action: 'build', col: 12, row: 1, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 14, action: 'upgrade', col: 7, row: 5 },
    { waveIndex: 14, action: 'upgrade', col: 8, row: 8 },
  ],
  weakBuildOrder: [
    { waveIndex: 0, action: 'build', col: 8, row: 7, towerType: 'frost' },
    { waveIndex: 0, action: 'build', col: 8, row: 6, towerType: 'cannon' },
    { waveIndex: 0, action: 'build', col: 7, row: 6, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 9, row: 5, towerType: 'archer' },

    { waveIndex: 1, action: 'upgrade', col: 7, row: 6 },
    { waveIndex: 2, action: 'build', col: 8, row: 5, towerType: 'tesla' },
    { waveIndex: 3, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 4, action: 'upgrade', col: 8, row: 7 },

    { waveIndex: 5, action: 'upgrade', col: 9, row: 5 },
    { waveIndex: 5, action: 'build', col: 10, row: 2, towerType: 'archer' },
    { waveIndex: 6, action: 'build', col: 7, row: 7, towerType: 'mortar' },
    { waveIndex: 7, action: 'upgrade', col: 8, row: 5 },

    { waveIndex: 8, action: 'upgrade', col: 10, row: 2 },
    { waveIndex: 9, action: 'build', col: 5, row: 3, towerType: 'cannon' },
    { waveIndex: 9, action: 'upgrade', col: 5, row: 3 },
    { waveIndex: 10, action: 'build', col: 3, row: 4, towerType: 'archer' },

    { waveIndex: 11, action: 'upgrade', col: 7, row: 7 },
    { waveIndex: 11, action: 'build', col: 1, row: 6, towerType: 'cannon' },
    { waveIndex: 12, action: 'build', col: 12, row: 2, towerType: 'archer' },
    { waveIndex: 12, action: 'upgrade', col: 3, row: 4 },

    { waveIndex: 13, action: 'upgrade', col: 1, row: 6 },
    { waveIndex: 13, action: 'upgrade', col: 7, row: 6 },
    { waveIndex: 13, action: 'upgrade', col: 8, row: 5 },
    { waveIndex: 14, action: 'upgrade', col: 7, row: 7 },

    { waveIndex: 14, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 14, action: 'upgrade', col: 9, row: 5 },
    { waveIndex: 14, action: 'upgrade', col: 12, row: 2 },
    { waveIndex: 14, action: 'upgrade', col: 8, row: 7 },
  ],
};
