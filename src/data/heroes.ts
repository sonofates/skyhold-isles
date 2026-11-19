import type {
  HeroId,
  HeroProgressEntry,
  HeroSaveData,
  HeroSkillSlot,
  TowerType,
} from '../core/types.ts';

export const HERO_IDS: readonly HeroId[] = ['bran', 'wren', 'mira', 'tobb', 'sela'];

export function isHeroId(val: unknown): val is HeroId {
  return typeof val === 'string' && (HERO_IDS as readonly string[]).includes(val);
}

export const HERO_MAX_LEVEL = 20;

/**
 * Cumulative persistent XP required to reach each hero level 1..20 (index = level - 1).
 * Tuned so ~1 partial run reaches L2, ~1 full 3★ island clear reaches L3, ~10 clears reach L10,
 * and ~38 clears reach L20.
 */
export const HERO_LEVEL_XP: readonly number[] = [
  0,     // L1
  120,   // L2
  289,   // L3
  509,   // L4
  785,   // L5
  1121,  // L6
  1521,  // L7
  1989,  // L8
  2529,  // L9
  3145,  // L10
  3841,  // L11
  4621,  // L12
  5489,  // L13
  6449,  // L14
  7505,  // L15
  8661,  // L16
  9921,  // L17
  11289, // L18
  12769, // L19
  14365, // L20
];

/** Persistent XP earned during a run (kills, waves cleared, victory + stars). */
export const HERO_XP_RULES = {
  perKill: 1,
  perWaveCleared: 12,
  winBase: 30,
  perStar: 15,
} as const;

/** Shared hero simulation constants (world units & seconds). */
export const HERO_RULES = {
  /** Body radius for melee contact distance (`enemy.radius + HERO_RULES.radius`). */
  radius: 0.36,
  /** Extra slack before a melee hero loses contact and closes back in. */
  contactSlack: 0.32,
  /** Ground enemies within this distance of a melee hero's post get intercepted and blocked. */
  meleeEngageRadius: 2.1,
  /** Held enemies dragged / blinked further than this from a melee hero's post are released. */
  meleeLeashRadius: 3.1,
  /** Cleave reach around the primary melee target. */
  cleaveRadius: 1.1,
  /** Maximum distance off the road centreline a move command allows (road + shoulder verge). */
  maxOffRoadDist: 1.2,
  /** Idle regeneration fraction of max HP per second after `regenDelay` seconds out of combat. */
  regenFrac: 0.06,
  regenDelay: 2.0,
  /** Distance from the castle goal along the final road segment where the hero spawns/respawns. */
  castleSpawnBackoff: 0.75,
  /** Per-level base stat growth (level 1 -> 20, applied before skill-tree patches). */
  hpGrowthPerLevel: 0.068,
  damageGrowthPerLevel: 0.062,
  armorGrowthPerLevel: 0.16,
} as const;

/**
 * Campaign unlock milestone (data-driven; mobile monetisation stays unwired pending owner decision).
 */
export type HeroUnlockRule =
  | { readonly kind: 'starter'; readonly iapProductId?: string }
  | {
      readonly kind: 'islandsCleared';
      /** Campaign islands cleared to unlock (placeholder milestones: 2, 4, 7, 10). */
      readonly count: number;
      readonly iapProductId?: string;
    };

export type HeroPassiveKind = 'bulwark' | 'keenEye' | 'kindling' | 'tinker' | 'calmWaters';

export type HeroPassiveExtra =
  | 'groundCrits'
  | 'twinArrow'
  | 'tinkerRange'
  | 'calmArmor'
  | 'chillBolts';

export type HeroActiveKind =
  | 'shieldBash'
  | 'rallyBanner'
  | 'volley'
  | 'huntersMark'
  | 'fireRing'
  | 'wispBurst'
  | 'deployGizmo'
  | 'overhaul'
  | 'undertow'
  | 'thunderCall';

export type HeroActiveExtra =
  | 'bashSlow'
  | 'rallyHeal'
  | 'volleySlow'
  | 'doubleVolley'
  | 'ringSlow'
  | 'shatterShields'
  | 'wispFireRing'
  | 'gizmoSplash'
  | 'overhaulGizmos'
  | 'undertowHeal'
  | 'thunderStun'
  | 'thunderBrittle';

export interface HeroActivePatch {
  readonly damageMul?: number;
  readonly cooldownMul?: number;
  readonly radiusBonus?: number;
  readonly rangeBonus?: number;
  readonly durationBonus?: number;
  readonly countBonus?: number;
  readonly effectBonus?: number;
  readonly armorBonus?: number;
  readonly extras?: readonly HeroActiveExtra[];
}

/**
 * Strongly-typed modifier patch granted by a skill-tree node.
 * Multiplicative fields (`*Mul`) sum across unlocked nodes before scaling `(1 + sumMul)`.
 * Flat fields (`*Bonus`) add directly.
 */
export interface HeroEffectPatch {
  readonly maxHpMul?: number;
  readonly maxHpBonus?: number;
  readonly armorBonus?: number;
  readonly damageMul?: number;
  readonly attackSpeedMul?: number;
  readonly rangeBonus?: number;
  readonly splashRadiusBonus?: number;
  readonly moveSpeedMul?: number;
  readonly respawnMul?: number;
  readonly holdCapBonus?: number;
  readonly armorPierceBonus?: number;
  readonly cleaveBonus?: number;
  readonly passivePowerMul?: number;
  readonly passiveRadiusBonus?: number;
  readonly passiveChanceBonus?: number;
  readonly passiveDurationBonus?: number;
  readonly passiveExtras?: readonly HeroPassiveExtra[];
  readonly active0?: HeroActivePatch;
  readonly active1?: HeroActivePatch;
}

export interface HeroBranchDef {
  readonly id: string;
  readonly index: 0 | 1 | 2;
  readonly name: string;
  readonly description: string;
}

export type HeroNodeTier = 1 | 2 | 3 | 4 | 5;

export interface HeroSkillNodeDef {
  readonly id: string;
  /** Branch id (`hero.branches[i].id`), or `'capstone'` for the tier-5 capstone node. */
  readonly branch: string;
  readonly tier: HeroNodeTier;
  readonly isCapstone?: boolean;
  readonly name: string;
  readonly description: string;
  readonly cost: number;
  /**
   * Prerequisite node IDs in the same hero's tree. By default every listed prerequisite is required;
   * when `minPrerequisites` is set (the capstone lists the 3 tier-3 branch nodes with `minPrerequisites: 2`),
   * at least that many of `prerequisites` must be unlocked.
   */
  readonly prerequisites: readonly string[];
  readonly minPrerequisites?: number;
  readonly patch: HeroEffectPatch;
}

export interface HeroLevelGrowth {
  readonly hpPerLevel?: number;
  readonly damagePerLevel?: number;
  readonly armorPerLevel?: number;
}

export interface HeroBaseStats {
  readonly maxHp: number;
  readonly armor: number;
  readonly damage: number;
  /** Attacks per second. */
  readonly attackSpeed: number;
  /** World units (melee contact reach for melee heroes, projectile targeting radius for ranged). */
  readonly range: number;
  /** World units per second along the ground graph. */
  readonly moveSpeed: number;
  /** Seconds to respawn at the castle after falling. */
  readonly respawnSec: number;
  /** Ground enemies this hero can hold in melee (`> 0` for melee blockers, `0` for ranged). */
  readonly holdCap: number;
  readonly hitsFlyers: boolean;
  readonly attackMode: 'melee' | 'ranged';
  /** Projectile visual archetype used when `attackMode === 'ranged'`. */
  readonly projectileStyle?: TowerType;
  readonly projectileSpeed?: number;
  readonly splashRadius?: number;
  readonly armorPierce?: number;
  readonly cleave?: number;
  /** Optional per-hero level scaling overrides (defaults to `HERO_RULES.*GrowthPerLevel`). */
  readonly levelGrowth?: HeroLevelGrowth;
}

export interface HeroPassiveDef {
  readonly id: string;
  readonly kind: HeroPassiveKind;
  readonly name: string;
  readonly description: string;
  /** Primary effect magnitude (reduction ratio, crit bonus mult, burn DPS, tower rate bonus, heal/s). */
  readonly power: number;
  /** Aura / trigger radius in world units (`0` when on-hit or melee-contact). */
  readonly radius: number;
  /** Trigger probability `[0, 1]` when stochastic (`keenEye`), `0` otherwise. */
  readonly chance: number;
  /** Effect duration in seconds (`kindling`), `0` otherwise. */
  readonly durationSec: number;
}

