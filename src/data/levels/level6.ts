import type { LevelDef } from './types.ts';

export const LEVEL_6: LevelDef = {
  id: 'crescent-lagoon',
  index: 5,
  name: 'Crescent Lagoon',
  subtitle: 'An enclosing atoll ring flanking a sunlit inner sea basin',
  difficulty: 'Heroic',
  cols: 16,
  rows: 12,
  layout: [
    '~ ~ ~ T . . . T ~ ~ T . . T ~ ~',
    '~ T . . . . . . . . . . . . T ~',
    '~ . P P P . . P P P . . . . T ~',
    '~ . P . P P P P . P P P P P . ~',
    '~ . P . ~ ~ ~ ~ ~ ~ ~ . . P P ~',
    '~ T P . ~ ~ ~ ~ P G ~ . . . P T',
    '~ . P . ~ ~ ~ ~ P . ~ . . . P ~',
    'S P P . ~ ~ ~ ~ P ~ ~ . P P P ~',
    '~ . T . ~ ~ ~ ~ P P . . P . . ~',
    '~ ~ ~ ~ ~ ~ . . . P P P P . T ~',
    '~ ~ ~ ~ ~ T . . T . . . . T ~ ~',
    '~ ~ ~ ~ ~ ~ ~ T ~ ~ T ~ T ~ ~ ~',
  ],
  pathWaypoints: [
    { col: 0, row: 7 },
    { col: 2, row: 7 },
    { col: 2, row: 2 },
    { col: 4, row: 2 },
    { col: 4, row: 3 },
    { col: 7, row: 3 },
    { col: 7, row: 2 },
    { col: 9, row: 2 },
    { col: 9, row: 3 },
    { col: 13, row: 3 },
    { col: 13, row: 4 },
    { col: 14, row: 4 },
    { col: 14, row: 7 },
    { col: 12, row: 7 },
    { col: 12, row: 9 },
    { col: 9, row: 9 },
    { col: 9, row: 8 },
    { col: 8, row: 8 },
    { col: 8, row: 5 },
    { col: 9, row: 5 },
  ],
  flightPath: [
    { col: 0, row: 7 },
    { col: 2, row: 3 },
    { col: 5, row: 2 },
    { col: 12, row: 3 },
    { col: 9, row: 5 },
  ],
  decorationSeed: 663419,
  startingGold: 270,
  enemyHpScale: 1.34,
  waveHpGrowth: 0.295,
  waves: [
    {
      clearBonus: 18,
      groups: [
        { enemyType: 'grunt', count: 10, spawnInterval: 0.85, startDelay: 0 },
        { enemyType: 'runner', count: 5, spawnInterval: 0.7, startDelay: 4.0 },
      ],
    },
    {
      clearBonus: 20,
      groups: [
        { enemyType: 'runner', count: 12, spawnInterval: 0.6, startDelay: 0 },
        { enemyType: 'grunt', count: 10, spawnInterval: 0.75, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 22,
      groups: [
        { enemyType: 'runner', count: 12, spawnInterval: 0.55, startDelay: 0 },
        { enemyType: 'flyer', count: 7, spawnInterval: 0.8, startDelay: 2.0 },
      ],
    },
    {
      clearBonus: 24,
      groups: [
        { enemyType: 'brute', count: 4, spawnInterval: 1.5, startDelay: 0 },
        { enemyType: 'grunt', count: 14, spawnInterval: 0.6, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 26,
      groups: [
        { enemyType: 'flyer', count: 12, spawnInterval: 0.65, startDelay: 0 },
        { enemyType: 'healer', count: 2, spawnInterval: 2.0, startDelay: 2.0 },
        { enemyType: 'runner', count: 12, spawnInterval: 0.5, startDelay: 4.0 },
      ],
    },
    {
      clearBonus: 28,
      groups: [
        { enemyType: 'brute', count: 6, spawnInterval: 1.25, startDelay: 0 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.75, startDelay: 1.5 },
        { enemyType: 'grunt', count: 14, spawnInterval: 0.55, startDelay: 3.5 },
      ],
    },
    {
      clearBonus: 30,
      groups: [
        { enemyType: 'flyer', count: 15, spawnInterval: 0.56, startDelay: 0 },
        { enemyType: 'runner', count: 18, spawnInterval: 0.42, startDelay: 1.5 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.6, startDelay: 3.5 },
      ],
    },
    {
      clearBonus: 34,
      groups: [
        { enemyType: 'brute', count: 9, spawnInterval: 1.05, startDelay: 0 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.5, startDelay: 1.5 },
        { enemyType: 'flyer', count: 14, spawnInterval: 0.58, startDelay: 3.5 },
      ],
    },
    {
      clearBonus: 36,
      groups: [
        { enemyType: 'runner', count: 24, spawnInterval: 0.36, startDelay: 0 },
        { enemyType: 'brute', count: 9, spawnInterval: 0.95, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 40,
      groups: [
        { enemyType: 'brute', count: 11, spawnInterval: 0.9, startDelay: 0 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.35, startDelay: 1.5 },
        { enemyType: 'flyer', count: 16, spawnInterval: 0.52, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 44,
      groups: [
        { enemyType: 'flyer', count: 18, spawnInterval: 0.48, startDelay: 0 },
        { enemyType: 'runner', count: 22, spawnInterval: 0.36, startDelay: 2.0 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.25, startDelay: 3.5 },
      ],
    },
    {
      clearBonus: 48,
      groups: [
        { enemyType: 'brute', count: 14, spawnInterval: 0.82, startDelay: 0 },
        { enemyType: 'healer', count: 6, spawnInterval: 1.2, startDelay: 1.5 },
        { enemyType: 'grunt', count: 24, spawnInterval: 0.4, startDelay: 3.0 },
      ],
    },
    {
      clearBonus: 54,
      groups: [
        { enemyType: 'brute', count: 10, spawnInterval: 0.88, startDelay: 0 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.25, startDelay: 1.5 },
        { enemyType: 'flyer', count: 18, spawnInterval: 0.5, startDelay: 2.5 },
        { enemyType: 'boss', count: 1, spawnInterval: 1.0, startDelay: 5.0 },
      ],
    },
    {
      clearBonus: 58,
      groups: [
        { enemyType: 'runner', count: 26, spawnInterval: 0.34, startDelay: 0 },
        { enemyType: 'brute', count: 14, spawnInterval: 0.78, startDelay: 2.0 },
        { enemyType: 'flyer', count: 20, spawnInterval: 0.46, startDelay: 3.5 },
      ],
    },
    {
      clearBonus: 64,
      groups: [
        { enemyType: 'brute', count: 16, spawnInterval: 0.75, startDelay: 0 },
        { enemyType: 'healer', count: 7, spawnInterval: 1.15, startDelay: 1.5 },
        { enemyType: 'flyer', count: 22, spawnInterval: 0.44, startDelay: 2.5 },
      ],
    },
    {
      clearBonus: 72,
      groups: [
        { enemyType: 'flyer', count: 24, spawnInterval: 0.4, startDelay: 0 },
        { enemyType: 'runner', count: 28, spawnInterval: 0.3, startDelay: 2.0 },
        { enemyType: 'brute', count: 16, spawnInterval: 0.72, startDelay: 3.5 },
        { enemyType: 'healer', count: 8, spawnInterval: 1.1, startDelay: 4.0 },
      ],
    },
    {
      clearBonus: 95,
      groups: [
        { enemyType: 'brute', count: 18, spawnInterval: 0.68, startDelay: 0 },
        { enemyType: 'healer', count: 8, spawnInterval: 1.0, startDelay: 1.2 },
        { enemyType: 'flyer', count: 24, spawnInterval: 0.4, startDelay: 2.2 },
        { enemyType: 'boss', count: 2, spawnInterval: 4.5, startDelay: 4.5 },
      ],
    },
  ],
  scriptedBuildOrder: [
    // Pre-Wave 1 (270g -> 50+75+90+50 = 265g)
    { waveIndex: 0, action: 'build', col: 3, row: 3, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 5, row: 2, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 8, row: 3, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 11, row: 4, towerType: 'archer', targetingMode: 'first' },

    // W2-W4: Frost + upgrade NW/NE core
    { waveIndex: 1, action: 'upgrade', col: 3, row: 3 },
    { waveIndex: 2, action: 'build', col: 6, row: 2, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 2, action: 'upgrade', col: 5, row: 2 },
    { waveIndex: 3, action: 'upgrade', col: 8, row: 3 },
    { waveIndex: 3, action: 'upgrade', col: 11, row: 4 },

    // W5-W6: Central Sanctuary Spit Mortar + SE Bend Cannon + Frost T2
    { waveIndex: 4, action: 'build', col: 9, row: 6, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 5, action: 'build', col: 11, row: 8, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 5, action: 'upgrade', col: 6, row: 2 },

    // W7-W8: Mortar T2 + Tesla T3 + SE Cannon T2 + North Archer
    { waveIndex: 6, action: 'upgrade', col: 9, row: 6 },
    { waveIndex: 7, action: 'upgrade', col: 8, row: 3 },
    { waveIndex: 7, action: 'upgrade', col: 11, row: 8 },
    { waveIndex: 7, action: 'build', col: 10, row: 2, towerType: 'archer', targetingMode: 'first' },

    // W9-W10: Anti-air + SE Tesla + T3 upgrades
    { waveIndex: 8, action: 'upgrade', col: 10, row: 2 },
    { waveIndex: 8, action: 'build', col: 10, row: 8, towerType: 'tesla', targetingMode: 'strongest' },
    { waveIndex: 9, action: 'upgrade', col: 10, row: 8 },
    { waveIndex: 9, action: 'upgrade', col: 5, row: 2 },
    { waveIndex: 9, action: 'upgrade', col: 3, row: 3 },

    // W11-W12: Bridgehead Frost + Mortar T3 + NE Tesla
    { waveIndex: 10, action: 'build', col: 8, row: 9, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 10, action: 'upgrade', col: 9, row: 6 },
    { waveIndex: 11, action: 'build', col: 11, row: 2, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 11, action: 'upgrade', col: 11, row: 2 },
    { waveIndex: 11, action: 'upgrade', col: 11, row: 4 },

    // W13-W15: Mini-boss + East bastion Mortar/Cannon + NW Rim AA
    { waveIndex: 12, action: 'build', col: 13, row: 5, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 12, action: 'upgrade', col: 13, row: 5 },
    { waveIndex: 12, action: 'upgrade', col: 10, row: 8 },

    { waveIndex: 13, action: 'upgrade', col: 13, row: 5 },
    { waveIndex: 13, action: 'build', col: 13, row: 6, towerType: 'cannon', targetingMode: 'strongest' },
    { waveIndex: 13, action: 'upgrade', col: 13, row: 6 },

    { waveIndex: 14, action: 'upgrade', col: 13, row: 6 },
    { waveIndex: 14, action: 'upgrade', col: 11, row: 8 },
    { waveIndex: 14, action: 'upgrade', col: 8, row: 9 },
    { waveIndex: 14, action: 'build', col: 6, row: 1, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 14, action: 'upgrade', col: 6, row: 1 },

    // W16-W17: Dual Boss & Sky Finale (17 towers total)
    { waveIndex: 15, action: 'build', col: 3, row: 5, towerType: 'tesla', targetingMode: 'strongest' },
    { waveIndex: 15, action: 'upgrade', col: 3, row: 5 },
    { waveIndex: 15, action: 'upgrade', col: 3, row: 5 },

    { waveIndex: 16, action: 'build', col: 12, row: 4, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 16, action: 'upgrade', col: 12, row: 4 },
    { waveIndex: 16, action: 'upgrade', col: 12, row: 4 },
    { waveIndex: 16, action: 'build', col: 10, row: 1, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 16, action: 'upgrade', col: 10, row: 1 },
  ],
  weakBuildOrder: [
    // 12 planned towers (12/17 = 0.706), zero targeting changes
    { waveIndex: 0, action: 'build', col: 3, row: 3, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 5, row: 2, towerType: 'cannon' },
    { waveIndex: 0, action: 'build', col: 8, row: 3, towerType: 'tesla' },
    { waveIndex: 0, action: 'build', col: 11, row: 4, towerType: 'archer' },

    { waveIndex: 1, action: 'upgrade', col: 3, row: 3 },
    { waveIndex: 2, action: 'build', col: 6, row: 2, towerType: 'frost' },
    { waveIndex: 3, action: 'upgrade', col: 5, row: 2 },

    { waveIndex: 4, action: 'upgrade', col: 8, row: 3 },
    { waveIndex: 5, action: 'upgrade', col: 11, row: 4 },
    { waveIndex: 5, action: 'build', col: 9, row: 6, towerType: 'mortar' },

    { waveIndex: 6, action: 'build', col: 11, row: 8, towerType: 'cannon' },
    { waveIndex: 7, action: 'upgrade', col: 6, row: 2 },
    { waveIndex: 7, action: 'upgrade', col: 9, row: 6 },

    { waveIndex: 8, action: 'build', col: 10, row: 2, towerType: 'archer' },
    { waveIndex: 9, action: 'upgrade', col: 11, row: 8 },
    { waveIndex: 9, action: 'upgrade', col: 8, row: 3 },

    { waveIndex: 10, action: 'build', col: 10, row: 8, towerType: 'tesla' },
    { waveIndex: 10, action: 'upgrade', col: 10, row: 2 },
    { waveIndex: 11, action: 'upgrade', col: 10, row: 8 },

    { waveIndex: 12, action: 'build', col: 8, row: 9, towerType: 'frost' },
    { waveIndex: 12, action: 'upgrade', col: 5, row: 2 },
    { waveIndex: 13, action: 'upgrade', col: 3, row: 3 },
    { waveIndex: 13, action: 'upgrade', col: 9, row: 6 },

    { waveIndex: 14, action: 'build', col: 11, row: 2, towerType: 'tesla' },
    { waveIndex: 14, action: 'upgrade', col: 11, row: 2 },
    { waveIndex: 15, action: 'build', col: 13, row: 5, towerType: 'mortar' },
    { waveIndex: 15, action: 'upgrade', col: 13, row: 5 },
    { waveIndex: 16, action: 'upgrade', col: 10, row: 8 },
  ],
};
