import { DEFAULT_THEME, type IslandTheme } from './islandThemes.ts';

/**
 * Authored visual identity for each island (keyed by level id). Everything here is render-only.
 * Set pieces may only sit on decor (`T`) tiles or on open water, never on buildable grass or path tiles
 * (enforced by tests/render/islandThemes.test.ts).
 */

type ThemeInput = Partial<Omit<IslandTheme, 'cliff' | 'decorBake' | 'details' | 'ambient' | 'hills' | 'waterDetails'>> & {
  cliff?: Partial<IslandTheme['cliff']>;
  decorBake?: Partial<IslandTheme['decorBake']>;
  hills?: Partial<IslandTheme['hills']>;
  details?: Partial<IslandTheme['details']>;
  ambient?: Partial<IslandTheme['ambient']>;
  waterDetails?: Partial<IslandTheme['waterDetails']>;
};

function theme(overrides: ThemeInput): IslandTheme {
  return {
    ...DEFAULT_THEME,
    ...overrides,
    cliff: { ...DEFAULT_THEME.cliff, ...overrides.cliff },
    trees: overrides.trees ?? DEFAULT_THEME.trees,
    decorBake: { ...DEFAULT_THEME.decorBake, ...overrides.decorBake },
    hills: { ...DEFAULT_THEME.hills, ...overrides.hills },
    waterDetails: { ...DEFAULT_THEME.waterDetails, ...overrides.waterDetails },
    details: { ...DEFAULT_THEME.details, ...overrides.details },
    ambient: { ...DEFAULT_THEME.ambient, ...overrides.ambient },
  };
}

/** L1 — Sunlit Meadow: cosy wildflower meadow with a cottage; the friendly reference look. */
const SUNLIT_MEADOW = theme({
  waterDetails: { lilies: 3, buoys: 0, driftwood: 1 },
  goal: { color: 0x5be3ff, shard: 0xccf7ff, ring: 0xf6bd41, glow: 0x0b7cb8, deco: 'poles' },
  grassTint: [1.03, 1.05, 0.97],
  hills: { chance: 0.5, minH: 0.22, maxH: 0.4 },
  trees: { density: 0.5, weights: { oak: 0.38, tree: 0.22, treeLarge: 0.2, blossom: 0.2 } },
  details: { flowerMul: 2.1, pebbleMul: 0.7, tuftMul: 1.1 },
  ambient: { birds: 3, butterflies: 7, islets: 4, clouds: 5 },
  setPieces: [
    { kind: 'cottage', col: 9, row: 2 },
    { kind: 'pond', col: 5, row: 3, variant: 0 },
    { kind: 'sheep', col: 12, row: 1, variant: 0 },
    { kind: 'sheep', col: 2, row: 6, variant: 1 },
    { kind: 'pond', col: 7, row: 8, variant: 1 },
    { kind: 'banner', col: 0, row: 1, variant: 0 },
    { kind: 'banner', col: 0, row: 3, variant: 0 },
    { kind: 'banner', col: 13, row: 7, variant: 2 },
    { kind: 'banner', col: 13, row: 9, variant: 2 },
    { kind: 'hayBales', col: 4, row: 7, yaw: 0.4 },
    { kind: 'boat', col: 9.5, row: 10.7, variant: 0 },
    { kind: 'kite', col: 7, row: 1, variant: 0 },
    { kind: 'kite', col: 2, row: 8, variant: 2, yaw: 0.8 },
  ],
});

