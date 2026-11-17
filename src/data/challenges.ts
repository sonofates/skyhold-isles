import type { LevelDef } from './levels/types.ts';
import { TOWER_DEFS } from './towers.ts';
import type { AchievementDef, ChallengeDef, MutatorDef, MutatorPreset } from '../sim/meta/types.ts';

/**
 * Hand-crafted optional challenges for the core islands (3 per island = 27 Challenge Stars).
 * Keyed by `LevelDef.id` so islands added later automatically get fallback challenges via `getChallengesForLevel`.
 */
export const CHALLENGES_BY_LEVEL_ID: Record<string, readonly ChallengeDef[]> = {
  'sunlit-meadow': [
    {
      id: 'sunlit-meadow:perfect',
      levelId: 'sunlit-meadow',
      title: 'Flawless Meadow',
      description: 'Win without losing a single life.',
      condition: { kind: 'noLivesLost' },
    },
    {
      id: 'sunlit-meadow:lean',
      levelId: 'sunlit-meadow',
      title: 'Minimalist Watch',
      description: 'Win by building at most 6 towers total.',
      condition: { kind: 'maxTowersBuilt', maxCount: 6 },
    },
    {
      id: 'sunlit-meadow:rush3x',
      levelId: 'sunlit-meadow',
      title: 'Gale Tempo',
      description: 'Play all combat waves at 3x speed.',
      condition: { kind: 'combatSpeedOnly', requiredSpeed: 3 },
    },
  ],
  'twin-bridge-cay': [
    {
      id: 'twin-bridge-cay:no-frost',
      levelId: 'twin-bridge-cay',
      title: 'Thaw the Viaduct',
      description: 'Win without building any Frost Spires.',
      condition: { kind: 'forbiddenTowerTypes', forbidden: ['frost'] },
    },
    {
      id: 'twin-bridge-cay:no-abilities',
      levelId: 'twin-bridge-cay',
      title: 'Pure Architecture',
      description: 'Win without casting Meteor Strike or Overcharge.',
      condition: { kind: 'noAbilities' },
    },
    {
      id: 'twin-bridge-cay:max-t2',
      levelId: 'twin-bridge-cay',
      title: 'Apprentice Engineers',
      description: 'Win without upgrading any tower to Tier 3.',
      condition: { kind: 'maxTowerTier', maxTier: 2 },
    },
  ],
  'highland-citadel': [
    {
      id: 'highland-citadel:no-mortar',
      levelId: 'highland-citadel',
      title: 'Close Quarters',
      description: 'Win without building any Siege Mortars.',
      condition: { kind: 'forbiddenTowerTypes', forbidden: ['mortar'] },
    },
    {
      id: 'highland-citadel:no-sell',
      levelId: 'highland-citadel',
      title: 'Set in Stone',
      description: 'Win without selling any towers.',
      condition: { kind: 'noTowerSelling' },
    },
    {
      id: 'highland-citadel:sturdy',
      levelId: 'highland-citadel',
      title: 'Citadel Bastion',
      description: 'Finish with at least 15 lives remaining.',
      condition: { kind: 'minLivesRemaining', minLives: 15 },
    },
  ],
  'emerald-stepping-stones': [
    {
      id: 'emerald-stepping-stones:no-tesla',
      levelId: 'emerald-stepping-stones',
      title: 'Grounded Currents',
      description: 'Win without building any Tesla Coils.',
      condition: { kind: 'forbiddenTowerTypes', forbidden: ['tesla'] },
    },
    {
      id: 'emerald-stepping-stones:frugal',
      levelId: 'emerald-stepping-stones',
      title: 'Frugal Crossing',
      description: 'Win while spending at most 2,750 gold on towers.',
      condition: { kind: 'maxGoldSpent', maxGold: 2750 },
    },
    {
      id: 'emerald-stepping-stones:early-waves',
      levelId: 'emerald-stepping-stones',
      title: 'Impatient Tactician',
      description: 'Call at least 6 waves early for bonus gold.',
      condition: { kind: 'minEarlyWaves', minCount: 6 },
    },
  ],
  'windmill-switchback': [
    {
      id: 'windmill-switchback:no-cannon',
      levelId: 'windmill-switchback',
      title: 'Light Ordinance',
      description: 'Win without building any Cannon Bastions.',
      condition: { kind: 'forbiddenTowerTypes', forbidden: ['cannon'] },
    },
    {
      id: 'windmill-switchback:perfect',
      levelId: 'windmill-switchback',
      title: 'Clean Switchback',
      description: 'Win without losing a single life.',
      condition: { kind: 'noLivesLost' },
    },
    {
      id: 'windmill-switchback:rush3x',
      levelId: 'windmill-switchback',
      title: 'Tailwind Rush',
      description: 'Play all combat waves at 3x speed.',
      condition: { kind: 'combatSpeedOnly', requiredSpeed: 3 },
    },
  ],
  'crescent-lagoon': [
    {
      id: 'crescent-lagoon:no-frost',
      levelId: 'crescent-lagoon',
      title: 'Sunlit Lagoon',
      description: 'Win without building any Frost Spires.',
      condition: { kind: 'forbiddenTowerTypes', forbidden: ['frost'] },
    },
    {
      id: 'crescent-lagoon:frugal',
      levelId: 'crescent-lagoon',
      title: 'Lean Atoll',
      description: 'Win while spending at most 3,100 gold on towers.',
      condition: { kind: 'maxGoldSpent', maxGold: 3100 },
    },
    {
      id: 'crescent-lagoon:no-abilities',
      levelId: 'crescent-lagoon',
      title: 'Calm Seas',
      description: 'Win without casting Meteor Strike or Overcharge.',
      condition: { kind: 'noAbilities' },
    },
  ],
  'skybridge-gauntlet': [
    {
      id: 'skybridge-gauntlet:no-cannon',
      levelId: 'skybridge-gauntlet',
      title: 'Light Artillery Ban',
      description: 'Win without building any Cannon Bastions.',
      condition: { kind: 'forbiddenTowerTypes', forbidden: ['cannon'] },
    },
    {
      id: 'skybridge-gauntlet:lean',
      levelId: 'skybridge-gauntlet',
      title: 'Skeleton Garrison',
      description: 'Win by building at most 15 towers total.',
      condition: { kind: 'maxTowersBuilt', maxCount: 15 },
    },
    {
      id: 'skybridge-gauntlet:sturdy',
      levelId: 'skybridge-gauntlet',
      title: 'Unbroken Chasm',
      description: 'Finish with at least 14 lives remaining.',
      condition: { kind: 'minLivesRemaining', minLives: 14 },
    },
  ],
  'sunken-bastion': [
    {
      id: 'sunken-bastion:no-tesla',
      levelId: 'sunken-bastion',
      title: 'Silent Bastion',
      description: 'Win without building any Tesla Coils.',
      condition: { kind: 'forbiddenTowerTypes', forbidden: ['tesla'] },
    },
    {
      id: 'sunken-bastion:frugal',
      levelId: 'sunken-bastion',
      title: 'Quartermaster',
      description: 'Win while spending at most 5,200 gold on towers.',
      condition: { kind: 'maxGoldSpent', maxGold: 5200 },
    },
    {
      id: 'sunken-bastion:rush3x',
      levelId: 'sunken-bastion',
      title: 'Blitz Siege',
      description: 'Play all combat waves at 3x speed.',
      condition: { kind: 'combatSpeedOnly', requiredSpeed: 3 },
    },
  ],
  'grand-skyhold': [
    {
      id: 'grand-skyhold:no-mortar',
      levelId: 'grand-skyhold',
      title: 'Close Defense',
      description: 'Win without building any Siege Mortars.',
      condition: { kind: 'forbiddenTowerTypes', forbidden: ['mortar'] },
    },
    {
      id: 'grand-skyhold:sturdy',
      levelId: 'grand-skyhold',
      title: 'Royal Guard',
      description: 'Finish with at least 15 lives remaining.',
      condition: { kind: 'minLivesRemaining', minLives: 15 },
    },
    {
      id: 'grand-skyhold:no-sell',
      levelId: 'grand-skyhold',
      title: 'Eternal Keep',
      description: 'Win without selling any towers.',
      condition: { kind: 'noTowerSelling' },
    },
  ],
};