export interface HeroActiveDef {
  readonly id: string;
  readonly slot: HeroSkillSlot;
  readonly kind: HeroActiveKind;
  readonly name: string;
  readonly description: string;
  /** `'self'` casts immediately around the hero; `'point'` targets world coordinates `(x, z)`. */
  readonly targetMode: 'self' | 'point';
  readonly cooldownSec: number;
  /** Cast reach from the hero in world units (`0` for `'self'`). */
  readonly range: number;
  /** AoE / cone / chain / aura / line length radius in world units. */
  readonly radius: number;
  readonly damage: number;
  /** Secondary effect value (slow ratio, damage-taken amp, burn DPS, turret fire rate, buff ratio). */
  readonly effect: number;
  readonly durationSec: number;
  /** Target / chain / turret count (`1` by default). */
  readonly count: number;
  /** Flat armor granted (`rallyBanner`). */
  readonly armorBonus?: number;
}

export interface HeroDef {
  readonly id: HeroId;
  readonly name: string;
  readonly title: string;
  readonly shortDesc: string;
  readonly unlock: HeroUnlockRule;
  readonly baseStats: HeroBaseStats;
  readonly passive: HeroPassiveDef;
  readonly actives: readonly [HeroActiveDef, HeroActiveDef];
  readonly branches: readonly [HeroBranchDef, HeroBranchDef, HeroBranchDef];
  readonly skillTree: readonly HeroSkillNodeDef[];
}

export interface ResolvedHeroPassive {
  readonly kind: HeroPassiveKind;
  readonly power: number;
  readonly radius: number;
  readonly chance: number;
  readonly durationSec: number;
  readonly extras: ReadonlySet<HeroPassiveExtra>;
}

export interface ResolvedHeroActive {
  readonly id: string;
  readonly slot: HeroSkillSlot;
  readonly kind: HeroActiveKind;
  readonly targetMode: 'self' | 'point';
  readonly cooldownSec: number;
  readonly range: number;
  readonly radius: number;
  readonly damage: number;
  readonly effect: number;
  readonly durationSec: number;
  readonly count: number;
  readonly armorBonus: number;
  readonly extras: ReadonlySet<HeroActiveExtra>;
}

export interface ResolvedHeroStats {
  readonly heroId: HeroId;
  readonly level: number;
  readonly maxHp: number;
  readonly armor: number;
  readonly damage: number;
  readonly attackSpeed: number;
  readonly range: number;
  readonly moveSpeed: number;
  readonly respawnSec: number;
  readonly holdCap: number;
  readonly hitsFlyers: boolean;
  readonly attackMode: 'melee' | 'ranged';
  readonly projectileStyle: TowerType;
  readonly projectileSpeed: number;
  readonly splashRadius: number;
  readonly armorPierce: number;
  readonly cleave: number;
  readonly passive: ResolvedHeroPassive;
  readonly actives: readonly [ResolvedHeroActive, ResolvedHeroActive];
}

