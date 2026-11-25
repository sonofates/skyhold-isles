import type { EnemyType, TowerType } from '../../core/types.ts';
import { CHAPTER4_ENEMY_DEFS, CHAPTER_ENEMY_DEFS, type ChapterEnemyType, ELITE_MODIFIERS, ENEMY_DEFS, ENEMY_TYPES } from '../../data/enemies.ts';
import { getTowerTierStats, specializationsFor, type TowerSpecializationDef, TOWER_DEFS, TOWER_TYPES } from '../../data/towers.ts';
import { ELITE_SEEN_ID, enemySeenId, towerSeenId, type SeenId } from '../../platform/contentStorage.ts';

/**
 * Text + derived stats for the codex screen and the first-sighting cards. Pure data (no DOM), so it is
 * unit-tested; icons are looked up by the UI from `icons.ts` using `iconKey`.
 */

export interface EnemyLore {
  /** One line, what it does. */
  blurb: string;
  /** What beats it. */
  counter: string;
  /** Short tags shown as chips. */
  tags: readonly string[];
}

export const ENEMY_LORE: Record<EnemyType | ChapterEnemyType, EnemyLore> = {
  bellrunner: {
    blurb: 'Builds up to a sprint while the road stays clear.',
    counter: CHAPTER_ENEMY_DEFS.bellrunner.counterHint,
    tags: ['Ground', 'Fast'],
  },
  kilnback: {
    blurb: 'Its clay shell chips under steady fire and hardens again when left alone.',
    counter: CHAPTER_ENEMY_DEFS.kilnback.counterHint,
    tags: ['Ground', 'Armored'],
  },
  reedpiper: {
    blurb: 'Plays a short phrase to free nearby ground troops from slows.',
    counter: CHAPTER_ENEMY_DEFS.reedpiper.counterHint,
    tags: ['Ground', 'Support'],
  },
  draftwing: {
    blurb: 'Flies faster in the wake of another moth.',
    counter: CHAPTER_ENEMY_DEFS.draftwing.counterHint,
    tags: ['Air', 'Swarm'],
  },
  rimebeetle: {
    blurb: 'Leaves a 3-second frost patch where it falls. Towers in the patch fire 30% slower.',
    counter: CHAPTER4_ENEMY_DEFS.rimebeetle.counterHint,
    tags: ['Ground', 'Frost'],
  },
  sledguard: {
    blurb: 'An ice shield (40% of its health) takes hits first and refreezes after 4 quiet seconds.',
    counter: CHAPTER4_ENEMY_DEFS.sledguard.counterHint,
    tags: ['Ground', 'Shielded'],
  },
  glacier_warden: {
    blurb: 'At 66% and 33% health it freezes the nearest tower for 4 seconds and wakes three Rime Beetles.',
    counter: CHAPTER4_ENEMY_DEFS.glacier_warden.counterHint,
    tags: ['Ground', 'Boss', 'Armored'],
  },
  grunt: {
    blurb: 'Balanced foot soldier marching the road.',
    counter: 'Anything works. Archers and Cannons deal with them cheaply.',
    tags: ['Ground'],
  },
  runner: {
    blurb: 'Fast, fragile scout that sprints past slow towers.',
    counter: 'Frost slows it; Tesla chains pop whole packs. Slow shells often miss.',
    tags: ['Ground', 'Fast'],
  },
  brute: {
    blurb: 'Armored juggernaut — shrugs off a chunk of every hit.',
    counter: 'Hit it hard, not often: Cannon, Mortar or Ballista (bolts pierce armor). Arrows barely scratch it.',
    tags: ['Ground', 'Armored'],
  },
  flyer: {
    blurb: 'Glides over the terrain on its own aerial lane.',
    counter: 'Only Archer, Frost, Tesla and Ballista can hit it. Press R to see the sky lane.',
    tags: ['Air', 'Fast'],
  },
  healer: {
    blurb: 'Pulses a healing aura that mends nearby allies.',
    counter: 'Kill it first. Tesla chains and Mortar splash reach it inside a crowd; try Strongest targeting.',
    tags: ['Ground', 'Support'],
  },
  splitter: {
    blurb: 'Ember construct that bursts into two hatchlings.',
    counter: 'Splash (Cannon, Mortar) cleans up the hatchlings; Tesla hops between them.',
    tags: ['Ground', 'Splits'],
  },
  warden: {
    blurb: 'Casts shimmering barriers on allies that soak damage first.',
    counter: 'Focus it first. Splash and chain lightning pop many shields at once.',
    tags: ['Ground', 'Support'],
  },
  burrower: {
    blurb: 'Tunnels under the road in bursts — untargetable and faster while down.',
    counter: 'Cover the whole road so something is always in range when it surfaces; splash helps where it resurfaces.',
    tags: ['Ground', 'Evasive'],
  },
  carrier: {
    blurb: 'Lumbering sky barge that drops two raiders when shot down.',
    counter: 'Down it early with Archer or Tesla — a late kill drops raiders next to the sanctuary.',
    tags: ['Air', 'Carrier'],
  },
  blinker: {
    blurb: 'Charges a rift, then blinks forward along the road.',
    counter: 'Frost delays every blink. Burst it down before the jump.',
    tags: ['Ground', 'Teleports'],
  },
  golem: {
    blurb: 'Walking basalt with immense armor.',
    counter: 'Slowing hits crack its shell for 2.6 seconds. Use fast attacks while its armor is down to 3. Ballista bolts pierce armor and incendiary burn bypasses it.',
    tags: ['Ground', 'Armored'],
  },
  mite: {
    blurb: 'Tiny pest that arrives in dense swarms.',
    counter: 'Splash and chain lightning shred swarms; single-target towers waste shots.',
    tags: ['Ground', 'Swarm'],
  },
  hexer: {
    blurb: 'Lantern hexcaster that silences towers near the road.',
    counter: 'Kill it before it reaches your towers. Towers two tiles off the road are out of reach; Overcharge lifts hexes.',
    tags: ['Ground', 'Disables'],
  },
  tempest: {
    blurb: 'Storm titan: raises a Stormwall at 2/3 health, enrages at 1/3.',
    counter: 'Save burst for each phase. Overcharge clears the thunderclap jams; Ballista and Meteor cut through armor.',
    tags: ['Boss', 'Ground'],
  },
  boss: {
    blurb: 'Armored warlord. Calls escorts at half health and jams towers.',
    counter: 'Stack Ballista and Mortar, keep Overcharge ready to unjam, and Meteor it when it bunches with escorts.',
    tags: ['Boss', 'Ground'],
  },
};