function hashLevelId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Returns the 3 optional challenges for a level. Uses curated entries for islands 1–9
 * and deterministically generates 3 level-id-keyed challenges for any new islands added later.
 */
export function getChallengesForLevel(level: LevelDef): readonly ChallengeDef[] {
  const existing = CHALLENGES_BY_LEVEL_ID[level.id];
  if (existing) return existing;

  const h = hashLevelId(level.id);
  const bannedPool = ['frost', 'mortar', 'cannon', 'tesla'] as const;
  const bannedType = bannedPool[h % bannedPool.length];
  const minLives =
    level.difficulty === 'Breezy'
      ? 20
      : level.difficulty === 'Challenging'
        ? 16
        : level.difficulty === 'Heroic'
          ? 13
          : 10;
  const plannedTowers =
    level.scriptedBuildOrder?.filter((a) => a.action === 'build').length ?? 0;
  const waveBasedCap = Math.max(8, Math.min(20, Math.round(level.waves.length * 0.75)));
  const maxTowers =
    plannedTowers > 0
      ? Math.max(8, Math.min(22, Math.round(plannedTowers * 0.85)))
      : waveBasedCap;

  const banLabels: Record<(typeof bannedPool)[number], string> = {
    frost: 'Frost Spires',
    mortar: 'Siege Mortars',
    cannon: 'Cannon Bastions',
    tesla: 'Tesla Coils',
  };
  const bannedLabel = banLabels[bannedType] ?? `${TOWER_DEFS[bannedType].name}s`;

  return [
    {
      id: `${level.id}:sturdy`,
      levelId: level.id,
      title: minLives === 20 ? 'Untouched Citadel' : 'Steadfast Watch',
      description:
        minLives === 20
          ? 'Win without losing a single life.'
          : `Finish with at least ${minLives} lives remaining.`,
      condition:
        minLives === 20
          ? { kind: 'noLivesLost' }
          : { kind: 'minLivesRemaining', minLives },
    },
    {
      id: `${level.id}:restricted`,
      levelId: level.id,
      title: 'Improvised Bastion',
      description: `Win without building any ${bannedLabel}.`,
      condition: { kind: 'forbiddenTowerTypes', forbidden: [bannedType] },
    },
    {
      id: `${level.id}:lean`,
      levelId: level.id,
      title: 'Compact Garrison',
      description: `Win by building at most ${maxTowers} towers total.`,
      condition: { kind: 'maxTowersBuilt', maxCount: maxTowers },
    },
  ];
}