/** L2 — Twin-Bridge Cay: sun-bleached harbour cay with docks, boats and sandy shores. */
const TWIN_BRIDGE_CAY = theme({
  waterDetails: { lilies: 0, buoys: 6, driftwood: 2 },
  water: 0x2cc0dd,
  atmosphere: { horizon: 0xd2f0f0, zenith: 0x2f9fd8, sun: 0xfffbea },
  spawnCrystalCell: [4, 2],
  goal: { color: 0x4ff0d0, shard: 0xc9fff4, ring: 0xf6bd41, glow: 0x0b9c90, deco: 'poles' },
  bridge: 'timber',
  grassTint: [1.0, 1.06, 0.96],
  ground: [
    { kind: 'sand', where: 'zone', zone: { col: 9, row: 1, radius: 1.5 } },
    { kind: 'sand', where: 'zone', zone: { col: 9, row: 6, radius: 1.5 } },
    { kind: 'sand', where: 'zone', zone: { col: 10, row: 9, radius: 1.6 } },
  ],
  cliff: {
    stones: [0xb7b09a, 0xc6bea6],
    bedrocks: [0x8c8d8f, 0x7b7e84],
    dirts: [0xb88a5a, 0x9c6b49],
    depthMul: 0.9,
    spireMul: 0.9,
  },
  trees: { density: 0.4, weights: { palm: 0.3, oak: 0.25, tree: 0.22, treeLarge: 0.23 } },
  details: { flowerMul: 0.8, pebbleMul: 1.3, shells: true },
  ambient: { isletStyle: 'palm', birds: 6, butterflies: 0, islets: 4, clouds: 5 },
  setPieces: [
    { kind: 'dock', col: 9, row: 1, yaw: -Math.PI / 2, variant: 0 },
    { kind: 'dock', col: 9, row: 6, yaw: -Math.PI / 2, variant: 1 },
    { kind: 'dock', col: 10, row: 9, yaw: 0, variant: 0 },
    { kind: 'brazier', col: 14, row: 3 },
    { kind: 'brazier', col: 14, row: 6 },
    { kind: 'banner', col: 1, row: 3, variant: 3 },
    { kind: 'banner', col: 1, row: 8, variant: 0 },
    { kind: 'seaStack', col: 7.6, row: 11, variant: 1 },
    { kind: 'stall', col: 2, row: 6, variant: 0 },
    { kind: 'lamp', col: 6, row: 0, variant: 1 },
    { kind: 'lamp', col: 10, row: 0, variant: 1 },
    { kind: 'lamp', col: 11, row: 2, variant: 1 },
    { kind: 'stall', col: 3, row: 10, variant: 1 },
    { kind: 'boat', col: 7.5, row: 5.5, variant: 1 },
    { kind: 'cottage', col: 5, row: 2, yaw: 0.2, variant: 1 },
  ],
});

/** L3 — Highland Citadel: cold alpine keep — pines, dark cobble courtyards, tall cliffs, waterfall, banners. */
const HIGHLAND_CITADEL = theme({
  parapet: { color: 0x8e98a8, merlon: 0x9aa4b4, height: 0.15, gap: 0.35, merlons: false },
  water: 0x2a8fcf,
  atmosphere: { horizon: 0xdbe7f3, zenith: 0x4a80bc, hemiSky: 0xcfe0f4, sun: 0xf0f5ff },
  spawnCrystalCell: [0, 3],
  goal: { color: 0xbfe8ff, shard: 0xffffff, ring: 0xb4bbc7, glow: 0x3a78b8, deco: 'pillars' },
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
  hills: { chance: 0.85, minH: 0.5, maxH: 1.0, cap: 'snow' },
  trees: { density: 0.55, snow: true, weights: { pine: 0.62, treeLarge: 0.18, tree: 0.2 } },
  decorBake: { rockChance: 0.5, shrubChance: 0.2, crystalChance: 0.06, crystalTint: 0xb7d4f6 },
  details: { bushMul: 0.5, bushColors: [0x2f6f46, 0x3f8a58],
    flowerMul: 0.4,
    pebbleMul: 2.0,
    tuftMul: 0.7,
    flowers: [
      [0xf8f4e8, 0xf6bd41],
      [0xb7d4f6, 0xf8f4e8],
      [0xbd82e1, 0xf8f4e8],
    ],
  },
  ambient: { isletStyle: 'pine', birds: 4, butterflies: 0, islets: 4, clouds: 6 },
  setPieces: [
    { kind: 'ruinWall', col: 7, row: 3, variant: 0 },
    { kind: 'banner', col: 5, row: 4, variant: 1 },
    { kind: 'banner', col: 10, row: 4, variant: 1 },
    { kind: 'waterfall', col: 15, row: 5, yaw: Math.PI / 2 },
    { kind: 'waterfall', col: 14, row: 9, yaw: Math.PI / 2 },
    { kind: 'brazier', col: 2, row: 7 },
    { kind: 'brazier', col: 11, row: 8 },
    { kind: 'cabin', col: 13, row: 1, variant: 0 },
    { kind: 'cabin', col: 2, row: 9, yaw: 0.6, variant: 1 },
    { kind: 'cairn', col: 1, row: 5, variant: 0 },
    { kind: 'cairn', col: 14, row: 6, variant: 2 },
    { kind: 'peak', col: -3.2, row: 2.5, variant: 0 },
    { kind: 'peak', col: 4, row: -3.4, variant: 1 },
    { kind: 'peak', col: 18.6, row: 0.5, variant: 1 },
  ],
});