export interface TowerLore {
  /** What it is best at. */
  strong: string;
  /** What to watch out for. */
  weak: string;
  tags: readonly string[];
}

export const TOWER_LORE: Record<TowerType, TowerLore> = {
  archer: {
    strong: 'Cheap, fast, and the all-rounder against air and ground.',
    weak: 'Small hits lose a lot to armor (Brutes, Golems).',
    tags: ['Air + Ground', 'Single target'],
  },
  cannon: {
    strong: 'Splash shells flatten packs, splitters and swarms.',
    weak: 'Cannot hit flyers, and shells miss fast runners.',
    tags: ['Ground only', 'Splash'],
  },
  frost: {
    strong: 'Stacking slow makes every other tower better; delays blinks and cracks Golem armor.',
    weak: 'Barely any damage on its own.',
    tags: ['Air + Ground', 'Slow'],
  },
  tesla: {
    strong: 'Chain lightning melts swarms, shielded groups and flyer lanes.',
    weak: 'Short range; thin against single heavy targets.',
    tags: ['Air + Ground', 'Chain'],
  },
  mortar: {
    strong: 'Huge range and splash; Incendiary burn ignores armor.',
    weak: 'Blind spot up close, slow shells, ground only.',
    tags: ['Ground only', 'Long range', 'Splash'],
  },
  ballista: {
    strong: 'Bolts pierce armor and run through lines of enemies — Brutes, Golems and bosses.',
    weak: 'Slow reload; wasted on swarms.',
    tags: ['Air + Ground', 'Armor-piercing'],
  },
  beacon: {
    strong: 'Never shoots, but every tower in its glow fires faster (T3: longer range too).',
    weak: 'Does nothing alone, and boss jams switch it off. Auras do not stack.',
    tags: ['Support', 'Aura'],
  },
  barracks: {
    strong: 'Soldiers block the road: held foes stand still under your towers\' fire.',
    weak: 'Flyers pass over, burrowers dig under, blinkers jump past; swarms and bosses overwhelm a squad.',
    tags: ['Ground only', 'Blocking'],
  },
};

export type SpeedClass = 'slow' | 'steady' | 'quick' | 'swift';

export function speedClass(speed: number): SpeedClass {
  if (speed < 1.6) return 'slow';
  if (speed < 2.4) return 'steady';
  if (speed < 3.3) return 'quick';
  return 'swift';
}

export interface CodexStat {
  readonly label: string;
  readonly value: string;
}

export interface CodexEnemyEntry {
  readonly kind: 'enemy';
  readonly id: EnemyType;
  readonly seenId: SeenId;
  readonly name: string;
  readonly isBoss: boolean;
  readonly flying: boolean;
  readonly description: string;
  readonly blurb: string;
  readonly counter: string;
  readonly tags: readonly string[];
  readonly stats: readonly CodexStat[];
}