export const HERO_DEFS: Readonly<Record<HeroId, HeroDef>> = {
  bran: {
    id: 'bran',
    name: 'Bran Ironoak',
    title: 'Shield Knight',
    shortDesc: 'Stalwart melee guardian who holds the road, weakens enemy blows, and rallies nearby militia.',
    unlock: { kind: 'starter' },
    baseStats: {
      maxHp: 425,
      armor: 5,
      damage: 34,
      attackSpeed: 1.14,
      range: 1.25,
      moveSpeed: 3.6,
      respawnSec: 11.1,
      holdCap: 2,
      hitsFlyers: false,
      attackMode: 'melee',
      armorPierce: 2,
      cleave: 0.24,
      levelGrowth: { hpPerLevel: 0.068, damagePerLevel: 0.017, armorPerLevel: 0.17 },
    },
    passive: {
      id: 'bulwark',
      kind: 'bulwark',
      name: 'Bulwark',
      description: 'Ground foes blocked by Bran deal 22% less melee damage.',
      power: 0.22,
      radius: 0,
      chance: 0,
      durationSec: 0,
    },
    actives: [
      {
        id: 'shield_bash',
        slot: 0,
        kind: 'shieldBash',
        name: 'Shield Bash',
        description: 'Slams his oak shield forward in a short cone, dealing impact damage and stunning ground foes.',
        targetMode: 'point',
        cooldownSec: 11,
        range: 2.9,
        radius: 2.6,
        damage: 79,
        effect: 0,
        durationSec: 1.5,
        count: 1,
      },
      {
        id: 'rally_banner',
        slot: 1,
        kind: 'rallyBanner',
        name: 'Rally Banner',
        description: 'Plants an ironoak standard that grants nearby soldiers bonus armor and melee damage.',
        targetMode: 'self',
        cooldownSec: 17,
        range: 0,
        radius: 3.8,
        damage: 0,
        effect: 0.25,
        durationSec: 6.5,
        count: 1,
        armorBonus: 2,
      },
    ],
    branches: [
      { id: 'oakheart', index: 0, name: 'Oakheart', description: 'Vitality, heavy plate, and holding power.' },
      { id: 'ironclad', index: 1, name: 'Ironclad', description: 'Cleaving strikes and crushing shield bashes.' },
      { id: 'vanguard', index: 2, name: 'Vanguard', description: 'Bulwark protection and militia standards.' },
    ],
    skillTree: [
      {
        id: 'bran_oak_1',
        branch: 'oakheart',
        tier: 1,
        name: 'Deep Roots',
        description: '+15% max health.',
        cost: 1,
        prerequisites: [],
        patch: { maxHpMul: 0.15 },
      },
      {
        id: 'bran_oak_2',
        branch: 'oakheart',
        tier: 2,
        name: 'Bronze Rim',
        description: '+2 armor.',
        cost: 1,
        prerequisites: ['bran_oak_1'],
        patch: { armorBonus: 2 },
      },
      {
        id: 'bran_oak_3',
        branch: 'oakheart',
        tier: 3,
        name: 'Shield Wall',
        description: 'Holds +1 extra ground foe and respawns 15% faster.',
        cost: 2,
        prerequisites: ['bran_oak_2'],
        patch: { holdCapBonus: 1, respawnMul: -0.15 },
      },
      {
        id: 'bran_oak_4',
        branch: 'oakheart',
        tier: 4,
        name: 'Ancient Timber',
        description: '+25% max health and +2 armor.',
        cost: 2,
        prerequisites: ['bran_oak_3'],
        patch: { maxHpMul: 0.25, armorBonus: 2 },
      },
      {
        id: 'bran_iron_1',
        branch: 'ironclad',
        tier: 1,
        name: 'Heavy Pommel',
        description: '+16% melee attack damage.',
        cost: 1,
        prerequisites: [],
        patch: { damageMul: 0.16 },
      },
      {
        id: 'bran_iron_2',
        branch: 'ironclad',
        tier: 2,
        name: 'Battering Ram',
        description: '+25% Shield Bash damage and +0.4 cone reach.',
        cost: 1,
        prerequisites: ['bran_iron_1'],
        patch: { active0: { damageMul: 0.25, radiusBonus: 0.4 } },
      },
      {
        id: 'bran_iron_3',
        branch: 'ironclad',
        tier: 3,
        name: 'Sweeping Oak',
        description: 'Melee swings cleave a nearby foe for 40% damage and ignore 3 armor.',
        cost: 2,
        prerequisites: ['bran_iron_2'],
        patch: { cleaveBonus: 0.40, armorPierceBonus: 3 },
      },
      {
        id: 'bran_iron_4',
        branch: 'ironclad',
        tier: 4,
        name: 'Bellringer',
        description: '+0.6s Shield Bash stun, −20% Bash cooldown, and +15% attack speed.',
        cost: 2,
        prerequisites: ['bran_iron_3'],
        patch: { attackSpeedMul: 0.15, active0: { durationBonus: 0.6, cooldownMul: -0.20 } },
      },
      {
        id: 'bran_van_1',
        branch: 'vanguard',
        tier: 1,
        name: 'Sturdy Guard',
        description: 'Bulwark reduces blocked enemy damage by 32% more.',
        cost: 1,
        prerequisites: [],
        patch: { passivePowerMul: 0.32 },
      },
      {
        id: 'bran_van_2',
        branch: 'vanguard',
        tier: 2,
        name: 'Tall Standard',
        description: '+1.5s Rally Banner duration and +0.6 aura radius.',
        cost: 1,
        prerequisites: ['bran_van_1'],
        patch: { active1: { durationBonus: 1.5, radiusBonus: 0.6 } },
      },
      {
        id: 'bran_van_3',
        branch: 'vanguard',
        tier: 3,
        name: 'Oath of Steel',
        description: 'Rally Banner grants +15% extra soldier damage and +2 extra armor.',
        cost: 2,
        prerequisites: ['bran_van_2'],
        patch: { active1: { effectBonus: 0.15, armorBonus: 2 } },
      },
      {
        id: 'bran_van_4',
        branch: 'vanguard',
        tier: 4,
        name: 'Evergreen Watch',
        description: 'Bulwark +40% stronger and −20% Rally Banner cooldown.',
        cost: 2,
        prerequisites: ['bran_van_3'],
        patch: { passivePowerMul: 0.40, active1: { cooldownMul: -0.20 } },
      },
      {
        id: 'bran_cap',
        branch: 'capstone',
        tier: 5,
        isCapstone: true,
        name: 'Heart of the Ironoak',
        description: '+20% health & damage; Shield Bash chills foes afterwards and Rally Banner mends nearby allies.',
        cost: 3,
        prerequisites: ['bran_oak_3', 'bran_iron_3', 'bran_van_3'],
        minPrerequisites: 2,
        patch: {
          maxHpMul: 0.20,
          damageMul: 0.20,
          active0: { extras: ['bashSlow'] },
          active1: { extras: ['rallyHeal'] },
        },
      },
    ],
  },

  wren: {
    id: 'wren',
    name: 'Wren Skyfletch',
    title: 'Sky Ranger',
    shortDesc: 'Agile longbow markswoman who punishes flyers with critical arrows and marks priority targets.',
    unlock: { kind: 'islandsCleared', count: 2 },
    baseStats: {
      maxHp: 195,
      armor: 1,
      damage: 22,
      attackSpeed: 1.32,
      range: 5.9,
      moveSpeed: 3.9,
      respawnSec: 12,
      holdCap: 0,
      hitsFlyers: true,
      attackMode: 'ranged',
      projectileStyle: 'archer',
      projectileSpeed: 26,
      splashRadius: 0,
      armorPierce: 2,
      levelGrowth: { hpPerLevel: 0.064, damagePerLevel: 0.084, armorPerLevel: 0.16 },
    },
    passive: {
      id: 'keen_eye',
      kind: 'keenEye',
      name: 'Keen Eye',
      description: 'Arrows have a 35% chance to critically strike flying foes for +75% bonus damage.',
      power: 0.75,
      radius: 0,
      chance: 0.35,
      durationSec: 0,
    },
    actives: [
      {
        id: 'arrow_volley',
        slot: 0,
        kind: 'volley',
        name: 'Volley',
        description: 'Looses a rain of feathered arrows onto a target area, striking ground and flying foes.',
        targetMode: 'point',
        cooldownSec: 13,
        range: 6.5,
        radius: 2.3,
        damage: 62,
        effect: 0,
        durationSec: 0,
        count: 1,
      },
      {
        id: 'hunters_mark',
        slot: 1,
        kind: 'huntersMark',
        name: "Hunter's Mark",
        description: 'Marks a priority enemy near the target point so it takes +25% extra damage from all towers.',
        targetMode: 'point',
        cooldownSec: 14.5,
        range: 6.8,
        radius: 2.2,
        damage: 0,
        effect: 0.25,
        durationSec: 6.0,
        count: 1,
      },
    ],
    branches: [
      { id: 'skybow', index: 0, name: 'Skybow', description: 'Draw speed, range, and armor-piercing bodkins.' },
      { id: 'quiver', index: 1, name: 'Gale Quiver', description: 'Keen Eye criticals and heavier arrow volleys.' },
      { id: 'stalker', index: 2, name: 'Windstalker', description: "Hunter's Mark potency and swift positioning." },
    ],
    skillTree: [
      {
        id: 'wren_bow_1',
        branch: 'skybow',
        tier: 1,
        name: 'Supple Yew',
        description: '+14% attack speed.',
        cost: 1,
        prerequisites: [],
        patch: { attackSpeedMul: 0.14 },
      },
      {
        id: 'wren_bow_2',
        branch: 'skybow',
        tier: 2,
        name: 'Bodkin Tips',
        description: '+0.7 attack range and +2 armor pierce.',
        cost: 1,
        prerequisites: ['wren_bow_1'],
        patch: { rangeBonus: 0.7, armorPierceBonus: 2 },
      },
      {
        id: 'wren_bow_3',
        branch: 'skybow',
        tier: 3,
        name: 'Heavy Draw',
        description: '+20% arrow damage.',
        cost: 2,
        prerequisites: ['wren_bow_2'],
        patch: { damageMul: 0.20 },
      },
      {
        id: 'wren_bow_4',
        branch: 'skybow',
        tier: 4,
        name: 'Blurring String',
        description: '+20% attack speed and +3 armor pierce.',
        cost: 2,
        prerequisites: ['wren_bow_3'],
        patch: { attackSpeedMul: 0.20, armorPierceBonus: 3 },
      },
      {
        id: 'wren_vol_1',
        branch: 'quiver',
        tier: 1,
        name: 'Hawk Sight',
        description: '+15% Keen Eye critical chance.',
        cost: 1,
        prerequisites: [],
        patch: { passiveChanceBonus: 0.15 },
      },
      {
        id: 'wren_vol_2',
        branch: 'quiver',
        tier: 2,
        name: 'Broad Cloud',
        description: '+25% Volley damage and +0.4 area radius.',
        cost: 1,
        prerequisites: ['wren_vol_1'],
        patch: { active0: { damageMul: 0.25, radiusBonus: 0.4 } },
      },
      {
        id: 'wren_vol_3',
        branch: 'quiver',
        tier: 3,
        name: 'Truefeather',
        description: 'Keen Eye +40% crit bonus damage and crits ground foes at half chance.',
        cost: 2,
        prerequisites: ['wren_vol_2'],
        patch: { passivePowerMul: 0.40, passiveExtras: ['groundCrits'] },
      },
      {
        id: 'wren_vol_4',
        branch: 'quiver',
        tier: 4,
        name: 'Pinning Rain',
        description: '−20% Volley cooldown and Volley slows hit foes by 30% for 2s.',
        cost: 2,
        prerequisites: ['wren_vol_3'],
        patch: { active0: { cooldownMul: -0.20, extras: ['volleySlow'] } },
      },
      {
        id: 'wren_mrk_1',
        branch: 'stalker',
        tier: 1,
        name: 'Light Cloak',
        description: '+12% move speed and −15% respawn time.',
        cost: 1,
        prerequisites: [],
        patch: { moveSpeedMul: 0.12, respawnMul: -0.15 },
      },
      {
        id: 'wren_mrk_2',
        branch: 'stalker',
        tier: 2,
        name: 'Lingering Quarry',
        description: "+1.5s Hunter's Mark duration.",
        cost: 1,
        prerequisites: ['wren_mrk_1'],
        patch: { active1: { durationBonus: 1.5 } },
      },
      {
        id: 'wren_mrk_3',
        branch: 'stalker',
        tier: 3,
        name: 'Exposed Seam',
        description: "Hunter's Mark increases damage taken by an extra +15%.",
        cost: 2,
        prerequisites: ['wren_mrk_2'],
        patch: { active1: { effectBonus: 0.15 } },
      },
      {
        id: 'wren_mrk_4',
        branch: 'stalker',
        tier: 4,
        name: 'Pack Spotter',
        description: "Hunter's Mark marks +1 nearby foe and recharges 20% faster.",
        cost: 2,
        prerequisites: ['wren_mrk_3'],
        patch: { active1: { countBonus: 1, cooldownMul: -0.20 } },
      },
      {
        id: 'wren_cap',
        branch: 'capstone',
        tier: 5,
        isCapstone: true,
        name: 'Apex Skyfletcher',
        description: '+20% damage, every 3rd shot looses a twin arrow, and Volley drops a second wave at 45% damage.',
        cost: 3,
        prerequisites: ['wren_bow_3', 'wren_vol_3', 'wren_mrk_3'],
        minPrerequisites: 2,
        patch: {
          damageMul: 0.20,
          passiveExtras: ['twinArrow'],
          active0: { extras: ['doubleVolley'] },
        },
      },
    ],
  },

  mira: {
    id: 'mira',
    name: 'Mira Emberwisp',
    title: 'Ember Mage',
    shortDesc: 'Lantern-staff pyromancer whose splashing embers and dashing flame wisp melt armored packs.',
    unlock: { kind: 'islandsCleared', count: 4 },
    baseStats: {
      maxHp: 180,
      armor: 1,
      damage: 23,
      attackSpeed: 1.04,
      range: 4.9,
      moveSpeed: 3.5,
      respawnSec: 12,
      holdCap: 0,
      hitsFlyers: true,
      attackMode: 'ranged',
      projectileStyle: 'tesla',
      projectileSpeed: 19,
      splashRadius: 0.85,
      armorPierce: 1,
      levelGrowth: { hpPerLevel: 0.065, damagePerLevel: 0.064, armorPerLevel: 0.16 },
    },
    passive: {
      id: 'kindling',
      kind: 'kindling',
      name: 'Kindling',
      description: 'Mira’s hits ignite foes for 2.0s, scorching them with armor-ignoring fire.',
      power: 5.2,
      radius: 0,
      chance: 0,
      durationSec: 2.0,
    },
    actives: [
      {
        id: 'fire_ring',
        slot: 0,
        kind: 'fireRing',
        name: 'Fire Ring',
        description: 'Conjures a burning ring at a point that bursts on arrival and scorches foes inside.',
        targetMode: 'point',
        cooldownSec: 16,
        range: 5.5,
        radius: 1.85,
        damage: 29,
        effect: 10,
        durationSec: 3.2,
        count: 1,
      },
      {
        id: 'wisp_burst',
        slot: 1,
        kind: 'wispBurst',
        name: 'Wisp Burst',
        description: 'Sends her flame wisp dashing along a line, scorching every ground and flying foe in its path.',
        targetMode: 'point',
        cooldownSec: 16.5,
        range: 6.0,
        radius: 4.8,
        damage: 56,
        effect: 0.72,
        durationSec: 0,
        count: 1,
      },
    ],
    branches: [
      { id: 'embercraft', index: 0, name: 'Embercraft', description: 'Hotter Kindling burns and wider ember blasts.' },
      { id: 'hearthring', index: 1, name: 'Hearthring', description: 'Persistent Fire Rings that control choke points.' },
      { id: 'lanternwisp', index: 2, name: 'Lantern Wisp', description: 'Longer, deadlier Wisp Bursts and warded robes.' },
    ],
    skillTree: [
      {
        id: 'mira_emb_1',
        branch: 'embercraft',
        tier: 1,
        name: 'Dry Tinder',
        description: '+30% Kindling burn DPS.',
        cost: 1,
        prerequisites: [],
        patch: { passivePowerMul: 0.30 },
      },
      {
        id: 'mira_emb_2',
        branch: 'embercraft',
        tier: 2,
        name: 'Glowing Coals',
        description: '+1.0s Kindling duration and +0.25 bolt splash radius.',
        cost: 1,
        prerequisites: ['mira_emb_1'],
        patch: { passiveDurationBonus: 1.0, splashRadiusBonus: 0.25 },
      },
      {
        id: 'mira_emb_3',
        branch: 'embercraft',
        tier: 3,
        name: 'Bellows Breath',
        description: '+18% bolt damage and +15% attack speed.',
        cost: 2,
        prerequisites: ['mira_emb_2'],
        patch: { damageMul: 0.18, attackSpeedMul: 0.15 },
      },
      {
        id: 'mira_emb_4',
        branch: 'embercraft',
        tier: 4,
        name: 'White-Hot Cinders',
        description: '+45% Kindling burn DPS and +3 armor pierce on bolts.',
        cost: 2,
        prerequisites: ['mira_emb_3'],
        patch: { passivePowerMul: 0.45, armorPierceBonus: 3 },
      },
      {
        id: 'mira_rng_1',
        branch: 'hearthring',
        tier: 1,
        name: 'Wider Circle',
        description: '+0.45 Fire Ring radius.',
        cost: 1,
        prerequisites: [],
        patch: { active0: { radiusBonus: 0.45 } },
      },
      {
        id: 'mira_rng_2',
        branch: 'hearthring',
        tier: 2,
        name: 'Searing Rim',
        description: '+25% Fire Ring burst and burn damage.',
        cost: 1,
        prerequisites: ['mira_rng_1'],
        patch: { active0: { damageMul: 0.25 } },
      },
      {
        id: 'mira_rng_3',
        branch: 'hearthring',
        tier: 3,
        name: 'Banked Ash',
        description: '+1.5s Fire Ring duration and −15% cooldown.',
        cost: 2,
        prerequisites: ['mira_rng_2'],
        patch: { active0: { durationBonus: 1.5, cooldownMul: -0.15 } },
      },
      {
        id: 'mira_rng_4',
        branch: 'hearthring',
        tier: 4,
        name: 'Heat Haze',
        description: '+20% Fire Ring damage and slows foes inside by 25%.',
        cost: 2,
        prerequisites: ['mira_rng_3'],
        patch: { active0: { damageMul: 0.20, extras: ['ringSlow'] } },
      },
      {
        id: 'mira_wsp_1',
        branch: 'lanternwisp',
        tier: 1,
        name: 'Ember-Spun Robe',
        description: '+18% max health and −15% respawn time.',
        cost: 1,
        prerequisites: [],
        patch: { maxHpMul: 0.18, respawnMul: -0.15 },
      },
      {
        id: 'mira_wsp_2',
        branch: 'lanternwisp',
        tier: 2,
        name: 'Comet Streak',
        description: '+25% Wisp Burst damage and +1.0 dash length.',
        cost: 1,
        prerequisites: ['mira_wsp_1'],
        patch: { active1: { damageMul: 0.25, radiusBonus: 1.0 } },
      },
      {
        id: 'mira_wsp_3',
        branch: 'lanternwisp',
        tier: 3,
        name: 'Bright Lantern',
        description: '+0.7 attack range and −20% Wisp Burst cooldown.',
        cost: 2,
        prerequisites: ['mira_wsp_2'],
        patch: { rangeBonus: 0.7, active1: { cooldownMul: -0.20 } },
      },
      {
        id: 'mira_wsp_4',
        branch: 'lanternwisp',
        tier: 4,
        name: 'Flare Surge',
        description: '+30% Wisp Burst damage and shatters enemy barriers before dealing damage.',
        cost: 2,
        prerequisites: ['mira_wsp_3'],
        patch: { active1: { damageMul: 0.30, extras: ['shatterShields'] } },
      },
      {
        id: 'mira_cap',
        branch: 'capstone',
        tier: 5,
        isCapstone: true,
        name: 'Wildfire Sun',
        description: '+25% bolt & Kindling damage, and Wisp Burst leaves a blazing Fire Ring where its dash ends.',
        cost: 3,
        prerequisites: ['mira_emb_3', 'mira_rng_3', 'mira_wsp_3'],
        minPrerequisites: 2,
        patch: {
          damageMul: 0.25,
          passivePowerMul: 0.25,
          active1: { extras: ['wispFireRing'] },
        },
      },
    ],
  },

  tobb: {
    id: 'tobb',
    name: 'Tobb Gearwright',
    title: 'Master Tinkerer',
    shortDesc: 'Cheerful brass-pack engineer who tunes nearby towers, builds auto-gizmos, and overhauls jammed guns.',
    unlock: { kind: 'islandsCleared', count: 7 },
    baseStats: {
      maxHp: 235,
      armor: 2,
      damage: 18,
      attackSpeed: 0.98,
      range: 4.5,
      moveSpeed: 3.4,
      respawnSec: 13,
      holdCap: 0,
      hitsFlyers: true,
      attackMode: 'ranged',
      projectileStyle: 'ballista',
      projectileSpeed: 28,
      splashRadius: 0,
      armorPierce: 2,
      levelGrowth: { hpPerLevel: 0.068, damagePerLevel: 0.083, armorPerLevel: 0.17 },
    },
    passive: {
      id: 'tinker',
      kind: 'tinker',
      name: 'Tinker',
      description: 'Towers standing near Tobb attack 10% faster.',
      power: 0.10,
      radius: 3.6,
      chance: 0,
      durationSec: 0,
    },
    actives: [
      {
        id: 'deploy_gizmo',
        slot: 0,
        kind: 'deployGizmo',
        name: 'Deploy Gizmo',
        description: 'Sets down a temporary brass auto-turret that fires rapid rivets at ground and flying foes.',
        targetMode: 'point',
        cooldownSec: 17.5,
        range: 4.0,
        radius: 4.3,
        damage: 12,
        effect: 1.45,
        durationSec: 8.5,
        count: 1,
      },
      {
        id: 'overhaul',
        slot: 1,
        kind: 'overhaul',
        name: 'Overhaul',
        description: 'Cleanses stun, instantly reloads, and surges a nearby tower’s fire rate by +40% for 5s.',
        targetMode: 'point',
        cooldownSec: 15.5,
        range: 5.5,
        radius: 2.5,
        damage: 0,
        effect: 0.40,
        durationSec: 5.0,
        count: 1,
      },
    ],
    branches: [
      { id: 'clockwork', index: 0, name: 'Clockwork', description: 'Tinker aura reach, tower tuning, and heavy rivets.' },
      { id: 'automata', index: 1, name: 'Automata', description: 'Longer-lasting, harder-hitting Gizmo turrets.' },
      { id: 'wrenchworks', index: 2, name: 'Wrenchworks', description: 'Overhaul power and sturdy brass plating.' },
    ],
    skillTree: [
      {
        id: 'tobb_clk_1',
        branch: 'clockwork',
        tier: 1,
        name: 'Long Crane',
        description: '+0.6 Tinker aura radius.',
        cost: 1,
        prerequisites: [],
        patch: { passiveRadiusBonus: 0.6 },
      },
      {
        id: 'tobb_clk_2',
        branch: 'clockwork',
        tier: 2,
        name: 'Oiled Gears',
        description: 'Tinker increases nearby tower fire rate by 35% more.',
        cost: 1,
        prerequisites: ['tobb_clk_1'],
        patch: { passivePowerMul: 0.35 },
      },
      {
        id: 'tobb_clk_3',
        branch: 'clockwork',
        tier: 3,
        name: 'Steel Rivets',
        description: '+20% rivet damage and +3 armor pierce.',
        cost: 2,
        prerequisites: ['tobb_clk_2'],
        patch: { damageMul: 0.20, armorPierceBonus: 3 },
      },
      {
        id: 'tobb_clk_4',
        branch: 'clockwork',
        tier: 4,
        name: 'Sighting Lenses',
        description: 'Tinker also grants +8% range to nearby towers and +25% stronger rate bonus.',
        cost: 2,
        prerequisites: ['tobb_clk_3'],
        patch: { passivePowerMul: 0.25, passiveExtras: ['tinkerRange'] },
      },
      {
        id: 'tobb_giz_1',
        branch: 'automata',
        tier: 1,
        name: 'Wound Mainspring',
        description: '+2.5s Deploy Gizmo duration.',
        cost: 1,
        prerequisites: [],
        patch: { active0: { durationBonus: 2.5 } },
      },
      {
        id: 'tobb_giz_2',
        branch: 'automata',
        tier: 2,
        name: 'Rifled Barrel',
        description: '+25% Gizmo damage and +0.5 Gizmo firing range.',
        cost: 1,
        prerequisites: ['tobb_giz_1'],
        patch: { active0: { damageMul: 0.25, radiusBonus: 0.5 } },
      },
      {
        id: 'tobb_giz_3',
        branch: 'automata',
        tier: 3,
        name: 'Double Ratchet',
        description: '−20% Deploy Gizmo cooldown and +0.4 shots/s.',
        cost: 2,
        prerequisites: ['tobb_giz_2'],
        patch: { active0: { cooldownMul: -0.20, effectBonus: 0.4 } },
      },
      {
        id: 'tobb_giz_4',
        branch: 'automata',
        tier: 4,
        name: 'Powder Caps',
        description: '+30% Gizmo damage and Gizmo shots burst in a small splash.',
        cost: 2,
        prerequisites: ['tobb_giz_3'],
        patch: { active0: { damageMul: 0.30, extras: ['gizmoSplash'] } },
      },
      {
        id: 'tobb_ovh_1',
        branch: 'wrenchworks',
        tier: 1,
        name: 'Boiler Apron',
        description: '+20% max health and +2 armor.',
        cost: 1,
        prerequisites: [],
        patch: { maxHpMul: 0.20, armorBonus: 2 },
      },
      {
        id: 'tobb_ovh_2',
        branch: 'wrenchworks',
        tier: 2,
        name: 'Spare Pins',
        description: '+2.0s Overhaul duration.',
        cost: 1,
        prerequisites: ['tobb_ovh_1'],
        patch: { active1: { durationBonus: 2.0 } },
      },
      {
        id: 'tobb_ovh_3',
        branch: 'wrenchworks',
        tier: 3,
        name: 'High Pressure',
        description: '+25% extra Overhaul fire-rate boost and −18% Overhaul cooldown.',
        cost: 2,
        prerequisites: ['tobb_ovh_2'],
        patch: { active1: { effectBonus: 0.25, cooldownMul: -0.18 } },
      },
      {
        id: 'tobb_ovh_4',
        branch: 'wrenchworks',
        tier: 4,
        name: 'Crew Chief',
        description: 'Overhaul tunes +1 neighboring tower as well and grants Tobb +18% attack speed.',
        cost: 2,
        prerequisites: ['tobb_ovh_3'],
        patch: { attackSpeedMul: 0.18, active1: { countBonus: 1 } },
      },
      {
        id: 'tobb_cap',
        branch: 'capstone',
        tier: 5,
        isCapstone: true,
        name: 'Grand Contraption',
        description: 'Allows 2 active Gizmos at once, +20% Tobb & Gizmo damage, and Overhaul supercharges active Gizmos.',
        cost: 3,
        prerequisites: ['tobb_clk_3', 'tobb_giz_3', 'tobb_ovh_3'],
        minPrerequisites: 2,
        patch: {
          damageMul: 0.20,
          active0: { countBonus: 1, damageMul: 0.20 },
          active1: { extras: ['overhaulGizmos'] },
        },
      },
    ],
  },

  sela: {
    id: 'sela',
    name: 'Sela Tidecaller',
    title: 'Storm Priestess',
    shortDesc: 'Serene tide-and-thunder caster who mends militia soldiers, slows waves, and arcs chain lightning.',
    unlock: { kind: 'islandsCleared', count: 10 },
    baseStats: {
      maxHp: 210,
      armor: 2,
      damage: 18,
      attackSpeed: 1.05,
      range: 5.1,
      moveSpeed: 3.5,
      respawnSec: 13,
      holdCap: 0,
      hitsFlyers: true,
      attackMode: 'ranged',
      projectileStyle: 'frost',
      projectileSpeed: 21,
      splashRadius: 0,
      armorPierce: 1,
      levelGrowth: { hpPerLevel: 0.068, damagePerLevel: 0.091, armorPerLevel: 0.16 },
    },
    passive: {
      id: 'calm_waters',
      kind: 'calmWaters',
      name: 'Calm Waters',
      description: 'Restores health to nearby soldiers every second.',
      power: 13,
      radius: 4.0,
      chance: 0,
      durationSec: 0,
    },
    actives: [
      {
        id: 'undertow',
        slot: 0,
        kind: 'undertow',
        name: 'Undertow',
        description: 'Pulls a surging tide across an area, damaging and heavily slowing every foe caught in it.',
        targetMode: 'point',
        cooldownSec: 15,
        range: 5.8,
        radius: 2.6,
        damage: 34,
        effect: 0.40,
        durationSec: 3.5,
        count: 1,
      },
      {
        id: 'thunder_call',
        slot: 1,
        kind: 'thunderCall',
        name: 'Thunder Call',
        description: 'Calls a bolt of storm lightning that chains across up to 3 nearby enemies.',
        targetMode: 'point',
        cooldownSec: 15.8,
        range: 6.0,
        radius: 3.4,
        damage: 62,
        effect: 0.80,
        durationSec: 0,
        count: 3,
      },
    ],
    branches: [
      { id: 'calm', index: 0, name: 'Sanctuary Tide', description: 'Calm Waters healing and protective sea wards.' },
      { id: 'riptide', index: 1, name: 'Riptide', description: 'Undertow control and chilling sea-glass bolts.' },
      { id: 'squall', index: 2, name: 'Squallcaller', description: 'Multi-arc Thunder Calls and storm reach.' },
    ],
    skillTree: [
      {
        id: 'sela_cal_1',
        branch: 'calm',
        tier: 1,
        name: 'Gentle Swell',
        description: '+35% Calm Waters healing.',
        cost: 1,
        prerequisites: [],
        patch: { passivePowerMul: 0.35 },
      },
      {
        id: 'sela_cal_2',
        branch: 'calm',
        tier: 2,
        name: 'Spring Tide',
        description: '+0.8 Calm Waters radius and +18% max health.',
        cost: 1,
        prerequisites: ['sela_cal_1'],
        patch: { passiveRadiusBonus: 0.8, maxHpMul: 0.18 },
      },
      {
        id: 'sela_cal_3',
        branch: 'calm',
        tier: 3,
        name: 'Shell Ward',
        description: 'Soldiers in Calm Waters gain +2 armor, and Sela respawns 15% faster.',
        cost: 2,
        prerequisites: ['sela_cal_2'],
        patch: { respawnMul: -0.15, passiveExtras: ['calmArmor'] },
      },
      {
        id: 'sela_cal_4',
        branch: 'calm',
        tier: 4,
        name: 'Blessed Font',
        description: '+45% Calm Waters healing and +15% attack speed.',
        cost: 2,
        prerequisites: ['sela_cal_3'],
        patch: { passivePowerMul: 0.45, attackSpeedMul: 0.15 },
      },
      {
        id: 'sela_und_1',
        branch: 'riptide',
        tier: 1,
        name: 'Wide Surge',
        description: '+0.5 Undertow radius.',
        cost: 1,
        prerequisites: [],
        patch: { active0: { radiusBonus: 0.5 } },
      },
      {
        id: 'sela_und_2',
        branch: 'riptide',
        tier: 2,
        name: 'Pulling Current',
        description: '+1.2s Undertow slow duration and +30% Undertow damage.',
        cost: 1,
        prerequisites: ['sela_und_1'],
        patch: { active0: { durationBonus: 1.2, damageMul: 0.30 } },
      },
      {
        id: 'sela_und_3',
        branch: 'riptide',
        tier: 3,
        name: 'Rime Spray',
        description: 'Auto-attacks chill targets (22% slow for 1.6s) and deal +18% damage.',
        cost: 2,
        prerequisites: ['sela_und_2'],
        patch: { damageMul: 0.18, passiveExtras: ['chillBolts'] },
      },
      {
        id: 'sela_und_4',
        branch: 'riptide',
        tier: 4,
        name: 'Abyssal Drag',
        description: '+12% Undertow slow strength and −20% Undertow cooldown.',
        cost: 2,
        prerequisites: ['sela_und_3'],
        patch: { active0: { effectBonus: 0.12, cooldownMul: -0.20 } },
      },
      {
        id: 'sela_thn_1',
        branch: 'squall',
        tier: 1,
        name: 'Forked Arc',
        description: 'Thunder Call chains to +1 extra enemy.',
        cost: 1,
        prerequisites: [],
        patch: { active1: { countBonus: 1 } },
      },
      {
        id: 'sela_thn_2',
        branch: 'squall',
        tier: 2,
        name: 'Sky Anvil',
        description: '+25% Thunder Call damage.',
        cost: 1,
        prerequisites: ['sela_thn_1'],
        patch: { active1: { damageMul: 0.25 } },
      },
      {
        id: 'sela_thn_3',
        branch: 'squall',
        tier: 3,
        name: 'Far Horizon',
        description: '+0.7 attack range and −18% Thunder Call cooldown.',
        cost: 2,
        prerequisites: ['sela_thn_2'],
        patch: { rangeBonus: 0.7, active1: { cooldownMul: -0.18 } },
      },
      {
        id: 'sela_thn_4',
        branch: 'squall',
        tier: 4,
        name: 'Tempest Choir',
        description: 'Thunder Call chains +2 extra times and briefly stuns struck ground foes.',
        cost: 2,
        prerequisites: ['sela_thn_3'],
        patch: { active1: { countBonus: 2, extras: ['thunderStun'] } },
      },
      {
        id: 'sela_cap',
        branch: 'capstone',
        tier: 5,
        isCapstone: true,
        name: 'Voice of the Maelstrom',
        description: '+22% damage, Thunder Call hits chilled foes +30% harder, and Undertow burst-heals nearby soldiers.',
        cost: 3,
        prerequisites: ['sela_cal_3', 'sela_und_3', 'sela_thn_3'],
        minPrerequisites: 2,
        patch: {
          damageMul: 0.22,
          active0: { damageMul: 0.22, extras: ['undertowHeal'] },
          active1: { damageMul: 0.22, extras: ['thunderBrittle'] },
        },
      },
    ],
  },
};

