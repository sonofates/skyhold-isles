import type { LevelDef } from './types.ts';

export const LEVEL_3: LevelDef = {
  id: 'highland-citadel',
  index: 2,
  name: 'Highland Citadel',
  subtitle: 'A spiraling mountain keep beset by armored sieges and sky raids',
  difficulty: 'Heroic',
  cols: 16,
  rows: 12,
  layout: [
    '~ ~ ~ T . . . T . . . T . . ~ ~',
    '~ T . . . . . . . . . . . T . ~',
    '~ . . P P P P P P P P P P . . ~',
    'S P P P . . . T . . . . P . T ~',
    '~ . . . . T . . . . T . P . . ~',
    '~ T . . P P P P P P . . P . . T',
    '~ . . . P . . . . P . . P . T ~',
    '~ . T . P . G P . P . . P . . ~',
    '~ . . . P . . P . P . T P . . ~',
    '~ ~ T . P P P P . P P P P . T ~',
    '~ ~ ~ . . . . . . . . . . . ~ ~',
    '~ ~ ~ ~ T . . T ~ ~ T . T ~ ~ ~',
  ],
  pathWaypoints: [
    { col: 0, row: 3 },
    { col: 3, row: 3 },
    { col: 3, row: 2 },
    { col: 12, row: 2 },
    { col: 12, row: 9 },
    { col: 9, row: 9 },
    { col: 9, row: 5 },
    { col: 4, row: 5 },
    { col: 4, row: 9 },
    { col: 7, row: 9 },
    { col: 7, row: 7 },
    { col: 6, row: 7 },
  ],
  flightPath: [
    { col: 0, row: 3 },
    { col: 3, row: 5 },
    { col: 7, row: 4 },
    { col: 11, row: 5 },
    { col: 10, row: 8 },
    { col: 6, row: 9 },
    { col: 4, row: 8 },
    { col: 6, row: 7 },
  ],
  decorationSeed: 381923,
  startingGold: 280,
  enemyHpScale: 1.45,
  waveHpGrowth: 0.2,
  waves: [
    {
      name: 'Gate Patrol',
      clearBonus: 18,
      groups: [
        { enemyType: 'grunt', count: 12, spawnInterval: 0.8, startDelay: 0 },
        { enemyType: 'runner', count: 6, spawnInterval: 0.65, startDelay: 4 },
      ],
    },
    {
      name: 'Mountain Scouts',
      clearBonus: 20,
      groups: [
        { enemyType: 'runner', count: 14, spawnInterval: 0.55, startDelay: 0 },
        { enemyType: 'grunt', count: 10, spawnInterval: 0.75, startDelay: 3 },
      ],
    },
    {
      name: 'Eagle Hunt',
      clearBonus: 22,
      groups: [
        { enemyType: 'brute', count: 5, spawnInterval: 1.4, startDelay: 0 },
        { enemyType: 'flyer', count: 8, spawnInterval: 0.78, startDelay: 2 },
      ],
    },
    {
      name: 'Foothill Raid',
      clearBonus: 24,
      groups: [
        { enemyType: 'grunt', count: 16, spawnInterval: 0.55, startDelay: 0 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.9, startDelay: 2 },
        { enemyType: 'runner', count: 12, spawnInterval: 0.5, startDelay: 4.5 },
      ],
    },
    {
      name: 'Talon Storm',
      clearBonus: 26,
      groups: [
        { enemyType: 'flyer', count: 14, spawnInterval: 0.62, startDelay: 0 },
        { enemyType: 'brute', count: 7, spawnInterval: 1.2, startDelay: 2 },
      ],
    },
    {
      name: 'Cinder Pass',
      clearBonus: 30,
      groups: [
        { enemyType: 'brute', count: 7, spawnInterval: 1.15, startDelay: 0 },
        { enemyType: 'splitter', count: 5, spawnInterval: 1.05, startDelay: 1.2 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.7, startDelay: 1.8 },
        { enemyType: 'runner', count: 14, spawnInterval: 0.48, startDelay: 3.5 },
      ],
    },
    {
      name: 'Wind Walkers',
      clearBonus: 32,
      groups: [
        { enemyType: 'flyer', count: 16, spawnInterval: 0.56, startDelay: 0 },
        { enemyType: 'grunt', count: 20, spawnInterval: 0.46, startDelay: 1.5 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.5, startDelay: 3.5 },
      ],
    },
    {
      name: 'Siege Engines',
      clearBonus: 36,
      groups: [
        { enemyType: 'brute', count: 11, spawnInterval: 0.95, startDelay: 0 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.4, startDelay: 1.5 },
        { enemyType: 'flyer', count: 14, spawnInterval: 0.55, startDelay: 3.5 },
      ],
    },
    {
      name: 'Avalanche',
      clearBonus: 40,
      groups: [
        { enemyType: 'runner', count: 26, spawnInterval: 0.36, startDelay: 0 },
        { enemyType: 'brute', count: 10, spawnInterval: 0.9, startDelay: 10 },
      ],
    },
    {
      name: 'The Warden',
      clearBonus: 44,
      groups: [
        { enemyType: 'brute', count: 12, spawnInterval: 0.85, startDelay: 0 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.25, startDelay: 1.5 },
        { enemyType: 'boss', count: 1, spawnInterval: 1, startDelay: 5 },
      ],
    },
    {
      name: 'Ember Skies',
      clearBonus: 48,
      groups: [
        { enemyType: 'flyer', count: 21, spawnInterval: 0.48, startDelay: 0 },
        { enemyType: 'splitter', count: 8, spawnInterval: 0.9, startDelay: 1.4 },
        { enemyType: 'runner', count: 20, spawnInterval: 0.38, startDelay: 2.5 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.25, startDelay: 3.5 },
      ],
    },
    {
      name: 'Granite Wall',
      clearBonus: 52,
      groups: [
        { enemyType: 'brute', count: 16, spawnInterval: 0.78, startDelay: 0 },
        { enemyType: 'healer', count: 7, spawnInterval: 1.15, startDelay: 1.5 },
        { enemyType: 'grunt', count: 24, spawnInterval: 0.4, startDelay: 3 },
      ],
    },
    {
      name: 'Raptor Swarm',
      clearBonus: 56,
      groups: [
        { enemyType: 'flyer', count: 24, spawnInterval: 0.44, startDelay: 0 },
        { enemyType: 'brute', count: 14, spawnInterval: 0.8, startDelay: 2 },
        { enemyType: 'healer', count: 7, spawnInterval: 1.1, startDelay: 3 },
      ],
    },
    {
      name: 'Landslide',
      clearBonus: 60,
      groups: [
        { enemyType: 'runner', count: 28, spawnInterval: 0.32, startDelay: 0 },
        { enemyType: 'splitter', count: 9, spawnInterval: 0.85, startDelay: 1.2 },
        { enemyType: 'brute', count: 15, spawnInterval: 0.78, startDelay: 2.2 },
        { enemyType: 'flyer', count: 22, spawnInterval: 0.45, startDelay: 3.5 },
      ],
    },
    {
      name: 'Twin Wardens',
      clearBonus: 66,
      groups: [
        { enemyType: 'brute', count: 16, spawnInterval: 0.74, startDelay: 0 },
        { enemyType: 'healer', count: 7, spawnInterval: 1.15, startDelay: 1.5 },
        { enemyType: 'boss', count: 2, spawnInterval: 5.5, startDelay: 4.5 },
      ],
    },
    {
      name: 'Blizzard of Wings',
      clearBonus: 72,
      groups: [
        { enemyType: 'flyer', count: 28, spawnInterval: 0.4, startDelay: 0 },
        { enemyType: 'splitter', count: 10, spawnInterval: 0.8, startDelay: 1.4 },
        { enemyType: 'runner', count: 32, spawnInterval: 0.3, startDelay: 2.4 },
        { enemyType: 'brute', count: 16, spawnInterval: 0.74, startDelay: 3.5 },
        { enemyType: 'healer', count: 8, spawnInterval: 1.1, startDelay: 4 },
      ],
    },
    {
      name: 'The Long Siege',
      clearBonus: 78,
      groups: [
        { enemyType: 'brute', count: 18, spawnInterval: 0.72, startDelay: 0 },
        { enemyType: 'healer', count: 8, spawnInterval: 1.05, startDelay: 1.5 },
        { enemyType: 'flyer', count: 26, spawnInterval: 0.4, startDelay: 2.5 },
        { enemyType: 'boss', count: 2, spawnInterval: 5.8, startDelay: 5 },
      ],
    },
    {
      name: 'Fall of the Citadel',
      clearBonus: 95,
      groups: [
        { enemyType: 'brute', count: 18, spawnInterval: 0.68, startDelay: 0 },
        { enemyType: 'splitter', count: 7, spawnInterval: 0.85, startDelay: 1 },
        { enemyType: 'healer', count: 7, spawnInterval: 1.05, startDelay: 1.4 },
        { enemyType: 'flyer', count: 27, spawnInterval: 0.38, startDelay: 2.2 },
        { enemyType: 'boss', count: 2, spawnInterval: 5.5, startDelay: 4.5 },
      ],
    },
  ],
  scriptedBuildOrder: [
    { waveIndex: 0, action: 'build', col: 4, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 3, row: 4, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 3, row: 6, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 5, row: 6, towerType: 'cannon', targetingMode: 'first' },

    { waveIndex: 1, action: 'upgrade', col: 3, row: 4 },
    { waveIndex: 2, action: 'upgrade', col: 4, row: 3 },
    { waveIndex: 2, action: 'build', col: 5, row: 7, towerType: 'tesla', targetingMode: 'first' },

    { waveIndex: 3, action: 'upgrade', col: 3, row: 6 },
    { waveIndex: 4, action: 'build', col: 2, row: 5, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 4, action: 'upgrade', col: 2, row: 5 },
    { waveIndex: 4, action: 'upgrade', col: 5, row: 7 },

    { waveIndex: 5, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 5, action: 'build', col: 8, row: 4, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 6, action: 'upgrade', col: 5, row: 7 },
    { waveIndex: 6, action: 'upgrade', col: 3, row: 4 },

    { waveIndex: 7, action: 'upgrade', col: 8, row: 4 },
    { waveIndex: 7, action: 'build', col: 6, row: 6, towerType: 'tesla', targetingMode: 'strongest' },
    { waveIndex: 8, action: 'upgrade', col: 6, row: 6 },
    { waveIndex: 8, action: 'upgrade', col: 4, row: 3 },

    { waveIndex: 9, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 9, action: 'upgrade', col: 8, row: 4 },
    { waveIndex: 9, action: 'build', col: 10, row: 6, towerType: 'cannon', targetingMode: 'strongest' },

    { waveIndex: 10, action: 'upgrade', col: 6, row: 6 },
    { waveIndex: 10, action: 'upgrade', col: 2, row: 5 },
    { waveIndex: 11, action: 'upgrade', col: 10, row: 6 },
    { waveIndex: 11, action: 'build', col: 8, row: 8, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 11, action: 'upgrade', col: 8, row: 8 },

    { waveIndex: 12, action: 'build', col: 3, row: 7, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 12, action: 'upgrade', col: 3, row: 7 },
    { waveIndex: 12, action: 'upgrade', col: 3, row: 7 },

    { waveIndex: 13, action: 'upgrade', col: 8, row: 8 },
    { waveIndex: 13, action: 'upgrade', col: 10, row: 6 },
    { waveIndex: 13, action: 'upgrade', col: 3, row: 6 },

    { waveIndex: 14, action: 'build', col: 5, row: 8, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 14, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 14, action: 'upgrade', col: 5, row: 8 },

    { waveIndex: 15, action: 'build', col: 7, row: 6, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 15, action: 'upgrade', col: 7, row: 6 },
    { waveIndex: 15, action: 'upgrade', col: 7, row: 6 },

    { waveIndex: 16, action: 'build', col: 11, row: 4, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 16, action: 'upgrade', col: 11, row: 4 },
    { waveIndex: 16, action: 'upgrade', col: 11, row: 4 },

    { waveIndex: 17, action: 'build', col: 8, row: 6, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 17, action: 'upgrade', col: 8, row: 6 },
    { waveIndex: 17, action: 'build', col: 6, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 17, action: 'upgrade', col: 6, row: 3 },
    { waveIndex: 17, action: 'build', col: 10, row: 7, towerType: 'archer', targetingMode: 'first' },
  ],
  weakBuildOrder: [
    { waveIndex: 0, action: 'build', col: 4, row: 3, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 3, row: 4, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 3, row: 6, towerType: 'frost' },
    { waveIndex: 0, action: 'build', col: 5, row: 6, towerType: 'cannon' },

    { waveIndex: 1, action: 'upgrade', col: 3, row: 4 },
    { waveIndex: 2, action: 'upgrade', col: 4, row: 3 },
    { waveIndex: 2, action: 'build', col: 5, row: 7, towerType: 'tesla' },

    { waveIndex: 3, action: 'upgrade', col: 3, row: 6 },
    { waveIndex: 4, action: 'build', col: 2, row: 5, towerType: 'archer' },
    { waveIndex: 4, action: 'upgrade', col: 5, row: 7 },
    { waveIndex: 5, action: 'upgrade', col: 5, row: 6 },

    { waveIndex: 6, action: 'build', col: 8, row: 4, towerType: 'mortar' },
    { waveIndex: 7, action: 'upgrade', col: 2, row: 5 },
    { waveIndex: 8, action: 'upgrade', col: 5, row: 7 },

    { waveIndex: 9, action: 'upgrade', col: 8, row: 4 },
    { waveIndex: 9, action: 'build', col: 6, row: 6, towerType: 'tesla' },
    { waveIndex: 10, action: 'upgrade', col: 6, row: 6 },
    { waveIndex: 10, action: 'upgrade', col: 3, row: 4 },

    { waveIndex: 11, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 11, action: 'upgrade', col: 8, row: 4 },
    { waveIndex: 12, action: 'build', col: 10, row: 6, towerType: 'cannon' },
    { waveIndex: 12, action: 'upgrade', col: 6, row: 6 },
    { waveIndex: 13, action: 'upgrade', col: 4, row: 3 },
    { waveIndex: 13, action: 'upgrade', col: 2, row: 5 },

    { waveIndex: 14, action: 'upgrade', col: 10, row: 6 },
    { waveIndex: 14, action: 'upgrade', col: 10, row: 6 },
    { waveIndex: 15, action: 'build', col: 8, row: 8, towerType: 'mortar' },
    { waveIndex: 15, action: 'upgrade', col: 8, row: 8 },
    { waveIndex: 16, action: 'build', col: 3, row: 7, towerType: 'tesla' },
    { waveIndex: 17, action: 'upgrade', col: 3, row: 7 },
    { waveIndex: 17, action: 'build', col: 5, row: 8, towerType: 'frost' },
  ],
};
