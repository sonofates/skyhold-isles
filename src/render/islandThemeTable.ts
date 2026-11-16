import { DEFAULT_THEME, type IslandTheme, type SetPieceSpec } from './islandThemes.ts';

/**
 * Authored visual identity for each island (keyed by level id). Everything here is render-only.
 * Set pieces may only sit on decor (`T`) tiles or on open water, never on buildable grass or path tiles
 * (enforced by tests/render/islandThemes.test.ts).
 */

type ThemeInput = Partial<Omit<IslandTheme, 'cliff' | 'decorBake' | 'details' | 'ambient'>> & {
  cliff?: Partial<IslandTheme['cliff']>;
  decorBake?: Partial<IslandTheme['decorBake']>;
  details?: Partial<IslandTheme['details']>;
  ambient?: Partial<IslandTheme['ambient']>;
};

function theme(overrides: ThemeInput): IslandTheme {
  return {
    ...DEFAULT_THEME,
    ...overrides,
    cliff: { ...DEFAULT_THEME.cliff, ...overrides.cliff },
    trees: overrides.trees ?? DEFAULT_THEME.trees,
    decorBake: { ...DEFAULT_THEME.decorBake, ...overrides.decorBake },
    details: { ...DEFAULT_THEME.details, ...overrides.details },
    ambient: { ...DEFAULT_THEME.ambient, ...overrides.ambient },
  };
}

const NO_PIECES: readonly SetPieceSpec[] = [];

/** L1 — Sunlit Meadow: cosy wildflower meadow with a cottage; the friendly reference look. */
const SUNLIT_MEADOW = theme({
  grassTint: [1.03, 1.05, 0.97],
  trees: { density: 0.5, weights: { oak: 0.38, tree: 0.22, treeLarge: 0.2, blossom: 0.2 } },
  details: { flowerMul: 2.1, pebbleMul: 0.7, tuftMul: 1.1 },
  ambient: { birds: 3, butterflies: 7, islets: 4, clouds: 5 },
  setPieces: NO_PIECES,
});

/** L2 — Twin-Bridge Cay: sun-bleached harbour cay with docks, boats and sandy shores. */
const TWIN_BRIDGE_CAY = theme({
  grassTint: [1.0, 1.06, 0.96],
  ground: [{ kind: 'sand', where: 'shore', chance: 0.6 }],
  cliff: {
    stones: [0xb7b09a, 0xc6bea6],
    bedrocks: [0x8c8d8f, 0x7b7e84],
    dirts: [0xb88a5a, 0x9c6b49],
    depthMul: 0.9,
    spireMul: 0.9,
  },
  trees: { density: 0.4, weights: { palm: 0.3, oak: 0.25, tree: 0.22, treeLarge: 0.23 } },
  details: { flowerMul: 0.8, pebbleMul: 1.3, shells: true },
  ambient: { birds: 6, butterflies: 0, islets: 4, clouds: 5 },
  setPieces: NO_PIECES,
});

/** L3 — Highland Citadel: cold alpine keep — pines, dark cobble courtyards, tall cliffs, waterfall, banners. */
const HIGHLAND_CITADEL = theme({
  pathStyle: 'stone',
  grassTint: [0.6, 0.92, 0.96],
  ground: [{ kind: 'cobble', where: 'zone', zone: { col: 6.5, row: 7, radius: 2.5 } }],
  cliff: {
    stones: [0x7d8798, 0x8e98a8],
    bedrocks: [0x5f6b7c, 0x536071],
    dirts: [0x6e5a4a, 0x5a4a3e],
    depthMul: 1.5,
    spireMul: 1.4,
  },
  trees: { density: 0.55, weights: { pine: 0.62, treeLarge: 0.18, tree: 0.2 } },
  decorBake: { rockChance: 0.5, shrubChance: 0.2, crystalChance: 0.06, crystalTint: 0xb7d4f6 },
  details: {
    flowerMul: 0.4,
    pebbleMul: 2.0,
    tuftMul: 0.7,
    flowers: [
      [0xf8f4e8, 0xf6bd41],
      [0xb7d4f6, 0xf8f4e8],
      [0xbd82e1, 0xf8f4e8],
    ],
  },
  ambient: { birds: 4, butterflies: 0, islets: 4, clouds: 6 },
  setPieces: NO_PIECES,
});