export function getHeroDef(id: HeroId): HeroDef {
  return HERO_DEFS[id];
}

export function getHeroSkillNode(heroId: HeroId, nodeId: string): HeroSkillNodeDef | undefined {
  const def = HERO_DEFS[heroId];
  for (let i = 0; i < def.skillTree.length; i++) {
    if (def.skillTree[i].id === nodeId) return def.skillTree[i];
  }
  return undefined;
}

/** Skill points earned at a given hero level (`0` at L1, `+1` per level up to `19` at L20). */
export function heroSkillPointsForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(HERO_MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)));
  return clamped - 1;
}

export const MAX_HERO_SAVE_XP = 1_000_000;

/** Clamps raw XP to `[0, MAX_HERO_SAVE_XP]` integer (`0` for non-numbers / NaN / negatives). */
export function sanitizeHeroXp(val: unknown): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(MAX_HERO_SAVE_XP, Math.floor(val)));
}

/** Hero level (`1..20`) for a total persistent XP count. */
export function heroLevelFromXp(xp: number): number {
  const cleanXp = sanitizeHeroXp(xp);
  let lvl = 1;
  for (let i = 1; i < HERO_LEVEL_XP.length; i++) {
    if (cleanXp >= HERO_LEVEL_XP[i]) lvl = i + 1;
    else break;
  }
  return lvl;
}

