import type { LevelDef } from './types.ts';

/**
 * Lanternfall Hollow — the Gloam Hexers' island. The road doubles back on itself four times, so
 * the one-tile hedgerows between the switchbacks (rows 2, 8 and 10) see two stretches of road at
 * once — and are exactly where a passing hexer can reach. The wide middle band (row 5) and the
 * south-west pocket sit two tiles off the road: out of every hex, but covering less of it.
 *
 * Road: (1,1) east → (14,1) ↓ (14,3) west → (2,3) ↓ (2,7) east → (14,7) ↓ (14,9) west → (4,9)
 * ↓ (4,11) east → sanctuary (12,11). Flyers cut across the hollow from the spawn to the east
 * middle and down onto the sanctuary.
 */
export const LEVEL_12: LevelDef = {
  id: 'lanternfall-hollow',
  index: 11,
  name: 'Lanternfall Hollow',
  subtitle: 'A dusk-lit switchback where hexcasters snuff out the nearest towers',
  difficulty: 'Master',
  cols: 17,
  rows: 13,
  layout: [
    '~ ~ ~ ~ T . . . . . . . T ~ ~ ~ ~',
    '~ S P P P P P P P P P P P P P . ~',
    '~ . . . . T . . . . . T . . P . ~',
    '~ . P P P P P P P P P P P P P . ~',
    '~ . P . . . . . . . . . . . . ~ ~',
    '~ T P . . . . . T . . . . . . . ~',
    '~ . P . . . . . . . . . . . . ~ ~',
    '~ . P P P P P P P P P P P P P . ~',
    '~ . . . . . . T . . . . . . P . ~',
    '~ T . . P P P P P P P P P P P . ~',
    '~ ~ . . P . . . . . . T . . . ~ ~',
    '~ ~ . . P P P P P P P P G . ~ ~ ~',
    '~ ~ ~ T . . . . . . . T ~ ~ ~ ~ ~',
  ],
  pathWaypoints: [
    { col: 1, row: 1 },
    { col: 14, row: 1 },
    { col: 14, row: 3 },
    { col: 2, row: 3 },
    { col: 2, row: 7 },
    { col: 14, row: 7 },
    { col: 14, row: 9 },
    { col: 4, row: 9 },
    { col: 4, row: 11 },
    { col: 12, row: 11 },
  ],
  flightPath: [
    { col: 1, row: 1 },
    { col: 8, row: 5 },
    { col: 12, row: 11 },
  ],
  decorationSeed: 1212487,
  startingGold: 360,
  enemyHpScale: 1.44,
  waveHpGrowth: 0.21,
  waves: [
    {
      name: 'Dusk Patrol',
      clearBonus: 24,
      groups: [
        { enemyType: 'grunt', count: 14, spawnInterval: 0.55, startDelay: 0 },
        { enemyType: 'runner', count: 8, spawnInterval: 0.45, startDelay: 2.5 },
      ],
    },
    {
      name: 'Gathering Gloom',
      clearBonus: 26,
      groups: [
        { enemyType: 'grunt', count: 12, spawnInterval: 0.5, startDelay: 0 },
        { enemyType: 'flyer', count: 5, spawnInterval: 0.6, startDelay: 1.2 },
        { enemyType: 'brute', count: 3, spawnInterval: 1.0, startDelay: 2.4 },
      ],
    },
    {
      name: 'First Lanterns',
      // First hexers: a pair walking in a grunt column
      clearBonus: 30,
      groups: [
        { enemyType: 'grunt', count: 10, spawnInterval: 0.5, startDelay: 0 },
        { enemyType: 'hexer', count: 2, spawnInterval: 2.4, startDelay: 1.6 },
        { enemyType: 'runner', count: 10, spawnInterval: 0.38, startDelay: 3.0 },
      ],
    },
    {
      name: 'Hex and Iron',
      clearBonus: 32,
      groups: [
        { enemyType: 'hexer', count: 3, spawnInterval: 1.8, startDelay: 0 },
        { enemyType: 'brute', count: 5, spawnInterval: 0.9, startDelay: 1.0 },
        { enemyType: 'flyer', count: 4, spawnInterval: 0.55, startDelay: 2.0 },
      ],
    },
    {
      name: 'Mites in the Gloaming',
      clearBonus: 36,
      groups: [
        { enemyType: 'mite', count: 20, spawnInterval: 0.2, startDelay: 0 },
        { enemyType: 'hexer', count: 3, spawnInterval: 1.6, startDelay: 1.0 },
        { enemyType: 'grunt', count: 14, spawnInterval: 0.42, startDelay: 2.0 },
      ],
    },
    {
      name: 'Stone Vigil',
      clearBonus: 40,
      groups: [
        { enemyType: 'golem', count: 3, spawnInterval: 2.0, startDelay: 0 },
        { enemyType: 'hexer', count: 4, spawnInterval: 1.4, startDelay: 0.8 },
        { enemyType: 'healer', count: 2, spawnInterval: 1.4, startDelay: 1.8 },
        { enemyType: 'runner', count: 12, spawnInterval: 0.34, startDelay: 2.6 },
      ],
    },
    {
      name: 'Flickering Lights',
      clearBonus: 44,
      groups: [
        { enemyType: 'flyer', count: 5, spawnInterval: 0.45, startDelay: 0 },
        { enemyType: 'blinker', count: 8, spawnInterval: 0.7, startDelay: 1.0 },
        { enemyType: 'hexer', count: 4, spawnInterval: 1.3, startDelay: 1.6 },
        { enemyType: 'grunt', count: 12, spawnInterval: 0.4, startDelay: 2.4 },
      ],
    },
    {
      name: 'Shielded Coven',
      clearBonus: 48,
      groups: [
        { enemyType: 'brute', count: 8, spawnInterval: 0.75, startDelay: 0 },
        { enemyType: 'warden', count: 2, spawnInterval: 1.6, startDelay: 0.8 },
        { enemyType: 'hexer', count: 5, spawnInterval: 1.2, startDelay: 1.4 },
        { enemyType: 'splitter', count: 6, spawnInterval: 0.8, startDelay: 2.2 },
      ],
    },
    {
      name: 'Swarm by Lanternlight',
      clearBonus: 52,
      groups: [
        { enemyType: 'mite', count: 30, spawnInterval: 0.16, startDelay: 0 },
        { enemyType: 'flyer', count: 5, spawnInterval: 0.42, startDelay: 0.8 },
        { enemyType: 'hexer', count: 5, spawnInterval: 1.1, startDelay: 1.4 },
        { enemyType: 'blinker', count: 8, spawnInterval: 0.6, startDelay: 2.2 },
      ],
    },
    {
      name: 'Dreadnought Choir',
      // Dreadnought, escorted by a hex choir that silences the towers around it
      clearBonus: 66,
      groups: [
        { enemyType: 'hexer', count: 6, spawnInterval: 1.0, startDelay: 0 },
        { enemyType: 'boss', count: 1, spawnInterval: 1.0, startDelay: 3.0 },
        { enemyType: 'golem', count: 3, spawnInterval: 1.6, startDelay: 4.0 },
        { enemyType: 'runner', count: 16, spawnInterval: 0.3, startDelay: 5.0 },
      ],
    },
    {
      name: 'Running Shadows',
      clearBonus: 60,
      groups: [
        { enemyType: 'runner', count: 22, spawnInterval: 0.26, startDelay: 0 },
        { enemyType: 'hexer', count: 6, spawnInterval: 1.0, startDelay: 0.8 },
        { enemyType: 'flyer', count: 6, spawnInterval: 0.4, startDelay: 1.6 },
      ],
    },
    {
      name: 'Basalt Procession',
      clearBonus: 64,
      groups: [
        { enemyType: 'golem', count: 6, spawnInterval: 1.3, startDelay: 0 },
        { enemyType: 'brute', count: 10, spawnInterval: 0.6, startDelay: 0.8 },
        { enemyType: 'healer', count: 4, spawnInterval: 1.0, startDelay: 1.4 },
        { enemyType: 'hexer', count: 5, spawnInterval: 1.0, startDelay: 2.0 },
      ],
    },
    {
      name: 'Midnight Swarm',
      clearBonus: 70,
      groups: [
        { enemyType: 'mite', count: 40, spawnInterval: 0.14, startDelay: 0 },
        { enemyType: 'splitter', count: 8, spawnInterval: 0.75, startDelay: 0.6 },
        { enemyType: 'warden', count: 3, spawnInterval: 1.2, startDelay: 1.2 },
        { enemyType: 'hexer', count: 6, spawnInterval: 0.9, startDelay: 1.8 },
      ],
    },
    {
      name: 'Rift Lanterns',
      clearBonus: 74,
      groups: [
        { enemyType: 'blinker', count: 14, spawnInterval: 0.5, startDelay: 0 },
        { enemyType: 'hexer', count: 7, spawnInterval: 0.9, startDelay: 0.8 },
        { enemyType: 'flyer', count: 6, spawnInterval: 0.36, startDelay: 1.6 },
      ],
    },
    {
      name: 'Iron Vespers',
      clearBonus: 80,
      groups: [
        { enemyType: 'brute', count: 14, spawnInterval: 0.5, startDelay: 0 },
        { enemyType: 'healer', count: 5, spawnInterval: 0.85, startDelay: 0.6 },
        { enemyType: 'hexer', count: 7, spawnInterval: 0.85, startDelay: 1.2 },
        { enemyType: 'golem', count: 4, spawnInterval: 1.2, startDelay: 2.0 },
      ],
    },
    {
      name: 'Gilded Hexes',
      clearBonus: 86,
      groups: [
        { enemyType: 'hexer', count: 5, spawnInterval: 1.0, startDelay: 0, elite: true },
        { enemyType: 'runner', count: 26, spawnInterval: 0.22, startDelay: 0.6 },
        { enemyType: 'warden', count: 3, spawnInterval: 1.1, startDelay: 1.2 },
        { enemyType: 'flyer', count: 7, spawnInterval: 0.32, startDelay: 1.8 },
      ],
    },
    {
      name: 'Witching Hour',
      clearBonus: 92,
      groups: [
        { enemyType: 'golem', count: 6, spawnInterval: 1.2, startDelay: 0, elite: true },
        { enemyType: 'hexer', count: 8, spawnInterval: 0.8, startDelay: 0.6 },
        { enemyType: 'mite', count: 36, spawnInterval: 0.14, startDelay: 1.2 },
        { enemyType: 'healer', count: 5, spawnInterval: 0.8, startDelay: 1.8 },
      ],
    },
    {
      name: 'Blinking Dark',
      clearBonus: 98,
      groups: [
        { enemyType: 'blinker', count: 14, spawnInterval: 0.5, startDelay: 0, elite: true },
        { enemyType: 'hexer', count: 8, spawnInterval: 0.8, startDelay: 0.6 },
        { enemyType: 'brute', count: 12, spawnInterval: 0.5, startDelay: 1.2 },
        { enemyType: 'flyer', count: 7, spawnInterval: 0.3, startDelay: 1.8 },
      ],
    },
    {
      name: 'Hexfire Legion',
      clearBonus: 106,
      groups: [
        { enemyType: 'brute', count: 12, spawnInterval: 0.5, startDelay: 0, elite: true },
        { enemyType: 'warden', count: 4, spawnInterval: 1.0, startDelay: 0.5 },
        { enemyType: 'hexer', count: 8, spawnInterval: 0.75, startDelay: 1.0, elite: true },
        { enemyType: 'splitter', count: 10, spawnInterval: 0.6, startDelay: 1.6 },
        { enemyType: 'flyer', count: 6, spawnInterval: 0.3, startDelay: 2.2 },
      ],
    },
    {
      name: 'Lanternfall',
      clearBonus: 125,
      groups: [
        { enemyType: 'hexer', count: 10, spawnInterval: 0.7, startDelay: 0 },
        { enemyType: 'golem', count: 6, spawnInterval: 1.1, startDelay: 1.0, elite: true },
        { enemyType: 'healer', count: 4, spawnInterval: 1.0, startDelay: 2.0 },
        { enemyType: 'runner', count: 24, spawnInterval: 0.24, startDelay: 3.0 },
        { enemyType: 'boss', count: 1, spawnInterval: 1.0, startDelay: 6.0 },
        { enemyType: 'hexer', count: 4, spawnInterval: 1.0, startDelay: 7.0, elite: true },
        { enemyType: 'brute', count: 10, spawnInterval: 0.5, startDelay: 8.0, elite: true },
        { enemyType: 'mite', count: 30, spawnInterval: 0.14, startDelay: 10.0 },
      ],
    },
  ],
  scriptedBuildOrder: [
    // Pre-wave 1: the middle band (row 5) is out of every hex and sees rows 3 and 7.
    { waveIndex: 0, action: 'build', col: 6, row: 5, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 10, row: 5, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 8, row: 2, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 4, row: 5, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 12, row: 5, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 1, action: 'upgrade', col: 6, row: 5 },
    { waveIndex: 1, action: 'build', col: 2, row: 10, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 2, action: 'upgrade', col: 10, row: 5 },
    { waveIndex: 2, action: 'build', col: 7, row: 5, towerType: 'tesla', targetingMode: 'first' },

    { waveIndex: 3, action: 'upgrade', col: 12, row: 5 },
    { waveIndex: 3, action: 'build', col: 9, row: 5, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 4, action: 'build', col: 2, row: 9, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 4, action: 'upgrade', col: 7, row: 5 },

    { waveIndex: 5, action: 'build', col: 5, row: 5, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 5, action: 'upgrade', col: 2, row: 10 },
    { waveIndex: 6, action: 'upgrade', col: 9, row: 5 },
    { waveIndex: 6, action: 'build', col: 15, row: 5, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 7, action: 'upgrade', col: 4, row: 5 },
    { waveIndex: 7, action: 'build', col: 11, row: 5, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 8, action: 'upgrade', col: 5, row: 5 },
    { waveIndex: 8, action: 'upgrade', col: 2, row: 9 },

    { waveIndex: 9, action: 'build', col: 2, row: 11, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 9, action: 'upgrade', col: 6, row: 5 },
    { waveIndex: 9, action: 'upgrade', col: 15, row: 5 },

    { waveIndex: 10, action: 'build', col: 8, row: 8, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 10, action: 'upgrade', col: 11, row: 5 },
    { waveIndex: 10, action: 'upgrade', col: 10, row: 5 },

    { waveIndex: 11, action: 'build', col: 13, row: 5, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 11, action: 'upgrade', col: 13, row: 5 },
    { waveIndex: 11, action: 'upgrade', col: 8, row: 2 },

    { waveIndex: 12, action: 'build', col: 9, row: 10, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 12, action: 'upgrade', col: 9, row: 10 },
    { waveIndex: 12, action: 'upgrade', col: 7, row: 5 },

    { waveIndex: 13, action: 'build', col: 6, row: 8, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 13, action: 'upgrade', col: 6, row: 8 },
    { waveIndex: 13, action: 'upgrade', col: 12, row: 5 },

    { waveIndex: 14, action: 'build', col: 4, row: 2, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 14, action: 'upgrade', col: 4, row: 2 },
    { waveIndex: 14, action: 'upgrade', col: 9, row: 5 },
    { waveIndex: 14, action: 'upgrade', col: 2, row: 10 },

    { waveIndex: 15, action: 'build', col: 12, row: 8, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 15, action: 'upgrade', col: 12, row: 8 },
    { waveIndex: 15, action: 'upgrade', col: 8, row: 8 },
    { waveIndex: 15, action: 'upgrade', col: 2, row: 11 },

    { waveIndex: 16, action: 'build', col: 6, row: 10, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 16, action: 'upgrade', col: 6, row: 10 },
    { waveIndex: 16, action: 'upgrade', col: 11, row: 5 },
    { waveIndex: 16, action: 'upgrade', col: 5, row: 5 },

    { waveIndex: 17, action: 'build', col: 10, row: 2, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 17, action: 'upgrade', col: 10, row: 2 },
    { waveIndex: 17, action: 'upgrade', col: 10, row: 2 },
    { waveIndex: 17, action: 'upgrade', col: 15, row: 5 },

    { waveIndex: 18, action: 'build', col: 8, row: 12, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 18, action: 'upgrade', col: 8, row: 12 },
    { waveIndex: 18, action: 'upgrade', col: 8, row: 12 },
    { waveIndex: 18, action: 'upgrade', col: 6, row: 8 },
    { waveIndex: 18, action: 'upgrade', col: 9, row: 10 },

    { waveIndex: 19, action: 'build', col: 14, row: 5, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 19, action: 'upgrade', col: 14, row: 5 },
    { waveIndex: 19, action: 'upgrade', col: 14, row: 5 },
    { waveIndex: 19, action: 'upgrade', col: 13, row: 5 },
    { waveIndex: 19, action: 'upgrade', col: 6, row: 10 },
  ],
  weakBuildOrder: [
    // Hugs the road in the hedgerows (every tower in hex reach), late frost, mortar only late.
    { waveIndex: 0, action: 'build', col: 6, row: 2, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 9, row: 2, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 8, row: 8, towerType: 'cannon' },
    { waveIndex: 0, action: 'build', col: 4, row: 4, towerType: 'archer' },

    { waveIndex: 1, action: 'build', col: 10, row: 8, towerType: 'cannon' },
    { waveIndex: 2, action: 'upgrade', col: 6, row: 2 },
    { waveIndex: 3, action: 'build', col: 7, row: 10, towerType: 'archer' },
    { waveIndex: 4, action: 'upgrade', col: 8, row: 8 },
    { waveIndex: 5, action: 'build', col: 12, row: 6, towerType: 'frost' },
    { waveIndex: 6, action: 'upgrade', col: 9, row: 2 },
    { waveIndex: 7, action: 'build', col: 5, row: 8, towerType: 'tesla' },
    { waveIndex: 8, action: 'upgrade', col: 4, row: 4 },
    { waveIndex: 9, action: 'build', col: 12, row: 2, towerType: 'archer' },
    { waveIndex: 10, action: 'upgrade', col: 10, row: 8 },
    { waveIndex: 11, action: 'build', col: 10, row: 10, towerType: 'archer' },
    { waveIndex: 12, action: 'upgrade', col: 7, row: 10 },
    { waveIndex: 13, action: 'build', col: 3, row: 6, towerType: 'mortar' },
    { waveIndex: 14, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 15, action: 'build', col: 13, row: 8, towerType: 'archer' },
    { waveIndex: 16, action: 'upgrade', col: 12, row: 6 },
    { waveIndex: 17, action: 'upgrade', col: 3, row: 6 },
    { waveIndex: 18, action: 'upgrade', col: 12, row: 2 },
    { waveIndex: 18, action: 'build', col: 6, row: 12, towerType: 'archer' },
    { waveIndex: 19, action: 'build', col: 11, row: 4, towerType: 'archer' },
    { waveIndex: 19, action: 'build', col: 7, row: 6, towerType: 'cannon' },
    { waveIndex: 19, action: 'build', col: 9, row: 0, towerType: 'archer' },
  ],
};