/** L4 — Emerald Stepping Stones: mossy emerald terraces studded with glowing crystal groves. */
const EMERALD_STEPPING_STONES = theme({
  waterDetails: { lilies: 12, buoys: 0, driftwood: 0 },
  water: 0x1fb8b0,
  atmosphere: { horizon: 0xc2eee0, zenith: 0x2d9bb2, hemiSky: 0xc8f0e4, sun: 0xf3fff6 },
  spawnCrystalCell: [3, 2],
  goal: { color: 0x5bffa8, shard: 0xc6ffe4, ring: 0x7dffb8, glow: 0x0b9c5a, deco: 'shards' },
  bridge: 'rope',
  grassTint: [0.42, 1.02, 0.8],
  cliff: {
    stones: [0x7c9a96, 0x8bab9f],
    bedrocks: [0x4f6e6a, 0x46625f],
    dirts: [0x7a5a3c, 0x634a30],
    depthMul: 1.3,
    spireMul: 1.2,
  },
  hills: { chance: 0.6, minH: 0.3, maxH: 0.55 },
  trees: { density: 0.4, weights: { treeLarge: 0.3, oak: 0.35, tree: 0.35 } },
  decorBake: { rockChance: 0.25, shrubChance: 0.3, crystalChance: 0.5, crystalTint: 0x7dffb8 },
  details: { bushMul: 1.3, bushColors: [0x2fa077, 0x5fd0a0],
    flowerMul: 1.3,
    flowers: [
      [0xc3ecfa, 0xf8f4e8],
      [0x9468dc, 0xf8f4e8],
      [0x5be3ff, 0xf8f4e8],
    ],
  },
  ambient: {
    isletStyle: 'crystal',
    birds: 2,
    butterflies: 9,
    butterflyColors: [0x7dffb8, 0x5be3ff, 0xc9a0ff, 0xc6ffe4],
    islets: 5,
    clouds: 5,
  },
  setPieces: [
    { kind: 'crystalGrove', col: 11, row: 1, variant: 0 },
    { kind: 'crystalGrove', col: 11, row: 4, variant: 1 },
    { kind: 'crystalGrove', col: 7, row: 9, variant: 0 },
    { kind: 'crystalGrove', col: 14, row: 7, variant: 1 },
    { kind: 'crystalGrove', col: 12, row: 11, variant: 0 },
    { kind: 'crystalGrove', col: 1, row: 6, variant: 1 },
    { kind: 'seaStack', col: 4.6, row: 2.2, variant: 2 },
    { kind: 'pond', col: 0, row: 4, variant: 1 },
    { kind: 'seaStack', col: 10.3, row: 6.4, variant: 2 },
  ],
});