/** True when `unlockedSkills` satisfies `node`'s prerequisite rule (`all` or `minPrerequisites`). */
export function areHeroNodePrerequisitesMet(
  node: HeroSkillNodeDef,
  unlockedSkills: readonly string[],
): boolean {
  const needed = node.minPrerequisites ?? node.prerequisites.length;
  if (needed <= 0) return true;
  let count = 0;
  for (let i = 0; i < node.prerequisites.length; i++) {
    if (unlockedSkills.includes(node.prerequisites[i])) count++;
  }
  return count >= needed;
}

/** Total skill points spent across `unlockedSkills` for `heroId`. */
export function countHeroSkillPointsSpent(
  heroId: HeroId,
  unlockedSkills: readonly string[],
): number {
  let spent = 0;
  const seen = new Set<string>();
  for (let i = 0; i < unlockedSkills.length; i++) {
    const id = unlockedSkills[i];
    if (seen.has(id)) continue;
    const node = getHeroSkillNode(heroId, id);
    if (!node) continue;
    seen.add(id);
    spent += node.cost;
  }
  return spent;
}

/**
 * Validates and normalizes a stored skill-node list for `heroId` against `maxSkillPoints`.
 * Unknown or duplicate IDs are dropped; if the remaining set violates prerequisites or exceeds
 * earned skill points (corrupted / edited save), refunds to `[]` while keeping XP intact.
 */