export function getChallengeById(
  challengeId: string,
  levels: readonly LevelDef[],
): ChallengeDef | undefined {
  for (let i = 0; i < levels.length; i++) {
    const list = getChallengesForLevel(levels[i]);
    for (let j = 0; j < list.length; j++) {
      if (list[j].id === challengeId) return list[j];
    }
  }
  return undefined;
}

/** 25 data-driven achievements spanning campaign, challenges, combat, economy, and endless/daily. */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first_victory',
    name: 'First Skyhold Secured',
    description: 'Win your first island campaign.',
    category: 'campaign',
    target: 1,
  },
  {
    id: 'island_explorer',
    name: 'Archipelago Vanguard',
    description: 'Earn at least 1 star on 5 different islands.',
    category: 'campaign',
    target: 5,
  },
  {
    id: 'campaign_champion',
    name: 'Sovereign of the Skies',
    description: 'Clear at least 9 campaign islands.',
    category: 'campaign',
    target: 9,
  },
  {
    id: 'star_collector_15',
    name: 'Constellation',
    description: 'Earn 15 campaign stars across all islands.',
    category: 'campaign',
    target: 15,
  },
  {
    id: 'star_collector_27',
    name: 'Radiant Crown',
    description: 'Earn 27 campaign stars across the archipelago.',
    category: 'campaign',
    target: 27,
  },
  {
    id: 'challenger_5',
    name: 'Tactical Edge',
    description: 'Complete 5 optional island challenges.',
    category: 'mastery',
    target: 5,
  },
  {
    id: 'challenger_15',
    name: 'Master Strategist',
    description: 'Complete 15 optional island challenges.',
    category: 'mastery',
    target: 15,
  },
  {
    id: 'flawless_defense',
    name: 'Not a Scratch',
    description: 'Win any island campaign without losing a life.',
    category: 'mastery',
    target: 1,
  },
  {
    id: 'speed_demon',
    name: 'Wind at Your Back',
    description: 'Win an island campaign with all combat waves at 3x speed.',
    category: 'mastery',
    target: 1,
  },
  {
    id: 'minimalist',
    name: 'Less Is More',
    description: 'Win an island campaign while building 6 or fewer towers.',
    category: 'mastery',
    target: 1,
  },
  {
    id: 'slayer_250',
    name: 'Skyline Defender',
    description: 'Defeat 250 enemies across all runs.',
    category: 'combat',
    target: 250,
  },
  {
    id: 'slayer_2500',
    name: 'Stormbreaker',
    description: 'Defeat 2,500 enemies across all runs.',
    category: 'combat',
    target: 2500,
  },
  {
    id: 'boss_slayer_10',
    name: 'Dreadnought Hunter',
    description: 'Defeat 10 Skyhold Dreadnought bosses.',
    category: 'combat',
    target: 10,
  },
  {
    id: 'anti_air_ace',
    name: 'Clear Skies',
    description: 'Defeat 250 flying enemies.',
    category: 'combat',
    target: 250,
  },
  {
    id: 'overcharge_cleanse',
    name: 'System Surge',
    description: 'Cleanse a jammed tower using Overcharge.',
    category: 'combat',
    target: 1,
  },
  {
    id: 'meteor_caller',
    name: 'Starfall Tactician',
    description: 'Call down 20 Meteor Strikes.',
    category: 'combat',
    target: 20,
  },
  {
    id: 'master_architect',
    name: 'Master Architect',
    description: 'Build 100 towers across all runs.',
    category: 'economy',
    target: 100,
  },
  {
    id: 'tier3_forge',
    name: 'Apex Engineering',
    description: 'Upgrade 25 towers to Tier 3.',
    category: 'economy',
    target: 25,
  },
  {
    id: 'upgrade_specialist',
    name: 'Grand Forge',
    description: 'Upgrade towers 100 times across all runs.',
    category: 'economy',
    target: 100,
  },
  {
    id: 'gold_baron',
    name: 'Treasury of the Clouds',
    description: 'Earn 25,000 total gold from defeats and wave bonuses.',
    category: 'economy',
    target: 25000,
  },
  {
    id: 'early_bird',
    name: 'Strike Early',
    description: 'Call 30 waves early across all runs.',
    category: 'economy',
    target: 30,
  },
  {
    id: 'endless_survivor',
    name: 'Into the Horizon',
    description: 'Reach Wave 15 or higher in Endless Mode.',
    category: 'endless',
    target: 15,
  },
  {
    id: 'mutated_endless',
    name: 'Tempest Tactician',
    description: 'Clear 5 Endless waves in one run with mutators active.',
    category: 'endless',
    target: 5,
  },
  {
    id: 'daily_victor',
    name: 'Daily Watch',
    description: 'Complete a Daily Challenge run.',
    category: 'endless',
    target: 1,
  },
  {
    id: 'daily_streak_3',
    name: 'Threefold Vigil',
    description: 'Complete Daily Challenges on 3 consecutive days.',
    category: 'endless',
    target: 3,
  },
];

