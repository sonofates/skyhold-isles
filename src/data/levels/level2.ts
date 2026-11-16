import type { LevelDef } from './types.ts';

export const LEVEL_2: LevelDef = {
  id: 'twin-bridge-cay',
  index: 1,
  name: 'Twin-Bridge Cay',
  subtitle: 'Harbour cay of timber docks and bobbing boats, split by a channel and twin bridges',
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
  startingGold: 260,
  enemyHpScale: 1.2,
  waveHpGrowth: 0.18,
  waves: [
    {
      name: 'Harbor Watch',
      clearBonus: 22,
      groups: [
        { enemyType: 'grunt', count: 10, spawnInterval: 0.9, startDelay: 0 },
      ],
    },
    {
      name: 'Tide Scouts',
      clearBonus: 28,
      groups: [
        { enemyType: 'grunt', count: 10, spawnInterval: 0.85, startDelay: 0 },
        { enemyType: 'runner', count: 6, spawnInterval: 0.65, startDelay: 3.5 },
      ],
    },
    {
      name: 'Gull Run',
      clearBonus: 26,
      groups: [
        { enemyType: 'runner', count: 12, spawnInterval: 0.55, startDelay: 0 },
        { enemyType: 'flyer', count: 4, spawnInterval: 0.95, startDelay: 2.5 },
      ],
    },
    {
      name: 'Iron Hulls',
      clearBonus: 28,
      groups: [
        { enemyType: 'brute', count: 4, spawnInterval: 1.5, startDelay: 0 },
        { enemyType: 'grunt', count: 12, spawnInterval: 0.7, startDelay: 2 },
      ],
    },
    {
      name: 'Skyward Sails',
      clearBonus: 30,
      groups: [
        { enemyType: 'flyer', count: 9, spawnInterval: 0.78, startDelay: 0 },
        { enemyType: 'healer', count: 2, spawnInterval: 2, startDelay: 2.5 },
        { enemyType: 'runner', count: 10, spawnInterval: 0.52, startDelay: 4 },
      ],
    },
    {
      name: 'Convoy',
      clearBonus: 34,
      groups: [
        { enemyType: 'brute', count: 6, spawnInterval: 1.3, startDelay: 0 },
        { enemyType: 'healer', count: 3, spawnInterval: 2, startDelay: 1.5 },
        { enemyType: 'grunt', count: 14, spawnInterval: 0.6, startDelay: 3.5 },
      ],
    },
    {
      name: 'Cinder Tide',
      clearBonus: 38,
      groups: [
        { enemyType: 'runner', count: 14, spawnInterval: 0.44, startDelay: 0 },
        { enemyType: 'splitter', count: 5, spawnInterval: 1.1, startDelay: 1.2 },
        { enemyType: 'flyer', count: 9, spawnInterval: 0.68, startDelay: 2.2 },
      ],
    },
    {
      name: 'The Armada',
      clearBonus: 46,
      groups: [
        { enemyType: 'brute', count: 8, spawnInterval: 1.15, startDelay: 0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.7, startDelay: 1.5 },
        { enemyType: 'flyer', count: 9, spawnInterval: 0.72, startDelay: 3 },
      ],
    },
    {
      name: 'Twin-Bridge Rush',
      clearBonus: 52,
      groups: [
        { enemyType: 'grunt', count: 16, spawnInterval: 0.48, startDelay: 0 },
        { enemyType: 'splitter', count: 5, spawnInterval: 1.1, startDelay: 1.5 },
        { enemyType: 'runner', count: 14, spawnInterval: 0.44, startDelay: 9 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.65, startDelay: 10.5 },
      ],
    },
    {
      name: 'Ironclad Tide',
      clearBonus: 58,
      groups: [
        { enemyType: 'brute', count: 9, spawnInterval: 1, startDelay: 0 },
        { enemyType: 'flyer', count: 11, spawnInterval: 0.62, startDelay: 1.5 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.5, startDelay: 2.5 },
      ],
    },
    {
      name: 'Cinder Surge',
      clearBonus: 66,
      groups: [
        { enemyType: 'runner', count: 15, spawnInterval: 0.42, startDelay: 0 },
        { enemyType: 'splitter', count: 6, spawnInterval: 1, startDelay: 1.4 },
        { enemyType: 'brute', count: 8, spawnInterval: 1, startDelay: 2.5 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.5, startDelay: 3.5 },
      ],
    },
    {
      name: 'Gale Force',
      clearBonus: 74,
      groups: [
        { enemyType: 'flyer', count: 14, spawnInterval: 0.52, startDelay: 0 },
        { enemyType: 'brute', count: 11, spawnInterval: 0.88, startDelay: 2 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.3, startDelay: 3 },
      ],
    },
    {
      name: 'Spring Tide',
      clearBonus: 82,
      groups: [
        { enemyType: 'brute', count: 12, spawnInterval: 0.85, startDelay: 0 },
        { enemyType: 'runner', count: 22, spawnInterval: 0.36, startDelay: 2 },
        { enemyType: 'flyer', count: 14, spawnInterval: 0.54, startDelay: 3.5 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.25, startDelay: 4 },
      ],
    },
    {
      name: 'Dreadnought Fleet',
      clearBonus: 95,
      groups: [
        { enemyType: 'brute', count: 5, spawnInterval: 1, startDelay: 0 },
        { enemyType: 'splitter', count: 3, spawnInterval: 1.1, startDelay: 1 },
        { enemyType: 'healer', count: 2, spawnInterval: 1.8, startDelay: 1.5 },
        { enemyType: 'flyer', count: 10, spawnInterval: 0.6, startDelay: 2.5 },
        { enemyType: 'boss', count: 2, spawnInterval: 7, startDelay: 4.5 },
      ],
    },
  ],
  scriptedBuildOrder: [
    { waveIndex: 0, action: 'build', col: 2, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 4, row: 5, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 2, row: 5, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 5, row: 8, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 1, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 2, action: 'build', col: 5, row: 5, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 3, action: 'upgrade', col: 2, row: 5 },

    { waveIndex: 4, action: 'upgrade', col: 4, row: 5 },
    { waveIndex: 4, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 4, action: 'build', col: 4, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 5, action: 'upgrade', col: 4, row: 3 },

    { waveIndex: 5, action: 'build', col: 11, row: 5, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 6, action: 'build', col: 5, row: 6, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 6, action: 'upgrade', col: 5, row: 5 },
    { waveIndex: 7, action: 'upgrade', col: 11, row: 5 },

    { waveIndex: 8, action: 'build', col: 3, row: 8, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 8, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 9, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 9, action: 'upgrade', col: 5, row: 8 },

    { waveIndex: 10, action: 'build', col: 10, row: 6, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 10, action: 'upgrade', col: 10, row: 6 },
    { waveIndex: 11, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 11, action: 'upgrade', col: 5, row: 5 },

    { waveIndex: 12, action: 'build', col: 11, row: 6, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 12, action: 'upgrade', col: 11, row: 6 },
    { waveIndex: 12, action: 'upgrade', col: 3, row: 8 },
    { waveIndex: 13, action: 'build', col: 7, row: 9, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 13, action: 'upgrade', col: 7, row: 9 },
    { waveIndex: 13, action: 'build', col: 9, row: 8, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 13, action: 'upgrade', col: 9, row: 8 },
  ],
  weakBuildOrder: [
    { waveIndex: 0, action: 'build', col: 2, row: 3, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 4, row: 5, towerType: 'frost' },
    { waveIndex: 0, action: 'build', col: 2, row: 5, towerType: 'cannon' },
    { waveIndex: 0, action: 'build', col: 5, row: 8, towerType: 'archer' },

    { waveIndex: 1, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 2, action: 'build', col: 5, row: 5, towerType: 'tesla' },
    { waveIndex: 3, action: 'upgrade', col: 2, row: 5 },
    { waveIndex: 4, action: 'upgrade', col: 4, row: 5 },

    { waveIndex: 4, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 5, action: 'build', col: 11, row: 5, towerType: 'cannon' },
    { waveIndex: 6, action: 'upgrade', col: 5, row: 5 },
    { waveIndex: 7, action: 'build', col: 3, row: 8, towerType: 'tesla' },

    { waveIndex: 8, action: 'upgrade', col: 11, row: 5 },
    { waveIndex: 9, action: 'build', col: 7, row: 9, towerType: 'archer' },
    { waveIndex: 9, action: 'upgrade', col: 7, row: 9 },
    { waveIndex: 10, action: 'upgrade', col: 3, row: 8 },

    { waveIndex: 11, action: 'build', col: 5, row: 6, towerType: 'mortar' },
    { waveIndex: 11, action: 'upgrade', col: 2, row: 3 },
    { waveIndex: 12, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 12, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 13, action: 'upgrade', col: 5, row: 5 },
  ],
};