export function sanitizeHeroSkillsForBudget(
  heroId: HeroId,
  rawSkills: unknown,
  maxSkillPoints: number,
): string[] {
  if (!Array.isArray(rawSkills)) return [];
  const candidates: HeroSkillNodeDef[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawSkills.length; i++) {
    const id: unknown = rawSkills[i];
    if (typeof id !== 'string' || seen.has(id)) continue;
    const node = getHeroSkillNode(heroId, id);
    if (!node) continue;
    seen.add(id);
    candidates.push(node);
  }
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => a.tier - b.tier);
  const accepted: string[] = [];
  let costSum = 0;
  for (let i = 0; i < candidates.length; i++) {
    const node = candidates[i];
    if (!areHeroNodePrerequisitesMet(node, accepted)) return [];
    costSum += node.cost;
    if (costSum > maxSkillPoints) return [];
    accepted.push(node.id);
  }
  return accepted;
}

/** Pure unlock check given campaign islands-cleared count and unlock frontier index. */
export function isHeroUnlockedForCounts(
  heroId: HeroId,
  clearedIslandsCount: number,
  unlockedLevelIndex: number,
): boolean {
  if (!isHeroId(heroId)) return false;
  const rule = HERO_DEFS[heroId].unlock;
  if (rule.kind === 'starter') return true;
  return clearedIslandsCount >= rule.count || unlockedLevelIndex >= rule.count;
}