/** L4 — Emerald Stepping Stones: mossy emerald terraces studded with glowing crystal groves. */
const EMERALD_STEPPING_STONES = theme({
  grassTint: [0.42, 1.02, 0.8],
  cliff: {
    stones: [0x7c9a96, 0x8bab9f],
    bedrocks: [0x4f6e6a, 0x46625f],
    dirts: [0x7a5a3c, 0x634a30],
    depthMul: 1.3,
    spireMul: 1.2,
  },
  trees: { density: 0.4, weights: { treeLarge: 0.3, oak: 0.35, tree: 0.35 } },
  decorBake: { rockChance: 0.25, shrubChance: 0.3, crystalChance: 0.5, crystalTint: 0x7dffb8 },
  details: {
    flowerMul: 1.3,
    flowers: [
      [0xc3ecfa, 0xf8f4e8],
      [0x9468dc, 0xf8f4e8],
      [0x5be3ff, 0xf8f4e8],
    ],
  },
  ambient: { birds: 2, butterflies: 8, islets: 5, clouds: 5 },
  setPieces: NO_PIECES,
});

/** L5 — Windmill Switchback: golden harvest farmland with windmills, hay and autumn trees. */
const WINDMILL_SWITCHBACK = theme({
  grassTint: [1.12, 1.02, 0.7],
  grassZones: [
    { col: 8, row: 7, radius: 2.4, soft: 1.4, tint: [1.45, 0.92, 0.5] },
    { col: 4, row: 3.5, radius: 1.6, soft: 1.2, tint: [1.4, 0.94, 0.55] },
  ],
  ground: [
    { kind: 'field', where: 'zone', zone: { col: 8, row: 7, radius: 2.3 }, includeDecor: false },
    { kind: 'field', where: 'zone', zone: { col: 4, row: 3.5, radius: 1.7 }, includeDecor: false },
  ],
  cliff: {
    stones: [0xa39a8e, 0xb3a99a],
    bedrocks: [0x8a7f78, 0x756b66],
    dirts: [0xa8723f, 0x8a5a33],
    depthMul: 1.0,
  },
  trees: { density: 0.4, weights: { autumn: 0.5, oak: 0.2, treeLarge: 0.15, tree: 0.15 } },
  decorBake: { rockChance: 0.2, shrubChance: 0.34 },
  details: {
    flowerMul: 0.9,
    wheat: 0.55,
    flowers: [
      [0xf6bd41, 0xf28729],
      [0xe85d5d, 0x484573],
      [0xf8f4e8, 0xf6bd41],
    ],
  },
  ambient: {
    birds: 5,
    butterflies: 0,
    islets: 4,
    clouds: 5,
    leafColors: [0xf28729, 0xf6bd41, 0xe85d5d],
    leafCount: 14,
  },
  setPieces: NO_PIECES,
});

/** L6 — Crescent Lagoon: tropical atoll — pale sand ring, palms, lighthouse in the lagoon, coral flowers. */
const CRESCENT_LAGOON = theme({
  pathStyle: 'sand',
  grassTint: [0.86, 1.1, 0.92],
  ground: [
    { kind: 'sand', where: 'shore' },
  ],
  cliff: {
    stones: [0xd9c9a0, 0xc9b88e],
    bedrocks: [0xa89c86, 0x948872],
    dirts: [0xc7a46e, 0xb08c5a],
    depthMul: 0.8,
    spireMul: 0.7,
  },
  trees: { density: 0.5, weights: { palm: 0.7, oak: 0.15, tree: 0.15 } },
  decorBake: { rockChance: 0.2, shrubChance: 0.28 },
  details: {
    flowerMul: 1.2,
    tuftMul: 0.7,
    shells: true,
    flowers: [
      [0xe85d5d, 0xf6bd41],
      [0xff9ab0, 0xf6bd41],
      [0xf6bd41, 0xe85d5d],
    ],
  },
  ambient: { birds: 7, butterflies: 0, islets: 5, clouds: 5 },
  setPieces: NO_PIECES,
});