/** Catalog of mutators for Endless Mode and Daily Challenges. */
export const ENDLESS_MUTATORS: readonly MutatorDef[] = [
  {
    id: 'swift_march',
    name: 'Tailwind March',
    description: 'Enemies move 22% faster.',
    scoreMultiplierBonus: 0.25,
    modifiers: {
      enemySpeedMultiplier: 1.22,
    },
  },
  {
    id: 'iron_clad',
    name: 'Ironclad Vanguard',
    description: 'All enemies gain +3 flat armor.',
    scoreMultiplierBonus: 0.3,
    modifiers: {
      enemyArmorBonus: 3,
    },
  },
  {
    id: 'sky_swarm',
    name: 'Sky Swarm',
    description: 'Double flying enemies in every wave.',
    scoreMultiplierBonus: 0.3,
    conflictGroup: 'air-pressure',
    modifiers: {
      flyerCountMultiplier: 2,
    },
  },
  {
    id: 'gold_drought',
    name: 'Gold Drought',
    description: 'Kills and wave bonuses grant 25% less gold.',
    scoreMultiplierBonus: 0.35,
    conflictGroup: 'economy-squeeze',
    modifiers: {
      goldRewardMultiplier: 0.75,
    },
  },
  {
    id: 'titan_tide',
    name: 'Titan Tide',
    description: 'All enemies have 25% increased health.',
    scoreMultiplierBonus: 0.3,
    modifiers: {
      enemyHpMultiplier: 1.25,
    },
  },
  {
    id: 'tight_budget',
    name: 'Austerity Pact',
    description: 'Tower builds and upgrades cost 15% more gold.',
    scoreMultiplierBonus: 0.25,
    conflictGroup: 'economy-squeeze',
    modifiers: {
      towerCostMultiplier: 1.15,
    },
  },
  {
    id: 'no_frost',
    name: 'Meltwater Ban',
    description: 'Frost Spires cannot be built.',
    scoreMultiplierBonus: 0.25,
    conflictGroup: 'air-pressure',
    modifiers: {
      forbiddenTowerTypes: ['frost'],
    },
  },
  {
    id: 'no_tesla',
    name: 'Grounded Skies',
    description: 'Tesla Coils cannot be built.',
    scoreMultiplierBonus: 0.25,
    conflictGroup: 'air-pressure',
    modifiers: {
      forbiddenTowerTypes: ['tesla'],
    },
  },
];

