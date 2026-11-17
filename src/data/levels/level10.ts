import type { LevelDef } from './types.ts';

/**
 * Island 10 — two raider columns (west causeway + northern switchback) converge at the
 * Confluence and march the final stretch together. Introduces Scuttle Mites, Aegis Wardens and
 * Loam Burrowers. Lane 0 = west causeway, lane 1 = northern switchback.
 */
export const LEVEL_10: LevelDef = {
  id: 'confluence-terraces',
  index: 9,
  name: 'Confluence Terraces',
  subtitle: 'Two raider columns meet at the terraced crossroads — split your guard or hold the merge',
  difficulty: 'Master',
  cols: 17,
  rows: 13,
  layout: [
    '~ ~ ~ ~ ~ T S T ~ ~ ~ ~ ~ ~ ~ ~ ~',
    '~ ~ ~ T . . P . . T ~ ~ ~ ~ ~ ~ ~',
    '~ ~ T . . . P . . . . T . . T ~ ~',
    '~ ~ . P P P P . . . P P P P P . ~',
    '~ T . P . . . . T . P . . . P . ~',
    '~ . . P . . . . . . P . T . P . T',
    '~ . . P . . T . . . P . . . P . ~',
    '~ . . P P P P P P P P . . . P . ~',
    '~ T . . . . . . . . P . G P P . ~',
    '~ . . . T . . . . . P . . . . T ~',
    'S P P P P P P P P P P . . T . ~ ~',
    '~ ~ T . . . T . . . . . T ~ ~ ~ ~',
    '~ ~ ~ ~ ~ T . . T ~ ~ ~ ~ ~ ~ ~ ~',
  ],
  pathWaypoints: [
    { col: 0, row: 10 },
    { col: 10, row: 10 },
    { col: 10, row: 3 },
    { col: 14, row: 3 },
    { col: 14, row: 8 },
    { col: 12, row: 8 },
  ],
  extraGroundPaths: [
    [
      { col: 6, row: 0 },
      { col: 6, row: 3 },
      { col: 3, row: 3 },
      { col: 3, row: 7 },
      { col: 10, row: 7 },
      { col: 10, row: 3 },
      { col: 14, row: 3 },
      { col: 14, row: 8 },
      { col: 12, row: 8 },
    ],
  ],
  flightPath: [
    { col: 6, row: 0 },
    { col: 5, row: 2 },
    { col: 6, row: 5 },
    { col: 8, row: 7 },
    { col: 11, row: 9 },
    { col: 13, row: 10 },
    { col: 12, row: 8 },
  ],
  decorationSeed: 1010337,
  startingGold: 360,
  enemyHpScale: 1.02,
  waveHpGrowth: 0.2,
  waves: [
    {
      name: 'Twin Trails',
      clearBonus: 24,
      groups: [
        { enemyType: 'grunt', count: 10, spawnInterval: 0.6, startDelay: 0 },
        { enemyType: 'grunt', count: 8, spawnInterval: 0.6, startDelay: 1.5, lane: 1 },
      ],
    },
    {
      name: 'Scuttle Tide',
      clearBonus: 26,
      groups: [
        { enemyType: 'mite', count: 18, spawnInterval: 0.22, startDelay: 0, lane: 1 },
        { enemyType: 'runner', count: 8, spawnInterval: 0.45, startDelay: 1.0 },
      ],
    },
    {
      name: 'First Ward',
      clearBonus: 28,
      groups: [
        { enemyType: 'grunt', count: 12, spawnInterval: 0.5, startDelay: 0 },
        { enemyType: 'warden', count: 1, spawnInterval: 1, startDelay: 2.0 },
        { enemyType: 'flyer', count: 5, spawnInterval: 0.6, startDelay: 1.0 },
        { enemyType: 'grunt', count: 8, spawnInterval: 0.5, startDelay: 0.5, lane: 1 },
      ],
    },
    {
      name: 'Undermining',
      clearBonus: 30,
      groups: [
        { enemyType: 'burrower', count: 4, spawnInterval: 1.2, startDelay: 0, lane: 1 },
        { enemyType: 'grunt', count: 12, spawnInterval: 0.45, startDelay: 0.5 },
        { enemyType: 'mite', count: 14, spawnInterval: 0.22, startDelay: 3.0 },
      ],
    },
    {
      name: 'Swarm and Shield',
      clearBonus: 32,
      groups: [
        { enemyType: 'brute', count: 4, spawnInterval: 1.0, startDelay: 0 },
        { enemyType: 'warden', count: 1, spawnInterval: 1, startDelay: 1.6 },
        { enemyType: 'mite', count: 22, spawnInterval: 0.2, startDelay: 0.5, lane: 1 },
        { enemyType: 'flyer', count: 6, spawnInterval: 0.55, startDelay: 2.0 },
      ],
    },
    {
      name: 'Deep Diggers',
      clearBonus: 34,
      groups: [
        { enemyType: 'brute', count: 5, spawnInterval: 0.9, startDelay: 0, lane: 1 },
        { enemyType: 'warden', count: 2, spawnInterval: 2.0, startDelay: 1.0, lane: 1 },
        { enemyType: 'burrower', count: 5, spawnInterval: 1.0, startDelay: 0.5 },
        { enemyType: 'runner', count: 10, spawnInterval: 0.35, startDelay: 2.5 },
      ],
    },
    {
      name: 'Skitter Flood',
      clearBonus: 38,
      groups: [
        { enemyType: 'flyer', count: 10, spawnInterval: 0.45, startDelay: 0 },
        { enemyType: 'mite', count: 20, spawnInterval: 0.2, startDelay: 0.5 },
        { enemyType: 'mite', count: 20, spawnInterval: 0.2, startDelay: 1.5, lane: 1 },
        { enemyType: 'healer', count: 2, spawnInterval: 1.4, startDelay: 2.0 },
      ],
    },
    {
      name: 'Converging Columns',
      clearBonus: 48,
      groups: [
        { enemyType: 'grunt', count: 14, spawnInterval: 0.4, startDelay: 0 },
        { enemyType: 'warden', count: 2, spawnInterval: 2.2, startDelay: 1.0 },
        { enemyType: 'grunt', count: 14, spawnInterval: 0.4, startDelay: 0.5, lane: 1 },
        { enemyType: 'healer', count: 2, spawnInterval: 2.0, startDelay: 1.5, lane: 1 },
        { enemyType: 'brute', count: 4, spawnInterval: 0.9, startDelay: 3.0 },
      ],
    },
    {
      name: 'Tunnel Rush',
      clearBonus: 52,
      groups: [
        { enemyType: 'burrower', count: 6, spawnInterval: 0.8, startDelay: 0 },
        { enemyType: 'burrower', count: 6, spawnInterval: 0.8, startDelay: 0.6, lane: 1 },
        { enemyType: 'runner', count: 16, spawnInterval: 0.3, startDelay: 1.5 },
        { enemyType: 'flyer', count: 8, spawnInterval: 0.45, startDelay: 2.2 },
      ],
    },
    {
      name: 'The Dreadnought Descends',
      clearBonus: 48,
      groups: [
        { enemyType: 'boss', count: 1, spawnInterval: 1, startDelay: 0 },
        { enemyType: 'warden', count: 2, spawnInterval: 1.2, startDelay: 0.6 },
        { enemyType: 'mite', count: 26, spawnInterval: 0.18, startDelay: 0.4, lane: 1 },
        { enemyType: 'brute', count: 6, spawnInterval: 0.8, startDelay: 2.0, lane: 1 },
      ],
    },
    {
      name: 'Splinter Ford',
      clearBonus: 36,
      groups: [
        { enemyType: 'splitter', count: 8, spawnInterval: 0.8, startDelay: 0, lane: 1 },
        { enemyType: 'brute', count: 8, spawnInterval: 0.75, startDelay: 0.5 },
        { enemyType: 'warden', count: 2, spawnInterval: 2.0, startDelay: 1.5 },
        { enemyType: 'flyer', count: 12, spawnInterval: 0.4, startDelay: 2.0 },
      ],
    },
    {
      name: 'Mite Monsoon',
      clearBonus: 40,
      groups: [
        { enemyType: 'mite', count: 30, spawnInterval: 0.16, startDelay: 0 },
        { enemyType: 'mite', count: 30, spawnInterval: 0.16, startDelay: 0.3, lane: 1 },
        { enemyType: 'healer', count: 3, spawnInterval: 1.2, startDelay: 1.0 },
        { enemyType: 'flyer', count: 12, spawnInterval: 0.4, startDelay: 2.0 },
      ],
    },
    {
      name: 'Burrowed Vanguard',
      clearBonus: 44,
      groups: [
        { enemyType: 'burrower', count: 9, spawnInterval: 0.7, startDelay: 0, lane: 1 },
        { enemyType: 'warden', count: 3, spawnInterval: 1.8, startDelay: 0.5 },
        { enemyType: 'grunt', count: 21, spawnInterval: 0.32, startDelay: 0 },
        { enemyType: 'brute', count: 9, spawnInterval: 0.7, startDelay: 2.0, lane: 1 },
      ],
    },
    {
      name: 'Gilded Brutes',
      clearBonus: 48,
      groups: [
        { enemyType: 'brute', count: 7, spawnInterval: 1.0, startDelay: 0, elite: true },
        { enemyType: 'healer', count: 5, spawnInterval: 1.0, startDelay: 1.0 },
        { enemyType: 'flyer', count: 16, spawnInterval: 0.38, startDelay: 0.5 },
        { enemyType: 'runner', count: 23, spawnInterval: 0.26, startDelay: 1.5, lane: 1 },
      ],
    },
    {
      name: 'Torrent of Mites',
      clearBonus: 52,
      groups: [
        { enemyType: 'mite', count: 39, spawnInterval: 0.15, startDelay: 0, lane: 1 },
        { enemyType: 'warden', count: 5, spawnInterval: 1.4, startDelay: 0.6, lane: 1 },
        { enemyType: 'runner', count: 25, spawnInterval: 0.25, startDelay: 0.5 },
        { enemyType: 'burrower', count: 7, spawnInterval: 0.8, startDelay: 2.0 },
      ],
    },
    {
      name: 'Earthshaker',
      clearBonus: 56,
      groups: [
        { enemyType: 'burrower', count: 12, spawnInterval: 0.6, startDelay: 0 },
        { enemyType: 'brute', count: 14, spawnInterval: 0.6, startDelay: 0.5, lane: 1 },
        { enemyType: 'warden', count: 3, spawnInterval: 1.6, startDelay: 1.0 },
        { enemyType: 'flyer', count: 16, spawnInterval: 0.36, startDelay: 1.6 },
      ],
    },
    {
      name: 'Golden Stampede',
      clearBonus: 60,
      groups: [
        { enemyType: 'brute', count: 7, spawnInterval: 0.9, startDelay: 0, elite: true, lane: 1 },
        { enemyType: 'mite', count: 37, spawnInterval: 0.15, startDelay: 0.5 },
        { enemyType: 'flyer', count: 18, spawnInterval: 0.34, startDelay: 1.0 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.0, startDelay: 1.5, lane: 1 },
      ],
    },
    {
      name: 'Many Rivers',
      clearBonus: 64,
      groups: [
        { enemyType: 'splitter', count: 14, spawnInterval: 0.6, startDelay: 0 },
        { enemyType: 'warden', count: 5, spawnInterval: 1.3, startDelay: 0.8 },
        { enemyType: 'runner', count: 28, spawnInterval: 0.24, startDelay: 0.3, lane: 1 },
        { enemyType: 'healer', count: 5, spawnInterval: 1.0, startDelay: 1.5, lane: 1 },
      ],
    },
    {
      name: 'Aegis Phalanx',
      clearBonus: 70,
      groups: [
        { enemyType: 'burrower', count: 14, spawnInterval: 0.55, startDelay: 0, lane: 1 },
        { enemyType: 'warden', count: 3, spawnInterval: 1.8, startDelay: 1.0, elite: true },
        { enemyType: 'brute', count: 16, spawnInterval: 0.55, startDelay: 0.4 },
        { enemyType: 'flyer', count: 18, spawnInterval: 0.34, startDelay: 1.8 },
      ],
    },
    {
      name: 'The Confluence',
      clearBonus: 98,
      groups: [
        { enemyType: 'boss', count: 1, spawnInterval: 1.0, startDelay: 0 },
        { enemyType: 'warden', count: 3, spawnInterval: 1.4, startDelay: 0.6, elite: true },
        { enemyType: 'brute', count: 8, spawnInterval: 0.75, startDelay: 1.0, elite: true },
        { enemyType: 'mite', count: 40, spawnInterval: 0.14, startDelay: 0.3, lane: 1 },
        { enemyType: 'burrower', count: 10, spawnInterval: 0.6, startDelay: 1.2, lane: 1 },
        { enemyType: 'flyer', count: 16, spawnInterval: 0.34, startDelay: 2.0 },
      ],
    },
  ],
  scriptedBuildOrder: [
    // Pre-wave 1: hold the Confluence, one guard on each column
    { waveIndex: 0, action: 'build', col: 9, row: 8, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 5, row: 8, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 9, row: 9, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 11, row: 6, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 0, action: 'build', col: 4, row: 4, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 1, action: 'build', col: 7, row: 8, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 1, action: 'upgrade', col: 9, row: 8 },
    { waveIndex: 2, action: 'build', col: 11, row: 8, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 2, action: 'upgrade', col: 5, row: 8 },

    { waveIndex: 3, action: 'build', col: 13, row: 4, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 3, action: 'upgrade', col: 9, row: 9 },
    { waveIndex: 4, action: 'build', col: 7, row: 5, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 4, action: 'upgrade', col: 4, row: 4 },

    { waveIndex: 5, action: 'upgrade', col: 11, row: 6 },
    { waveIndex: 5, action: 'build', col: 12, row: 6, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 6, action: 'upgrade', col: 7, row: 8 },
    { waveIndex: 6, action: 'build', col: 9, row: 4, towerType: 'archer', targetingMode: 'first' },

    { waveIndex: 7, action: 'upgrade', col: 11, row: 8 },
    { waveIndex: 7, action: 'upgrade', col: 7, row: 5 },
    { waveIndex: 8, action: 'build', col: 2, row: 8, towerType: 'cannon', targetingMode: 'first' },
    { waveIndex: 8, action: 'upgrade', col: 13, row: 4 },

    { waveIndex: 9, action: 'upgrade', col: 9, row: 8 },
    { waveIndex: 9, action: 'build', col: 13, row: 7, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 9, action: 'upgrade', col: 12, row: 6 },

    { waveIndex: 10, action: 'build', col: 7, row: 9, towerType: 'frost', targetingMode: 'first' },
    { waveIndex: 10, action: 'upgrade', col: 9, row: 9 },
    { waveIndex: 10, action: 'upgrade', col: 13, row: 7 },

    { waveIndex: 11, action: 'build', col: 5, row: 6, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 11, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 11, action: 'upgrade', col: 7, row: 8 },

    { waveIndex: 12, action: 'build', col: 11, row: 4, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 12, action: 'upgrade', col: 11, row: 4 },
    { waveIndex: 12, action: 'upgrade', col: 5, row: 8 },

    { waveIndex: 13, action: 'build', col: 8, row: 2, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 13, action: 'upgrade', col: 8, row: 2 },
    { waveIndex: 13, action: 'upgrade', col: 11, row: 8 },

    { waveIndex: 14, action: 'build', col: 15, row: 6, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 14, action: 'upgrade', col: 15, row: 6 },
    { waveIndex: 14, action: 'upgrade', col: 7, row: 5 },

    { waveIndex: 15, action: 'build', col: 3, row: 9, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 15, action: 'upgrade', col: 3, row: 9 },
    { waveIndex: 15, action: 'upgrade', col: 12, row: 6 },
    { waveIndex: 15, action: 'upgrade', col: 11, row: 6 },

    { waveIndex: 16, action: 'build', col: 8, row: 11, towerType: 'mortar', targetingMode: 'strongest' },
    { waveIndex: 16, action: 'upgrade', col: 8, row: 11 },
    { waveIndex: 16, action: 'upgrade', col: 13, row: 4 },

    { waveIndex: 17, action: 'build', col: 2, row: 5, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 17, action: 'upgrade', col: 2, row: 5 },
    { waveIndex: 17, action: 'upgrade', col: 2, row: 5 },
    { waveIndex: 17, action: 'upgrade', col: 13, row: 7 },

    { waveIndex: 18, action: 'build', col: 12, row: 9, towerType: 'archer', targetingMode: 'first' },
    { waveIndex: 18, action: 'upgrade', col: 12, row: 9 },
    { waveIndex: 18, action: 'upgrade', col: 12, row: 9 },
    { waveIndex: 18, action: 'upgrade', col: 5, row: 6 },
    { waveIndex: 18, action: 'upgrade', col: 2, row: 8 },

    { waveIndex: 19, action: 'build', col: 9, row: 6, towerType: 'tesla', targetingMode: 'first' },
    { waveIndex: 19, action: 'upgrade', col: 9, row: 6 },
    { waveIndex: 19, action: 'upgrade', col: 8, row: 11 },
    { waveIndex: 19, action: 'upgrade', col: 15, row: 6 },
  ],
  weakBuildOrder: [
    // Spreads towers thinly along the west causeway, late anti-air, one frost, no mortar until late.
    { waveIndex: 0, action: 'build', col: 5, row: 8, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 2, row: 8, towerType: 'archer' },
    { waveIndex: 0, action: 'build', col: 9, row: 9, towerType: 'cannon' },
    { waveIndex: 0, action: 'build', col: 4, row: 4, towerType: 'archer' },

    { waveIndex: 1, action: 'build', col: 7, row: 8, towerType: 'cannon' },
    { waveIndex: 2, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 3, action: 'build', col: 11, row: 8, towerType: 'archer' },
    { waveIndex: 4, action: 'upgrade', col: 9, row: 9 },
    { waveIndex: 5, action: 'build', col: 11, row: 6, towerType: 'frost' },
    { waveIndex: 6, action: 'upgrade', col: 2, row: 8 },
    { waveIndex: 6, action: 'build', col: 5, row: 6, towerType: 'archer' },
    { waveIndex: 7, action: 'build', col: 13, row: 4, towerType: 'archer' },
    { waveIndex: 8, action: 'upgrade', col: 7, row: 8 },
    { waveIndex: 9, action: 'build', col: 3, row: 9, towerType: 'cannon' },
    { waveIndex: 10, action: 'upgrade', col: 11, row: 8 },
    { waveIndex: 10, action: 'build', col: 12, row: 6, towerType: 'archer' },
    { waveIndex: 11, action: 'build', col: 9, row: 4, towerType: 'archer' },
    { waveIndex: 12, action: 'upgrade', col: 4, row: 4 },
    { waveIndex: 12, action: 'upgrade', col: 3, row: 9 },
    { waveIndex: 13, action: 'build', col: 13, row: 7, towerType: 'archer' },
    { waveIndex: 13, action: 'upgrade', col: 13, row: 4 },
    { waveIndex: 14, action: 'build', col: 7, row: 5, towerType: 'mortar' },
    { waveIndex: 14, action: 'upgrade', col: 9, row: 4 },
    { waveIndex: 15, action: 'upgrade', col: 5, row: 8 },
    { waveIndex: 15, action: 'upgrade', col: 9, row: 9 },
    { waveIndex: 16, action: 'build', col: 12, row: 9, towerType: 'archer' },
    { waveIndex: 16, action: 'upgrade', col: 12, row: 9 },
    { waveIndex: 17, action: 'upgrade', col: 7, row: 5 },
    { waveIndex: 17, action: 'upgrade', col: 13, row: 7 },
    { waveIndex: 18, action: 'build', col: 8, row: 2, towerType: 'archer' },
    { waveIndex: 18, action: 'upgrade', col: 8, row: 2 },
    { waveIndex: 19, action: 'upgrade', col: 11, row: 6 },
    { waveIndex: 19, action: 'upgrade', col: 2, row: 8 },
  ],
};