/** L7 — Skybridge Gauntlet: wind-scoured cliffside forts, stone bridges, dizzying drops. */
const SKYBRIDGE_GAUNTLET = theme({
  pathStyle: 'stone',
  grassTint: [0.74, 0.94, 0.86],
  ground: [
    { kind: 'cobble', where: 'zone', zone: { col: 3, row: 6.5, radius: 2.0 } },
    { kind: 'cobble', where: 'zone', zone: { col: 12.5, row: 6.5, radius: 2.0 } },
  ],
  cliff: {
    stones: [0x77818f, 0x8a94a2],
    bedrocks: [0x586272, 0x4c5666],
    dirts: [0x6b5846, 0x5a4a3c],
    depthMul: 1.9,
    spireMul: 1.6,
  },
  trees: { density: 0.3, weights: { pine: 0.45, tree: 0.35, treeLarge: 0.2 } },
  decorBake: { rockChance: 0.5, shrubChance: 0.18, crystalChance: 0.08 },
  details: { flowerMul: 0.25, pebbleMul: 2.2, tuftMul: 0.7 },
  ambient: { birds: 4, butterflies: 0, islets: 5, clouds: 7 },
  setPieces: NO_PIECES,
});

/** L8 — Sunken Bastion: half-drowned ruined bastion, mossy cobbles, torches and indigo banners. */
const SUNKEN_BASTION = theme({
  pathStyle: 'stone',
  grassTint: [0.58, 0.86, 0.7],
  ground: [
    { kind: 'cobble', where: 'zone', zone: { col: 7.5, row: 5.5, radius: 2.3 } },
    { kind: 'moss', where: 'shore', chance: 0.5 },
  ],
  cliff: {
    stones: [0x7e8a82, 0x8a968c],
    bedrocks: [0x55635f, 0x4b5955],
    dirts: [0x6d5b42, 0x5a4a35],
    depthMul: 1.2,
    spireMul: 1.1,
  },
  trees: { density: 0.4, weights: { oak: 0.3, tree: 0.3, treeLarge: 0.2, pine: 0.2 } },
  decorBake: { rockChance: 0.5, shrubChance: 0.3, crystalChance: 0.1 },
  details: {
    flowerMul: 0.4,
    pebbleMul: 1.8,
    flowers: [
      [0xf8f4e8, 0xf6bd41],
      [0xbd82e1, 0xf8f4e8],
      [0xb7d4f6, 0xf8f4e8],
    ],
  },
  ambient: { birds: 3, butterflies: 0, islets: 4, clouds: 6 },
  setPieces: NO_PIECES,
});

/** L9 — Grand Skyhold: crown citadel — marble cobbles, golden banners, corner towers, regal blossoms. */
const GRAND_SKYHOLD = theme({
  pathStyle: 'stone',
  grassTint: [0.96, 1.04, 0.96],
  ground: [
    { kind: 'cobble', where: 'zone', zone: { col: 11.5, row: 6, radius: 3.4 }, includeDecor: false },
  ],
  cliff: {
    stones: [0xb4bbc7, 0xc4cad4],
    bedrocks: [0x7c8798, 0x6d7889],
    dirts: [0x9c6b49, 0x7b5338],
    depthMul: 1.5,
    spireMul: 1.3,
  },
  trees: { density: 0.45, weights: { blossom: 0.3, oak: 0.3, pine: 0.1, tree: 0.15, treeLarge: 0.15 } },
  decorBake: { rockChance: 0.22, shrubChance: 0.3, crystalChance: 0.2 },
  details: {
    flowers: [
      [0xf6bd41, 0xf8f4e8],
      [0xf8f4e8, 0xf6bd41],
      [0xe85d5d, 0xf8f4e8],
    ],
  },
  ambient: { birds: 5, butterflies: 0, islets: 6, clouds: 8 },
  setPieces: NO_PIECES,
});

const THEME_TABLE: Readonly<Record<string, IslandTheme>> = {
  'sunlit-meadow': SUNLIT_MEADOW,
  'twin-bridge-cay': TWIN_BRIDGE_CAY,
  'highland-citadel': HIGHLAND_CITADEL,
  'emerald-stepping-stones': EMERALD_STEPPING_STONES,
  'windmill-switchback': WINDMILL_SWITCHBACK,
  'crescent-lagoon': CRESCENT_LAGOON,
  'skybridge-gauntlet': SKYBRIDGE_GAUNTLET,
  'sunken-bastion': SUNKEN_BASTION,
  'grand-skyhold': GRAND_SKYHOLD,
};

export function getIslandTheme(levelId: string): IslandTheme {
  return THEME_TABLE[levelId] ?? DEFAULT_THEME;
}