/** Curated non-conflicting Endless mutator presets for quick selection in Endless setup UI. */
export const ENDLESS_MUTATOR_PRESETS: readonly MutatorPreset[] = [
  {
    id: 'iron-skies',
    name: 'Iron Skies',
    description: 'Armored legions paired with doubled aerial raids.',
    mutatorIds: ['iron_clad', 'sky_swarm'],
  },
  {
    id: 'blitz-tide',
    name: 'Blitz Tide',
    description: 'Faster, tougher enemies testing DPS and slowing defense.',
    mutatorIds: ['swift_march', 'titan_tide'],
  },
  {
    id: 'lean-siege',
    name: 'Lean Siege',
    description: 'Higher build costs without Frost Spires to stall the line.',
    mutatorIds: ['tight_budget', 'no_frost'],
  },
  {
    id: 'skyhold-gauntlet',
    name: 'Skyhold Gauntlet',
    description: 'High-stakes triad: fast enemies, extra armor, and lean gold rewards.',
    mutatorIds: ['swift_march', 'iron_clad', 'gold_drought'],
  },
  {
    id: 'storm-front',
    name: 'Storm Front',
    description: 'Swifter raiders paired with doubled aerial squadrons.',
    mutatorIds: ['swift_march', 'sky_swarm'],
  },
  {
    id: 'ember-crucible',
    name: 'Ember Crucible',
    description: 'Reinforced, armored waves with Frost Spires banned.',
    mutatorIds: ['titan_tide', 'iron_clad', 'no_frost'],
  },
];