/** Fresh default `HeroSaveData` (`bran` selected, 0 XP and empty skill trees for all 5 heroes). */
export function createFreshHeroSaveData(): HeroSaveData {
  const roster: Partial<Record<HeroId, HeroProgressEntry>> = {};
  for (let i = 0; i < HERO_IDS.length; i++) {
    roster[HERO_IDS[i]] = { xp: 0, skills: [] };
  }
  return { selectedHero: 'bran', roster };
}

/** Platform-independent sanitization of `progress.heroes` (never loses valid XP). */
export function sanitizeHeroSaveData(
  raw: unknown,
  clearedIslandsCount?: number,
  unlockedLevelIndex?: number,
): HeroSaveData {
  const out = createFreshHeroSaveData();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const obj = raw as { selectedHero?: unknown; roster?: unknown };
  const rawRoster =
    obj.roster && typeof obj.roster === 'object' && !Array.isArray(obj.roster)
      ? (obj.roster as Record<string, unknown>)
      : {};

  for (let i = 0; i < HERO_IDS.length; i++) {
    const id = HERO_IDS[i];
    const entryRaw = rawRoster[id];
    if (!entryRaw || typeof entryRaw !== 'object' || Array.isArray(entryRaw)) continue;
    const e = entryRaw as { xp?: unknown; skills?: unknown };
    const xp = sanitizeHeroXp(e.xp);
    const pts = heroSkillPointsForLevel(heroLevelFromXp(xp));
    const skills = sanitizeHeroSkillsForBudget(id, e.skills, pts);
    out.roster[id] = { xp, skills };
  }

  if (isHeroId(obj.selectedHero)) {
    const ok =
      clearedIslandsCount !== undefined && unlockedLevelIndex !== undefined
        ? isHeroUnlockedForCounts(obj.selectedHero, clearedIslandsCount, unlockedLevelIndex)
        : true;
    out.selectedHero = ok ? obj.selectedHero : 'bran';
  }
  return out;
}

/** Sum of persistent XP across all 5 heroes in `heroes`. */
export function totalHeroSaveXp(heroes: HeroSaveData | undefined): number {
  if (!heroes?.roster) return 0;
  let sum = 0;
  for (let i = 0; i < HERO_IDS.length; i++) {
    sum += sanitizeHeroXp(heroes.roster[HERO_IDS[i]]?.xp);
  }
  return sum;
}

/** True when `heroes` contains non-default progress worth backing up. */
export function hasHeroSaveProgress(heroes: HeroSaveData | undefined): boolean {
  if (!heroes) return false;
  if (heroes.selectedHero !== 'bran') return true;
  for (let i = 0; i < HERO_IDS.length; i++) {
    const e = heroes.roster?.[HERO_IDS[i]];
    if (!e) continue;
    if (sanitizeHeroXp(e.xp) > 0 || (Array.isArray(e.skills) && e.skills.length > 0)) return true;
  }
  return false;
}

/**
 * Merges two optional `HeroSaveData` records monotonically and idempotently:
 * per-hero XP takes `Math.max`, skills union when within the merged budget (otherwise keeping the
 * larger valid skill investment), and `selectedHero` prefers an unlocked non-default pick.
 */
export function mergeHeroSaveData(
  a: HeroSaveData | undefined,
  b: HeroSaveData | undefined,
  clearedIslandsCount: number,
  unlockedLevelIndex: number,
): HeroSaveData | undefined {
  if (!a && !b) return undefined;
  const sa = sanitizeHeroSaveData(a, clearedIslandsCount, unlockedLevelIndex);
  const sb = sanitizeHeroSaveData(b, clearedIslandsCount, unlockedLevelIndex);
  const roster: Partial<Record<HeroId, HeroProgressEntry>> = {};

  for (let i = 0; i < HERO_IDS.length; i++) {
    const id = HERO_IDS[i];
    const ea = sa.roster[id] ?? { xp: 0, skills: [] };
    const eb = sb.roster[id] ?? { xp: 0, skills: [] };
    const xp = Math.max(ea.xp, eb.xp);
    const budget = heroSkillPointsForLevel(heroLevelFromXp(xp));
    const sameOrder =
      ea.skills.length === eb.skills.length && ea.skills.every((s, idx) => eb.skills[idx] === s);
    let combined: readonly string[];
    if (sameOrder) {
      combined = ea.skills;
    } else if (eb.skills.length < ea.skills.length && eb.skills.every((s) => ea.skills.includes(s))) {
      combined = ea.skills;
    } else if (ea.skills.length < eb.skills.length && ea.skills.every((s) => eb.skills.includes(s))) {
      combined = eb.skills;
    } else {
      const inEither = new Set<string>([...ea.skills, ...eb.skills]);
      combined = HERO_DEFS[id].skillTree.filter((n) => inEither.has(n.id)).map((n) => n.id);
    }
    const unionSkills = sanitizeHeroSkillsForBudget(id, combined, budget);
    let skills: string[];
    if (unionSkills.length > 0 || (ea.skills.length === 0 && eb.skills.length === 0)) {
      skills = unionSkills;
    } else {
      const va = sanitizeHeroSkillsForBudget(id, ea.skills, budget);
      const vb = sanitizeHeroSkillsForBudget(id, eb.skills, budget);
      const spentA = countHeroSkillPointsSpent(id, va);
      const spentB = countHeroSkillPointsSpent(id, vb);
      skills =
        spentB > spentA || (spentB === spentA && JSON.stringify(vb) > JSON.stringify(va))
          ? vb
          : va;
    }
    roster[id] = { xp, skills };
  }

  let selectedHero: HeroId = 'bran';
  const candA = isHeroUnlockedForCounts(sa.selectedHero, clearedIslandsCount, unlockedLevelIndex)
    ? sa.selectedHero
    : 'bran';
  const candB = isHeroUnlockedForCounts(sb.selectedHero, clearedIslandsCount, unlockedLevelIndex)
    ? sb.selectedHero
    : 'bran';
  if (candA !== 'bran' && candB === 'bran') selectedHero = candA;
  else if (candB !== 'bran' && candA === 'bran') selectedHero = candB;
  else if (candA !== 'bran' && candB !== 'bran') {
    const xpA = totalHeroSaveXp(sa);
    const xpB = totalHeroSaveXp(sb);
    selectedHero =
      xpB > xpA || (xpB === xpA && HERO_IDS.indexOf(candB) > HERO_IDS.indexOf(candA))
        ? candB
        : candA;
  }

  return { selectedHero, roster };
}

/**
 * Canonical 19-point Level-20 skill build for balance reports / QA:
 * Branches `primaryA` & `primaryB` maxed (6 + 6 = 12 pts) + Capstone (3 pts) + remaining branch up to Tier 3 (4 pts) = 19 pts.
 */
export function buildLevel20Specialization(
  heroId: HeroId,
  primaryPair: readonly [0 | 1 | 2, 0 | 1 | 2] = [0, 1],
): readonly string[] {
  const def = HERO_DEFS[heroId];
  const pA = def.branches[primaryPair[0]].id;
  const pB = def.branches[primaryPair[1]].id;
  const out: string[] = [];
  for (const n of def.skillTree) {
    if (n.branch === pA || n.branch === pB) out.push(n.id);
    else if (n.isCapstone) out.push(n.id);
    else if (n.tier <= 3) out.push(n.id);
  }
  return out;
}

export function defaultLevel20Skills(heroId: HeroId): readonly string[] {
  return buildLevel20Specialization(heroId, [0, 1]);
}

/** Canonical valid skill-node list spending up to `level - 1` skill points for QA (`?herolevel=N`) & balance sims. */
export function defaultSkillsForLevel(heroId: HeroId, level: number): readonly string[] {
  const clamped = Math.max(1, Math.min(HERO_MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)));
  if (clamped <= 1) return [];
  const budget = heroSkillPointsForLevel(clamped);
  const full = defaultLevel20Skills(heroId);
  const candidates = full
    .map((id) => getHeroSkillNode(heroId, id)!)
    .filter(Boolean)
    .sort((a, b) => a.tier - b.tier);
  const picked: string[] = [];
  let spent = 0;
  for (const n of candidates) {
    if (spent + n.cost > budget) continue;
    const needed = n.minPrerequisites ?? n.prerequisites.length;
    let have = 0;
    for (const p of n.prerequisites) {
      if (picked.includes(p)) have++;
    }
    if (have >= needed) {
      picked.push(n.id);
      spent += n.cost;
    }
  }
  return picked;
}