export interface CodexTowerEntry {
  readonly kind: 'tower';
  readonly id: TowerType;
  readonly seenId: SeenId;
  readonly name: string;
  readonly hitsFlyers: boolean;
  readonly description: string;
  readonly strong: string;
  readonly weak: string;
  readonly tags: readonly string[];
  readonly stats: readonly CodexStat[];
  readonly signatureName: string;
  readonly signatureDesc: string;
  readonly specializations: readonly TowerSpecializationDef[];
  readonly tiers: readonly { readonly tier: 1 | 2 | 3; readonly cost: number; readonly summary: string }[];
}

export interface CodexEliteEntry {
  readonly kind: 'elite';
  readonly id: 'elite';
  readonly seenId: SeenId;
  readonly name: string;
  readonly description: string;
  readonly blurb: string;
  readonly counter: string;
  readonly tags: readonly string[];
  readonly stats: readonly CodexStat[];
}

export type CodexEntry = CodexEnemyEntry | CodexTowerEntry | CodexEliteEntry;

const pct = (n: number): string => `${Math.round(n * 100)}%`;

export function enemyEntry(type: EnemyType): CodexEnemyEntry {
  const d = ENEMY_DEFS[type];
  const lore = ENEMY_LORE[type];
  const stats: CodexStat[] = [
    { label: 'Health', value: String(d.maxHp) },
    { label: 'Speed', value: speedClass(d.speed) },
    { label: 'Armor', value: d.armor > 0 ? String(d.armor) : 'none' },
    { label: 'Bounty', value: `${d.reward}g` },
    { label: 'Lives', value: String(d.livesCost) },
  ];
  return {
    kind: 'enemy',
    id: type,
    seenId: enemySeenId(type),
    name: d.name,
    isBoss: d.isBoss === true,
    flying: d.flying,
    description: d.description,
    blurb: lore.blurb,
    counter: lore.counter,
    tags: lore.tags,
    stats,
  };
}

export function eliteEntry(): CodexEliteEntry {
  const m = ELITE_MODIFIERS;
  return {
    kind: 'elite',
    id: 'elite',
    seenId: ELITE_SEEN_ID,
    name: 'Empowered Elites',
    description: 'Some waves send Empowered versions of a foe: bigger, tougher and carrying a golden aura.',
    blurb: 'Gilded versions of normal foes with extra health and armor.',
    counter: 'Focus them with your strongest towers (Strongest targeting helps); they pay a bigger bounty.',
    tags: ['Any foe', 'Gold aura'],
    stats: [
      { label: 'Health', value: `×${m.hpMul}` },
      { label: 'Armor', value: `+${m.armorBonus}` },
      { label: 'Bounty', value: `×${m.rewardMul}` },
    ],
  };
}

function tierSummary(type: TowerType, tier: 1 | 2 | 3): string {
  const s = getTowerTierStats(type, tier);
  if (type === 'beacon') {
    const parts = [`+${pct(s.auraRate ?? 0)} fire rate`];
    if (s.auraRange) parts.push(`+${pct(s.auraRange)} range`);
    parts.push(`aura ${s.range}`);
    return parts.join(' · ');
  }
  const parts = [`${s.damage} dmg`, `${s.fireRate}/s`, `range ${s.range}`];
  if (s.splashRadius > 0) parts.push(`splash ${s.splashRadius}`);
  if (s.slowRatio > 0) parts.push(`slow ${pct(s.slowRatio)}`);
  if (s.chainCount > 0) parts.push(`${s.chainCount} jumps`);
  if (s.armorPierce) parts.push(`pierce ${s.armorPierce} armor`);
  return parts.join(' · ');
}

export function towerEntry(type: TowerType): CodexTowerEntry {
  const d = TOWER_DEFS[type];
  const lore = TOWER_LORE[type];
  const t1 = getTowerTierStats(type, 1);
  const stats: CodexStat[] = [
    { label: 'Cost', value: `${t1.upgradeCost}g` },
    { label: 'Targets', value: d.role === 'support' ? 'support' : d.hitsFlyers ? 'air + ground' : 'ground' },
    { label: 'Range', value: String(t1.range) },
    ...(d.role === 'support' ? [] : [{ label: 'Damage', value: String(t1.damage) }]),
  ];
  return {
    kind: 'tower',
    id: type,
    seenId: towerSeenId(type),
    name: d.name,
    hitsFlyers: d.hitsFlyers,
    description: d.shortDesc,
    strong: lore.strong,
    weak: lore.weak,
    tags: lore.tags,
    stats,
    signatureName: d.signature.name,
    signatureDesc: d.signature.desc,
    specializations: specializationsFor(type),
    tiers: ([1, 2, 3] as const).map((tier) => ({
      tier,
      cost: getTowerTierStats(type, tier).upgradeCost,
      summary: tierSummary(type, tier),
    })),
  };
}

export function allEnemyEntries(): CodexEnemyEntry[] {
  return ENEMY_TYPES.map(enemyEntry);
}

export function allTowerEntries(): CodexTowerEntry[] {
  return TOWER_TYPES.map(towerEntry);
}