/** L5 — Windmill Switchback: golden harvest farmland with windmills, hay and autumn trees. */
const WINDMILL_SWITCHBACK = theme({
  waterDetails: { lilies: 4, buoys: 0, driftwood: 1 },
  water: 0x2aa8c8,
  atmosphere: { horizon: 0xffe4b8, zenith: 0x5a9ccc, hemiSky: 0xffeccc, sun: 0xffe2b8, sunIntensity: 1.7 },
  spawnCrystalCell: [5, 2],
  goal: { color: 0xffc355, shard: 0xffe9a8, ring: 0xe3b84a, glow: 0x9c6a0b, deco: 'sheaves' },
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
  hills: { chance: 0.6, minH: 0.25, maxH: 0.5 },
  trees: { density: 0.4, weights: { autumn: 0.5, oak: 0.2, treeLarge: 0.15, tree: 0.15 } },
  decorBake: { rockChance: 0.2, shrubChance: 0.34 },
  details: { bushMul: 0.7, bushColors: [0xc9742a, 0xe0a23a],
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
  setPieces: [
    { kind: 'windmill', col: 8, row: 4, yaw: 0, variant: 0 },
    { kind: 'windmill', col: 1, row: 0, yaw: Math.PI / 2, variant: 1, scale: 0.9 },
    { kind: 'hayBales', col: 8, row: 10, yaw: 0.3 },
    { kind: 'hayBales', col: 1, row: 4, yaw: 0.9 },
    { kind: 'scarecrow', col: 13, row: 4, yaw: -0.5 },
    { kind: 'pond', col: 2, row: 10, variant: 0 },
  ],
});

/** L6 — Crescent Lagoon: tropical atoll — pale sand ring, palms, lighthouse in the lagoon, coral flowers. */
const CRESCENT_LAGOON = theme({
  waterDetails: { lilies: 5, buoys: 3, driftwood: 4 },
  water: 0x1fc4c8,
  atmosphere: { horizon: 0xcbf4ee, zenith: 0x1fa6d8, sun: 0xfffbe8 },
  spawnCrystalCell: [4, 2],
  goal: { color: 0x5be3ff, shard: 0xffd6cc, ring: 0xe85d5d, glow: 0x0b7cb8, deco: 'shells' },
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
  hills: { chance: 0.7, minH: 0.25, maxH: 0.5 },
  trees: { density: 0.5, weights: { palm: 0.7, oak: 0.15, tree: 0.15 } },
  decorBake: { rockChance: 0.2, shrubChance: 0.28 },
  details: { bushMul: 0.4, bushColors: [0x4fae45, 0x7bd860],
    flowerMul: 1.2,
    tuftMul: 0.7,
    shells: true,
    flowers: [
      [0xe85d5d, 0xf6bd41],
      [0xff9ab0, 0xf6bd41],
      [0xf6bd41, 0xe85d5d],
    ],
  },
  ambient: { isletStyle: 'palm', birds: 7, butterflies: 0, islets: 5, clouds: 5 },
  setPieces: [
    { kind: 'lighthouse', col: 5.2, row: 5.6 },
    { kind: 'sailboat', col: 5.6, row: 6, variant: 0 },
    { kind: 'boat', col: 7.4, row: 4.5, variant: 1 },
    { kind: 'dock', col: 1, row: 5, yaw: -Math.PI / 2, variant: 0 },
    { kind: 'dock', col: 15, row: 5, yaw: Math.PI / 2, variant: 1 },
    { kind: 'dock', col: 2, row: 8, yaw: 0, variant: 1 },
    { kind: 'seaStack', col: 3.4, row: 11, variant: 1 },
    { kind: 'hut', col: 5, row: 10, variant: 0 },
    { kind: 'parasol', col: 8, row: 10, variant: 0 },
    { kind: 'parasol', col: 13, row: 10, variant: 1 },
    { kind: 'hut', col: 12, row: 11, yaw: -0.5, variant: 1 },
    { kind: 'seaStack', col: 14.8, row: 11.4, variant: 0 },
  ],
});

/** L7 — Skybridge Gauntlet: wind-scoured cliffside forts, stone bridges, dizzying drops. */
const SKYBRIDGE_GAUNTLET = theme({
  parapet: { color: 0x8e98a8, merlon: 0xa1aab8, height: 0.24, gap: 0.12, merlons: true },
  water: 0x2a86c4,
  atmosphere: { horizon: 0xd0daee, zenith: 0x3a6fb4, hemiSky: 0xd4def2, sun: 0xf5f7ff },
  spawnCrystalCell: [1, 3],
  goal: { color: 0xb58cf2, shard: 0xe6d4ff, ring: 0xb4bbc7, glow: 0x5b2fb8, deco: 'pillars' },
  bridge: 'stone',
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
  hills: { chance: 0.8, minH: 0.45, maxH: 0.9, cap: 'stone' },
  trees: { density: 0.3, snow: true, weights: { pine: 0.45, tree: 0.35, treeLarge: 0.2 } },
  decorBake: { rockChance: 0.5, shrubChance: 0.18, crystalChance: 0.08 },
  details: { bushMul: 0.4, bushColors: [0x3f6f4a, 0x56875c], flowerMul: 0.25, pebbleMul: 2.2, tuftMul: 0.7 },
  ambient: { isletStyle: 'rock', birds: 4, butterflies: 0, islets: 5, clouds: 7 },
  setPieces: [
    { kind: 'watchtower', col: 6, row: 5, yaw: Math.PI / 2, variant: 0 },
    { kind: 'watchtower', col: 15, row: 4, yaw: -Math.PI / 2, variant: 1 },
    { kind: 'watchtower', col: 3, row: 7, variant: 0 },
    { kind: 'watchtower', col: 13, row: 7, variant: 1, scale: 0.78 },
    { kind: 'banner', col: 1, row: 5, variant: 1 },
    { kind: 'banner', col: 12, row: 4, variant: 1 },
    { kind: 'banner', col: 14, row: 1, variant: 0 },
    { kind: 'banner', col: 1, row: 11, variant: 0 },
    { kind: 'arch', col: 15, row: 9, yaw: Math.PI / 2, variant: 1 },
    { kind: 'seaStack', col: 8, row: 6, variant: 0 },
    { kind: 'seaStack', col: 8.2, row: 11.6, variant: 1 },
    { kind: 'seaStack', col: 7.8, row: 0.6, variant: 0 },
    { kind: 'tent', col: 3, row: 12, variant: 0 },
    { kind: 'tent', col: 12, row: 12, variant: 1 },
    { kind: 'cairn', col: 14, row: 11, variant: 1 },
  ],
});

/** L8 — Sunken Bastion: half-drowned ruined bastion, mossy cobbles, torches and indigo banners. */
const SUNKEN_BASTION = theme({
  parapet: { color: 0x8d9a8e, merlon: 0x9aa89a, height: 0.22, gap: 0.38, merlons: true },
  waterDetails: { lilies: 8, buoys: 0, driftwood: 3 },
  water: 0x1f7fa8,
  atmosphere: { horizon: 0xbcc8da, zenith: 0x2f5088, hemiSky: 0xaebfdc, sun: 0xffe6d0, sunIntensity: 1.5 },
  spawnCrystalCell: [1, 1],
  goal: { color: 0x7dffe0, shard: 0xd4fff3, ring: 0x9aa4b0, glow: 0x0b9c88, deco: 'pillars' },
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
  hills: { chance: 0.5, minH: 0.25, maxH: 0.5 },
  trees: { density: 0.4, weights: { oak: 0.3, tree: 0.3, treeLarge: 0.2, pine: 0.2 } },
  decorBake: { rockChance: 0.5, shrubChance: 0.3, crystalChance: 0.1 },
  details: { bushMul: 1.4, bushColors: [0x4a7a55, 0x6a9a6a],
    flowerMul: 0.4,
    pebbleMul: 1.8,
    flowers: [
      [0xf8f4e8, 0xf6bd41],
      [0xbd82e1, 0xf8f4e8],
      [0xb7d4f6, 0xf8f4e8],
    ],
  },
  ambient: {
    isletStyle: 'ruin',
    birds: 3,
    butterflies: 11,
    butterflyColors: [0xfff3b0, 0xffe27a, 0xf6bd41],
    butterflySize: 0.55,
    islets: 4,
    clouds: 6,
  },
  setPieces: [
    { kind: 'arch', col: 7.5, row: 3, variant: 3 },
    { kind: 'pillars', col: 4, row: 6.5, variant: 2 },
    { kind: 'ruinWall', col: 11, row: 5, yaw: Math.PI / 2, variant: 3 },
    { kind: 'ruinWall', col: 7.5, row: 8.6, variant: 2 },
    { kind: 'statue', col: 11, row: 8, variant: 3 },
    { kind: 'statue', col: 4, row: 3.6, variant: 2 },
    { kind: 'watchtower', col: 14, row: 3, yaw: -Math.PI / 2, variant: 1 },
    { kind: 'watchtower', col: 1, row: 9, yaw: Math.PI / 2, variant: 0 },
    { kind: 'watchtower', col: 7, row: 12, variant: 1, scale: 0.85 },
    { kind: 'banner', col: 13, row: 0, variant: 1 },
    { kind: 'banner', col: 10, row: 0, variant: 1 },
    { kind: 'banner', col: 5, row: 0, variant: 1 },
    { kind: 'banner', col: 2, row: 0, variant: 1 },
    { kind: 'brazier', col: 1, row: 6 },
    { kind: 'brazier', col: 15, row: 5 },
    { kind: 'brazier', col: 2, row: 11 },
    { kind: 'brazier', col: 6, row: 11 },
  ],
});

/** L9 — Grand Skyhold: crown citadel — marble cobbles, golden banners, corner towers, regal blossoms. */
const GRAND_SKYHOLD = theme({
  parapet: { color: 0xcfd4dd, merlon: 0xe6e9ef, height: 0.26, gap: 0, merlons: true },
  water: 0x2a8fd8,
  atmosphere: { horizon: 0xffd8b4, zenith: 0x4a5fa8, hemiSky: 0xffe0c4, sun: 0xffdaa8, sunIntensity: 1.72 },
  spawnCrystalCell: [4, 2],
  goal: { color: 0xffd45b, shard: 0xfff0b8, ring: 0xe85d5d, glow: 0xb87a0b, deco: 'goldPillars' },
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
  hills: { chance: 0.4, minH: 0.2, maxH: 0.4 },
  trees: { density: 0.45, weights: { blossom: 0.3, oak: 0.3, pine: 0.1, tree: 0.15, treeLarge: 0.15 } },
  decorBake: { rockChance: 0.22, shrubChance: 0.3, crystalChance: 0.2 },
  details: {
    flowers: [
      [0xf6bd41, 0xf8f4e8],
      [0xf8f4e8, 0xf6bd41],
      [0xe85d5d, 0xf8f4e8],
    ],
  },
  ambient: {
    isletStyle: 'ruin',
    birds: 5,
    butterflies: 0,
    islets: 6,
    clouds: 8,
    leafColors: [0xf6bd41, 0xffd98a, 0xf28729],
    leafCount: 12,
    leafRise: true,
  },
  setPieces: [
    { kind: 'watchtower', col: 8, row: 0, variant: 0, scale: 0.9 },
    { kind: 'watchtower', col: 14, row: 0, variant: 1, scale: 0.9 },
    { kind: 'watchtower', col: 12, row: 12, variant: 1, scale: 0.85 },
    { kind: 'watchtower', col: 9, row: 12, variant: 0, scale: 0.85 },
    { kind: 'obelisk', col: 12, row: 6 },
    { kind: 'banner', col: 7, row: 1, variant: 2 },
    { kind: 'banner', col: 11, row: 0, variant: 2 },
    { kind: 'banner', col: 15, row: 1, variant: 2 },
    { kind: 'banner', col: 6, row: 2, variant: 1 },
    { kind: 'banner', col: 16, row: 4, variant: 2 },
    { kind: 'banner', col: 16, row: 7, variant: 2 },
    { kind: 'brazier', col: 13, row: 9 },
    { kind: 'brazier', col: 2, row: 10 },
    { kind: 'fountain', col: 3, row: 8, variant: 1 },
    { kind: 'pillars', col: 2, row: 1, variant: 0 },
    { kind: 'lamp', col: 8, row: 11, variant: 1 },
    { kind: 'lamp', col: 13, row: 11, variant: 1 },
    { kind: 'pillars', col: 1, row: 2, variant: 1 },
  ],
});

/** L10 — Confluence Terraces (enemies branch): terraced crossroads where two raider columns meet. */
const CONFLUENCE_TERRACES = theme({
  pathStyle: 'stone',
  bridge: 'timber',
  spawnCrystalCell: [5, 2],
  goal: { color: 0xffc355, shard: 0xffe9a8, ring: 0xe3b84a, glow: 0x9c6a0b, deco: 'sheaves' },
  water: 0x2a9fc4,
  atmosphere: { horizon: 0xffe6c4, zenith: 0x4d8fca, hemiSky: 0xffeed4, sun: 0xffe8c8, sunIntensity: 1.7 },
  grassTint: [1.05, 1.02, 0.8],
  grassZones: [{ col: 6.5, row: 5, radius: 2.4, soft: 1.3, tint: [1.4, 0.94, 0.55] }],
  ground: [
    { kind: 'field', where: 'zone', zone: { col: 6.5, row: 5, radius: 2.4 }, includeDecor: false },
    { kind: 'cobble', where: 'zone', zone: { col: 12, row: 6.5, radius: 1.7 }, includeDecor: false },
  ],
  cliff: {
    stones: [0xa39a8e, 0xb3a99a],
    bedrocks: [0x8a7f78, 0x756b66],
    dirts: [0xa8723f, 0x8a5a33],
    depthMul: 1.2,
    spireMul: 1.1,
  },
  hills: { chance: 0.7, minH: 0.3, maxH: 0.6, cap: 'grass' },
  trees: { density: 0.4, weights: { autumn: 0.4, oak: 0.3, treeLarge: 0.2, pine: 0.1 } },
  details: { wheat: 0.4 },
  waterDetails: { lilies: 3, buoys: 0, driftwood: 1 },
  ambient: {
    isletStyle: 'meadow',
    birds: 5,
    butterflies: 0,
    islets: 5,
    clouds: 6,
    leafColors: [0xf28729, 0xf6bd41, 0xe85d5d],
    leafCount: 10,
  },
  setPieces: [
    { kind: 'banner', col: 5, row: 0, variant: 0 },
    { kind: 'banner', col: 7, row: 0, variant: 0 },
    { kind: 'banner', col: 2, row: 11, variant: 2 },
    { kind: 'watchtower', col: 12, row: 5, variant: 0, scale: 0.85 },
    { kind: 'cabin', col: 3, row: 1, variant: 0 },
    { kind: 'stall', col: 1, row: 8, variant: 0 },
    { kind: 'stall', col: 13, row: 10, variant: 1 },
    { kind: 'pond', col: 6, row: 6, variant: 0 },
    { kind: 'pond', col: 4, row: 9, variant: 1 },
    { kind: 'hayBales', col: 8, row: 4, yaw: 0.4 },
    { kind: 'scarecrow', col: 15, row: 9, yaw: -0.5 },
    { kind: 'cairn', col: 1, row: 4, variant: 1 },
    { kind: 'brazier', col: 9, row: 1 },
    { kind: 'brazier', col: 11, row: 2 },
    { kind: 'windmill', col: 16, row: 5, yaw: -Math.PI / 2, variant: 1, scale: 0.9 },
  ],
});

/** L11 — Galewatch Spires (enemies branch): gale-torn spires, snow peaks, stone bridges to nowhere. */
const GALEWATCH_SPIRES = theme({
  pathStyle: 'stone',
  bridge: 'stone',
  spawnCrystalCell: [0, 3],
  goal: { color: 0xbfe8ff, shard: 0xffffff, ring: 0xb4bbc7, glow: 0x3a78b8, deco: 'pillars' },
  water: 0x2a80c4,
  atmosphere: { horizon: 0xd3deef, zenith: 0x3d6cb4, hemiSky: 0xd8e4f6, sun: 0xf4f8ff },
  grassTint: [0.72, 0.95, 0.88],
  ground: [{ kind: 'cobble', where: 'zone', zone: { col: 8, row: 10.5, radius: 2.4 } }],
  cliff: {
    stones: [0x77818f, 0x8a94a2],
    bedrocks: [0x586272, 0x4c5666],
    dirts: [0x6b5846, 0x5a4a3c],
    depthMul: 1.9,
    spireMul: 1.7,
  },
  hills: { chance: 0.8, minH: 0.45, maxH: 0.9, cap: 'snow' },
  parapet: { color: 0x8e98a8, merlon: 0xa1aab8, height: 0.24, gap: 0.2, merlons: true },
  trees: { density: 0.3, snow: true, weights: { pine: 0.6, tree: 0.2, treeLarge: 0.2 } },
  decorBake: { rockChance: 0.5, shrubChance: 0.18, crystalChance: 0.08, crystalTint: 0xb7d4f6 },
  details: { flowerMul: 0.25, pebbleMul: 2.2, tuftMul: 0.7 },
  ambient: { isletStyle: 'rock', birds: 7, butterflies: 0, islets: 6, clouds: 9 },
  setPieces: [
    { kind: 'cabin', col: 2, row: 1, variant: 1 },
    { kind: 'watchtower', col: 14, row: 1, variant: 1, scale: 0.9 },
    { kind: 'banner', col: 4, row: 0, variant: 1 },
    { kind: 'banner', col: 12, row: 0, variant: 1 },
    { kind: 'waterfall', col: 16, row: 4, yaw: Math.PI / 2 },
    { kind: 'cairn', col: 1, row: 3, variant: 0 },
    { kind: 'cairn', col: 1, row: 6, variant: 3 },
    { kind: 'brazier', col: 15, row: 7 },
    { kind: 'tent', col: 3, row: 8, variant: 1 },
    { kind: 'cabin', col: 2, row: 10, variant: 1 },
    { kind: 'brazier', col: 12, row: 10 },
    { kind: 'banner', col: 4, row: 12, variant: 0 },
    { kind: 'cairn', col: 10, row: 12, variant: 2 },
    { kind: 'seaStack', col: 7, row: 7, variant: 0 },
    { kind: 'peak', col: -3.4, row: 4, variant: 0 },
    { kind: 'peak', col: 5, row: -3.6, variant: 1 },
    { kind: 'peak', col: 19.6, row: 5.5, variant: 1 },
  ],
});

/** L12 — Stormcrown Citadel (enemies branch): storm-lit finale fortress. */
const STORMCROWN_CITADEL = theme({
  pathStyle: 'stone',
  bridge: 'stone',
  spawnCrystalCell: [1, 3],
  goal: { color: 0xb58cf2, shard: 0xe6d4ff, ring: 0xf6bd41, glow: 0x5b2fb8, deco: 'goldPillars' },
  water: 0x1d6fa0,
  atmosphere: { horizon: 0x9aa2c4, zenith: 0x2a2f68, hemiSky: 0x8e98c8, sun: 0xd6dcff, sunIntensity: 1.4 },
  grassTint: [0.6, 0.82, 0.72],
  ground: [{ kind: 'cobble', where: 'zone', zone: { col: 9, row: 7, radius: 2.8 }, includeDecor: false }],
  cliff: {
    stones: [0x6c7088, 0x7c8098],
    bedrocks: [0x4a4f68, 0x3f445c],
    dirts: [0x5a4a46, 0x4a3c3a],
    depthMul: 1.7,
    spireMul: 1.5,
  },
  hills: { chance: 0.6, minH: 0.35, maxH: 0.75, cap: 'stone' },
  parapet: { color: 0x7c8098, merlon: 0x9298b0, height: 0.26, gap: 0.1, merlons: true },
  trees: { density: 0.4, weights: { pine: 0.5, treeLarge: 0.25, tree: 0.25 } },
  decorBake: { rockChance: 0.5, shrubChance: 0.2, crystalChance: 0.3, crystalTint: 0xc9a0ff },
  details: {
    flowerMul: 0.5,
    pebbleMul: 1.8,
    flowers: [
      [0xbd82e1, 0xf8f4e8],
      [0xb7d4f6, 0xf8f4e8],
      [0xf8f4e8, 0xf6bd41],
    ],
  },
  waterDetails: { lilies: 0, buoys: 0, driftwood: 3 },
  ambient: {
    isletStyle: 'ruin',
    birds: 3,
    butterflies: 8,
    butterflyColors: [0xc9a0ff, 0xe6d4ff, 0x9468dc],
    butterflySize: 0.6,
    islets: 6,
    clouds: 9,
  },
  setPieces: [
    { kind: 'watchtower', col: 3, row: 0, variant: 0, scale: 0.9 },
    { kind: 'watchtower', col: 11, row: 0, variant: 1, scale: 0.9 },
    { kind: 'ruinWall', col: 7, row: 1, variant: 0 },
    { kind: 'watchtower', col: 16, row: 9, variant: 1, scale: 0.85 },
    { kind: 'banner', col: 10, row: 1, variant: 1 },
    { kind: 'banner', col: 1, row: 1, variant: 1 },
    { kind: 'obelisk', col: 10, row: 3, scale: 0.72 },
    { kind: 'statue', col: 7, row: 7, variant: 1 },
    { kind: 'brazier', col: 4, row: 7 },
    { kind: 'brazier', col: 1, row: 7 },
    { kind: 'brazier', col: 15, row: 8 },
    { kind: 'cairn', col: 11, row: 10, variant: 2 },
    { kind: 'banner', col: 1, row: 11, variant: 1 },
    { kind: 'banner', col: 5, row: 11, variant: 1 },
    { kind: 'banner', col: 9, row: 11, variant: 1 },
    { kind: 'banner', col: 15, row: 11, variant: 1 },
    { kind: 'pillars', col: 6, row: 3, variant: 1 },
    { kind: 'seaStack', col: 8.8, row: 0.6, variant: 1 },
    { kind: 'peak', col: -3.4, row: 3.5, variant: 0 },
    { kind: 'peak', col: 21.2, row: 7, variant: 1 },
    { kind: 'peak', col: 7, row: -3.8, variant: 1 },
  ],
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
  // Levels 10-12 live on the enemies branch; themes are ready for the merge (ids must match).
  'confluence-terraces': CONFLUENCE_TERRACES,
  'galewatch-spires': GALEWATCH_SPIRES,
  'stormcrown-citadel': STORMCROWN_CITADEL,
};

/** Biome presets reused (without level-specific coordinates) for islands that have no authored theme yet. */
const FALLBACK_BIOMES: readonly IslandTheme[] = [
  SUNLIT_MEADOW,
  HIGHLAND_CITADEL,
  EMERALD_STEPPING_STONES,
  WINDMILL_SWITCHBACK,
  CRESCENT_LAGOON,
  SUNKEN_BASTION,
  GRAND_SKYHOLD,
].map((t) => ({ ...t, setPieces: [], ground: [], grassZones: [] }));

const derivedCache = new Map<string, IslandTheme>();

function hashString(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Authored theme for the island, or (for ids without one, e.g. levels added later) a deterministic biome preset
 * derived from the id so new islands still get their own palette, trees, sky and ambient life.
 */
export function getIslandTheme(levelId: string): IslandTheme {
  const authored = THEME_TABLE[levelId];
  if (authored) return authored;
  let derived = derivedCache.get(levelId);
  if (!derived) {
    derived = FALLBACK_BIOMES[hashString(levelId) % FALLBACK_BIOMES.length];
    derivedCache.set(levelId, derived);
  }
  return derived;
}