function resolveActive(
  base: HeroActiveDef,
  levelScale: number,
  patches: readonly (HeroActivePatch | undefined)[],
): ResolvedHeroActive {
  let damageMul = 0;
  let cooldownMul = 0;
  let radiusBonus = 0;
  let rangeBonus = 0;
  let durationBonus = 0;
  let countBonus = 0;
  let effectBonus = 0;
  let armorBonus = base.armorBonus ?? 0;
  const extras = new Set<HeroActiveExtra>();

  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    if (!p) continue;
    damageMul += p.damageMul ?? 0;
    cooldownMul += p.cooldownMul ?? 0;
    radiusBonus += p.radiusBonus ?? 0;
    rangeBonus += p.rangeBonus ?? 0;
    durationBonus += p.durationBonus ?? 0;
    countBonus += p.countBonus ?? 0;
    effectBonus += p.effectBonus ?? 0;
    armorBonus += p.armorBonus ?? 0;
    if (p.extras) {
      for (let k = 0; k < p.extras.length; k++) extras.add(p.extras[k]);
    }
  }

  const cdScale = Math.max(0.35, 1 + cooldownMul);
  const dmgScale = Math.max(0.1, 1 + damageMul) * levelScale;
  // Secondary effect: flat ratio bonuses add directly; DPS-like effects (Mira Fire Ring) scale with damage.
  const effect =
    base.kind === 'fireRing'
      ? Math.round(base.effect * dmgScale)
      : Math.max(0, base.effect + effectBonus);

  return {
    id: base.id,
    slot: base.slot,
    kind: base.kind,
    targetMode: base.targetMode,
    cooldownSec: Math.max(1.5, Number((base.cooldownSec * cdScale).toFixed(3))),
    range: base.range > 0 ? Math.max(0.5, base.range + rangeBonus) : 0,
    radius: Math.max(0.3, base.radius + radiusBonus),
    damage: base.damage > 0 ? Math.max(1, Math.round(base.damage * dmgScale)) : 0,
    effect,
    durationSec: base.durationSec > 0 || durationBonus > 0 ? Math.max(0, base.durationSec + durationBonus) : 0,
    count: Math.max(1, base.count + countBonus),
    armorBonus,
    extras,
  };
}

/**
 * Pure resolver: combines a hero's base stats, level 1–20 scaling, and unlocked skill-tree patches.
 * Unknown or duplicate node IDs are ignored safely.
 */
export function resolveHeroStats(
  heroId: HeroId,
  level = 1,
  unlockedSkillIds: readonly string[] = [],
): ResolvedHeroStats {
  const def = HERO_DEFS[heroId];
  const clampedLevel = Math.max(1, Math.min(HERO_MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)));
  const lvlSteps = clampedLevel - 1;

  const b = def.baseStats;
  const g = b.levelGrowth;
  const hpLevelMul = 1 + (g?.hpPerLevel ?? HERO_RULES.hpGrowthPerLevel) * lvlSteps;
  const dmgLevelMul = 1 + (g?.damagePerLevel ?? HERO_RULES.damageGrowthPerLevel) * lvlSteps;
  const armorLevelBonus = Math.floor((g?.armorPerLevel ?? HERO_RULES.armorGrowthPerLevel) * lvlSteps);

  let maxHpMul = 0;
  let maxHpBonus = 0;
  let armorBonus = 0;
  let damageMul = 0;
  let attackSpeedMul = 0;
  let rangeBonus = 0;
  let splashRadiusBonus = 0;
  let moveSpeedMul = 0;
  let respawnMul = 0;
  let holdCapBonus = 0;
  let armorPierceBonus = 0;
  let cleaveBonus = 0;
  let passivePowerMul = 0;
  let passiveRadiusBonus = 0;
  let passiveChanceBonus = 0;
  let passiveDurationBonus = 0;
  const passiveExtras = new Set<HeroPassiveExtra>();
  const active0Patches: (HeroActivePatch | undefined)[] = [];
  const active1Patches: (HeroActivePatch | undefined)[] = [];

  const seen = new Set<string>();
  for (let i = 0; i < unlockedSkillIds.length; i++) {
    const id = unlockedSkillIds[i];
    if (seen.has(id)) continue;
    const node = getHeroSkillNode(heroId, id);
    if (!node) continue;
    seen.add(id);
    const p = node.patch;
    maxHpMul += p.maxHpMul ?? 0;
    maxHpBonus += p.maxHpBonus ?? 0;
    armorBonus += p.armorBonus ?? 0;
    damageMul += p.damageMul ?? 0;
    attackSpeedMul += p.attackSpeedMul ?? 0;
    rangeBonus += p.rangeBonus ?? 0;
    splashRadiusBonus += p.splashRadiusBonus ?? 0;
    moveSpeedMul += p.moveSpeedMul ?? 0;
    respawnMul += p.respawnMul ?? 0;
    holdCapBonus += p.holdCapBonus ?? 0;
    armorPierceBonus += p.armorPierceBonus ?? 0;
    cleaveBonus += p.cleaveBonus ?? 0;
    passivePowerMul += p.passivePowerMul ?? 0;
    passiveRadiusBonus += p.passiveRadiusBonus ?? 0;
    passiveChanceBonus += p.passiveChanceBonus ?? 0;
    passiveDurationBonus += p.passiveDurationBonus ?? 0;
    if (p.passiveExtras) {
      for (let k = 0; k < p.passiveExtras.length; k++) passiveExtras.add(p.passiveExtras[k]);
    }
    if (p.active0) active0Patches.push(p.active0);
    if (p.active1) active1Patches.push(p.active1);
  }

  const pas = def.passive;
  const passiveLevelScale =
    pas.kind === 'kindling' ? 1 + 0.025 * lvlSteps : pas.kind === 'calmWaters' ? 1 + 0.035 * lvlSteps : 1;
  const rawPassivePower = pas.power * passiveLevelScale * Math.max(0.1, 1 + passivePowerMul);
  const resolvedPassivePower =
    pas.kind === 'bulwark' ? Math.min(0.65, rawPassivePower) : rawPassivePower;

  return {
    heroId,
    level: clampedLevel,
    maxHp: Math.max(1, Math.round(b.maxHp * hpLevelMul * Math.max(0.2, 1 + maxHpMul) + maxHpBonus)),
    armor: Math.max(0, b.armor + armorLevelBonus + armorBonus),
    damage: Math.max(1, Math.round(b.damage * dmgLevelMul * Math.max(0.2, 1 + damageMul))),
    attackSpeed: Math.max(0.1, Number((b.attackSpeed * Math.max(0.2, 1 + attackSpeedMul)).toFixed(4))),
    range: Math.max(0.5, Number((b.range + rangeBonus).toFixed(3))),
    moveSpeed: Math.max(0.5, Number((b.moveSpeed * Math.max(0.2, 1 + moveSpeedMul)).toFixed(3))),
    respawnSec: Math.max(2.5, Number((b.respawnSec * Math.max(0.35, 1 + respawnMul)).toFixed(3))),
    holdCap: b.holdCap > 0 ? Math.max(1, b.holdCap + holdCapBonus) : Math.max(0, holdCapBonus),
    hitsFlyers: b.hitsFlyers,
    attackMode: b.attackMode,
    projectileStyle: b.projectileStyle ?? 'archer',
    projectileSpeed: b.projectileSpeed ?? 24,
    splashRadius: Math.max(0, (b.splashRadius ?? 0) + splashRadiusBonus),
    armorPierce: Math.max(0, (b.armorPierce ?? 0) + armorPierceBonus),
    cleave: Math.max(0, Math.min(1, (b.cleave ?? 0) + cleaveBonus)),
    passive: {
      kind: pas.kind,
      power: Number(resolvedPassivePower.toFixed(4)),
      radius: pas.radius > 0 ? Math.max(0.5, pas.radius + passiveRadiusBonus) : 0,
      chance: pas.chance > 0 || passiveChanceBonus > 0 ? Math.max(0, Math.min(1, pas.chance + passiveChanceBonus)) : 0,
      durationSec: pas.durationSec > 0 || passiveDurationBonus > 0 ? Math.max(0, pas.durationSec + passiveDurationBonus) : 0,
      extras: passiveExtras,
    },
    actives: [
      resolveActive(def.actives[0], dmgLevelMul, active0Patches),
      resolveActive(def.actives[1], dmgLevelMul, active1Patches),
    ],
  };
}
