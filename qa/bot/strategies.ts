import type { HeroId, HeroSkillSlot, TowerType, Vec3 } from '../../src/core/types.ts';
import {
  CHALLENGE_IDS_2D,
  challengesForLevel,
  runModifiersFor,
  type ChallengeId,
} from '../../src/data/challenges.ts';
import { dailyChallengeFor } from '../../src/data/daily.ts';
import {
  defaultLevel20Skills,
  HERO_DEFS,
  HERO_IDS,
  heroSkillPointsForLevel,
} from '../../src/data/heroes.ts';
import type { LevelDef, ScriptedBuildAction } from '../../src/data/levels/index.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { NEUTRAL_RUN_MODIFIERS, type RunModifiers } from '../../src/data/runModifiers.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import { maxedWorkshopRanks, workshopModifiers } from '../../src/data/workshop.ts';
import type { EnemyEntity } from '../../src/sim/entities.ts';
import { findMergePoint } from '../../src/sim/groundGraph.ts';
import type { SimWorld } from '../../src/sim/world.ts';

export type StrategyFamily =
  | 'greedy'
  | 'weak'
  | 'hero'
  | 'abilities'
  | 'challenge'
  | 'daily'
  | 'endless';

export type HeroParkMode = 'castle' | 'merge' | 'front' | 'altLane' | 'roam';

export const HERO_PARK_MODES: readonly HeroParkMode[] = [
  'merge',
  'front',
  'altLane',
  'castle',
  'roam',
];

export interface BotScenario {
  readonly id: string;
  readonly family: StrategyFamily;
  readonly level: LevelDef;
  readonly buildKind: 'greedy' | 'weak';
  readonly modifiers: RunModifiers;
  readonly heroId: HeroId | null;
  readonly heroLevel: number;
  readonly heroSkills: readonly string[];
  readonly heroPark: HeroParkMode;
  readonly useAbilities: boolean;
  readonly endlessWaves: number;
  readonly startEndlessFromWave1?: boolean;
  readonly exerciseSellAndRally?: boolean;
  readonly seed: number;
  /** Verify replay determinism by running the scenario twice from scratch and comparing state hashes. */
  readonly verifyDeterminism?: boolean;
}

const _sample: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Deterministic topological skill-point spender for any hero level `1..20`:
 * - Level 1: `[]` (0 pts)
 * - Level 10: Branch 0 T1..T4 (6 pts) + Branch 1 T1..T2 (2 pts) + Branch 2 T1 (1 pt) = 9 pts
 * - Level 20: `defaultLevel20Skills` (19 pts)
 */
export function canonicalSkillsForLevel(heroId: HeroId, level: number): readonly string[] {
  if (level <= 1) return [];
  if (level >= 20) return defaultLevel20Skills(heroId);
  const budget = heroSkillPointsForLevel(level);
  const def = HERO_DEFS[heroId];
  const order = [...def.skillTree].sort((a, b) => a.tier - b.tier);
  const picked: string[] = [];
  let spent = 0;
  for (const n of order) {
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

/** Resolves a world-space hero guard post for `parkMode` on `world`. */
export function computeHeroPost(
  world: SimWorld,
  parkMode: Exclude<HeroParkMode, 'roam'>,
): { x: number; z: number } {
  const paths = [world.groundPath, ...world.extraGroundPaths];
  switch (parkMode) {
    case 'castle': {
      const sp = world.heroSystem.groundGraph.castleSpawnPoint();
      return { x: sp.x, z: sp.z };
    }
    case 'merge': {
      return findMergePoint(paths);
    }
    case 'front': {
      const p0 = paths[0];
      const yaw = p0.sample(p0.totalLength * 0.28, _sample);
      const nx = Math.cos(yaw) * 0.65;
      const nz = -Math.sin(yaw) * 0.65;
      const clamped = world.heroSystem.groundGraph.clampToGround(_sample.x + nx, _sample.z + nz);
      return { x: clamped.x, z: clamped.z };
    }
    case 'altLane': {
      const lane = paths.length > 1 ? paths[1] : paths[0];
      const frac = paths.length > 1 ? 0.36 : 0.74;
      const yaw = lane.sample(lane.totalLength * frac, _sample);
      const nx = -Math.cos(yaw) * 0.65;
      const nz = Math.sin(yaw) * 0.65;
      const clamped = world.heroSystem.groundGraph.clampToGround(_sample.x + nx, _sample.z + nz);
      return { x: clamped.x, z: clamped.z };
    }
  }
}

const FALLBACK_TOWER_ORDER: readonly TowerType[] = [
  'archer',
  'ballista',
  'tesla',
  'cannon',
  'frost',
  'mortar',
  'barracks',
];

function pickAllowedTower(world: SimWorld, preferred: TowerType, col: number, row: number): TowerType | null {
  if (!world.isTowerBanned(preferred)) {
    if (preferred !== 'barracks') return preferred;
    const x = world.grid.siteWorldX(col, row);
    const z = world.grid.siteWorldZ(col, row);
    if (world.soldierSystem.hasRoadInRange(x, z, getTowerTierStats('barracks', 1).range)) {
      return preferred;
    }
  }
  for (let i = 0; i < FALLBACK_TOWER_ORDER.length; i++) {
    const cand = FALLBACK_TOWER_ORDER[i];
    if (world.isTowerBanned(cand)) continue;
    if (cand === 'barracks') {
      const x = world.grid.siteWorldX(col, row);
      const z = world.grid.siteWorldZ(col, row);
      if (!world.soldierSystem.hasRoadInRange(x, z, getTowerTierStats('barracks', 1).range)) continue;
    }
    return cand;
  }
  return null;
}

export function tryStepScriptBuild(world: SimWorld, act: ScriptedBuildAction): 'done' | 'wait' | 'skip' {
  if (act.action === 'build') {
    if (!act.towerType || !world.grid.canPlaceTower(act.col, act.row)) return 'skip';
    const chosen = pickAllowedTower(world, act.towerType, act.col, act.row);
    if (!chosen) return 'skip';
    const cost = getTowerTierStats(chosen, 1).upgradeCost;
    if (world.gold < cost) return 'wait';
    return world.placeTower(act.col, act.row, chosen, act.targetingMode ?? 'first') ? 'done' : 'skip';
  }

  const tid = world.grid.getTowerIdAt(act.col, act.row);
  if (tid === -1) return 'skip';
  const tower = world.getTowerById(tid);
  if (!tower || tower.tier >= 3) return 'skip';
  const nextTier = (tower.tier + 1) as 2 | 3;
  const cost = getTowerTierStats(tower.type, nextTier).upgradeCost;
  if (world.gold < cost) return 'wait';
  return world.upgradeTower(tid) ? 'done' : 'skip';
}

export function spendLeftoverEndlessGold(world: SimWorld): void {
  for (let guard = 0; guard < 24; guard++) {
    let best: { id: number; cost: number } | null = null;
    for (let i = 0; i < world.towers.length; i++) {
      const t = world.towers[i];
      if (t.tier >= 3 || t.type === 'beacon') continue;
      const cost = getTowerTierStats(t.type, (t.tier + 1) as 2 | 3).upgradeCost;
      if (!best || cost < best.cost) best = { id: t.id, cost };
    }
    if (best && world.gold >= best.cost) {
      world.upgradeTower(best.id);
      continue;
    }
    if (best) return;

    if (world.grid.isPlotMode) {
      let placed = false;
      for (let p = 0; p < world.grid.plotCount && !placed; p++) {
        if (!world.grid.canPlaceTower(p, 0)) continue;
        const preferred: TowerType = (p + world.towers.length) % 3 === 0 ? 'barracks' : p % 2 === 0 ? 'archer' : 'cannon';
        const chosen = pickAllowedTower(world, preferred, p, 0);
        if (!chosen) continue;
        if (world.gold < getTowerTierStats(chosen, 1).upgradeCost) return;
        if (world.placeTowerOnPlot(p, chosen)) placed = true;
      }
      if (!placed) return;
    } else {
      return;
    }
  }
}

function findLeadingEnemy(
  world: SimWorld,
  cx: number,
  cz: number,
  range: number,
  groundOnly: boolean,
): EnemyEntity | null {
  let best: EnemyEntity | null = null;
  let bestProg = -Infinity;
  const rSq = range * range;
  for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
    const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
    if (!e.active || e.hp <= 0 || e.burrowed) continue;
    if (groundOnly && e.flying) continue;
    if ((e.x - cx) ** 2 + (e.z - cz) ** 2 > rSq) continue;
    const prog = (e.dist + e.laneProgressOffset) / (e.totalDist + e.laneProgressOffset);
    if (prog > bestProg || (prog === bestProg && best !== null && e.uid < best.uid)) {
      bestProg = prog;
      best = e;
    }
  }
  return best;
}

export function driveHeroInBot(
  world: SimWorld,
  parkMode: HeroParkMode,
  waveOneBased: number,
): void {
  const h = world.hero;
  if (!h || h.state === 'dead') return;

  const concreteModes: readonly Exclude<HeroParkMode, 'roam'>[] = ['front', 'merge', 'altLane', 'castle'];
  const activePostMode: Exclude<HeroParkMode, 'roam'> =
    parkMode === 'roam'
      ? concreteModes[Math.max(0, waveOneBased - 1) % concreteModes.length]
      : parkMode;
  const targetPost = computeHeroPost(world, activePostMode);

  if (h.state !== 'moving' && Math.hypot(h.postX - targetPost.x, h.postZ - targetPost.z) > 0.25) {
    world.commandHeroMove(targetPost.x, targetPost.z);
  }

  const ws = world.waveSystem.state;
  const inCombat = ws === 'spawning' || ws === 'allSpawned' || ws === 'clearing';
  if (!inCombat) return;

  for (const slot of [0, 1] as readonly HeroSkillSlot[]) {
    if (h.skillCooldowns[slot] > 0) continue;
    const act = h.stats.actives[slot];
    switch (act.kind) {
      case 'rallyBanner': {
        if (findLeadingEnemy(world, h.x, h.z, act.radius + 1.2, true)) {
          world.castHeroSkill(slot, h.x, h.z);
        }
        break;
      }
      case 'shieldBash': {
        const foe = findLeadingEnemy(world, h.x, h.z, act.radius, true);
        if (foe) world.castHeroSkill(slot, foe.x, foe.z);
        break;
      }
      case 'deployGizmo': {
        const foe = findLeadingEnemy(world, h.x, h.z, act.radius + 2.2, false);
        if (foe) {
          // Aim near a nearby plot or road shoulder to stress-test plot collision avoidance!
          const plot = world.grid.plots?.[waveOneBased % Math.max(1, world.grid.plotCount)];
          const aimX = plot && Math.hypot(plot.x - h.x, plot.z - h.z) <= act.range ? plot.x : h.x + 0.6;
          const aimZ = plot && Math.hypot(plot.x - h.x, plot.z - h.z) <= act.range ? plot.z : h.z - 0.5;
          world.castHeroSkill(slot, aimX, aimZ);
        }
        break;
      }
      case 'overhaul': {
        if (world.enemyPool.getActiveCount() > 0 && world.towers.length > 0) {
          world.castHeroSkill(slot, h.x, h.z);
        }
        break;
      }
      default: {
        const reach = Math.max(act.range, h.stats.range);
        const foe = findLeadingEnemy(world, h.x, h.z, reach, false);
        if (foe) world.castHeroSkill(slot, foe.x, foe.z);
        break;
      }
    }
  }
}

export function driveGlobalAbilitiesInBot(world: SimWorld): void {
  if (!world.canUseAbilities()) return;
  const activeCount = world.enemyPool.getActiveCount();
  if (activeCount === 0) return;

  if (world.abilitySystem.canCast('meteor')) {
    const lead = findLeadingEnemy(world, 0, 0, 999, false);
    if (lead) {
      world.castAbility('meteor', lead.x, lead.z);
    }
  }
  if (world.abilitySystem.canCast('overcharge') && world.towers.length > 0) {
    const anyStunned = world.towers.some((t) => t.stunTimer > 0);
    if (anyStunned || activeCount >= 4) {
      world.castAbility('overcharge');
    }
  }
}

export interface ScenarioSuiteOptions {
  readonly quick?: boolean;
  readonly levelFilter?: ReadonlySet<string> | null;
  readonly levels?: readonly LevelDef[];
}

export function buildBotScenarios(opts: ScenarioSuiteOptions = {}): BotScenario[] {
  const allLevels = opts.levels ?? LEVELS_2D;
  const levels = opts.levelFilter
    ? allLevels.filter((l) => opts.levelFilter!.has(l.id) || opts.levelFilter!.has(l.id.toLowerCase()))
    : allLevels;
  const quick = opts.quick === true;

  const scenarios: BotScenario[] = [];
  let seedCounter = 10_000;
  const nextSeed = (): number => {
    seedCounter = (seedCounter + 7919) >>> 0;
    return seedCounter;
  };

  // 1 & 2. Greedy + Weak baselines on every island
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    scenarios.push({
      id: `${level.id}:greedy`,
      family: 'greedy',
      level,
      buildKind: 'greedy',
      modifiers: NEUTRAL_RUN_MODIFIERS,
      heroId: null,
      heroLevel: 1,
      heroSkills: [],
      heroPark: 'merge',
      useAbilities: false,
      endlessWaves: 0,
      seed: nextSeed(),
      verifyDeterminism: i === 0 || i === levels.length - 1,
    });
    scenarios.push({
      id: `${level.id}:weak`,
      family: 'weak',
      level,
      buildKind: 'weak',
      modifiers: NEUTRAL_RUN_MODIFIERS,
      heroId: null,
      heroLevel: 1,
      heroSkills: [],
      heroPark: 'merge',
      useAbilities: false,
      endlessWaves: 0,
      seed: nextSeed(),
    });
  }

  // 3. Global abilities on cooldown + barracks rally / sell-rebuild stress on every island
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    scenarios.push({
      id: `${level.id}:abilities`,
      family: 'abilities',
      level,
      buildKind: 'greedy',
      modifiers: NEUTRAL_RUN_MODIFIERS,
      heroId: null,
      heroLevel: 1,
      heroSkills: [],
      heroPark: 'merge',
      useAbilities: true,
      endlessWaves: 0,
      exerciseSellAndRally: true,
      seed: nextSeed(),
      verifyDeterminism: i === 1,
    });
  }

  // 4. Heroes at levels 1 / 10 / 20 parked at different points + skills on cooldown
  const heroLevels = [1, 10, 20] as const;
  for (let li = 0; li < levels.length; li++) {
    const level = levels[li];
    for (let hi = 0; hi < HERO_IDS.length; hi++) {
      const heroId = HERO_IDS[hi];
      if (quick && (li + hi) % 3 !== 0) continue;
      for (let ki = 0; ki < heroLevels.length; ki++) {
        const heroLevel = heroLevels[ki];
        if (quick && ki === 1 && li % 2 === 1) continue;
        const park = HERO_PARK_MODES[(li + hi * 2 + ki) % HERO_PARK_MODES.length];
        const seed = nextSeed();
        scenarios.push({
          id: `${level.id}:hero:${heroId}:L${heroLevel}:${park}`,
          family: 'hero',
          level,
          buildKind: (li + hi + ki) % 4 === 0 ? 'weak' : 'greedy',
          modifiers: NEUTRAL_RUN_MODIFIERS,
          heroId,
          heroLevel,
          heroSkills: canonicalSkillsForLevel(heroId, heroLevel),
          heroPark: park,
          useAbilities: ki === 2,
          endlessWaves: 0,
          seed,
          verifyDeterminism: li === 0 && ki === 2, // replay all 5 heroes at L20 on first island
        });
      }
    }
  }

  // Ensure every park mode is explicitly exercised on multi-lane l1c / i10 even in quick mode:
  if (!quick && levels.length > 0) {
    const focus = levels.find((l) => l.id === 'i10') ?? levels[0];
    for (let p = 0; p < HERO_PARK_MODES.length; p++) {
      const heroId = HERO_IDS[p % HERO_IDS.length];
      const park = HERO_PARK_MODES[p];
      scenarios.push({
        id: `${focus.id}:hero-park:${heroId}:L10:${park}`,
        family: 'hero',
        level: focus,
        buildKind: 'greedy',
        modifiers: NEUTRAL_RUN_MODIFIERS,
        heroId,
        heroLevel: 10,
        heroSkills: canonicalSkillsForLevel(heroId, 10),
        heroPark: park,
        useAbilities: true,
        endlessWaves: 0,
        seed: nextSeed(),
      });
    }
  }

  // 5. Island challenges (each offered challenge per island + maxed workshop variant)
  const wsMax = workshopModifiers(maxedWorkshopRanks());
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    const offered = challengesForLevel(level);
    for (let c = 0; c < offered.length; c++) {
      if (quick && c > 0) continue;
      const cid: ChallengeId = offered[c];
      const baseMods = c % 2 === 1 ? wsMax : NEUTRAL_RUN_MODIFIERS;
      const heroId = HERO_IDS[(i + c) % HERO_IDS.length];
      scenarios.push({
        id: `${level.id}:challenge:${cid}`,
        family: 'challenge',
        level,
        buildKind: 'greedy',
        modifiers: runModifiersFor(baseMods, [cid]),
        heroId,
        heroLevel: 10,
        heroSkills: canonicalSkillsForLevel(heroId, 10),
        heroPark: HERO_PARK_MODES[(i + c) % HERO_PARK_MODES.length],
        useAbilities: true,
        endlessWaves: 0,
        seed: nextSeed(),
        verifyDeterminism: i === 0 && c === 0,
      });
    }
  }

  // 6. Daily Squall runs across deterministic UTC day numbers
  const dailyCount = quick ? Math.min(4, levels.length) : levels.length;
  const allIndices = levels.map((_, idx) => idx);
  for (let d = 0; d < dailyCount; d++) {
    const day = 20_500 + d * 7;
    const clearedSubset = allIndices.slice(0, Math.max(1, ((d * 3) % levels.length) + 1));
    const daily = dailyChallengeFor(day, clearedSubset, CHALLENGE_IDS_2D);
    if (!daily) continue;
    const level = levels[daily.levelIndex] ?? levels[0];
    const heroId = HERO_IDS[d % HERO_IDS.length];
    scenarios.push({
      id: `${level.id}:daily:d${day}:${daily.challenges.join('+')}`,
      family: 'daily',
      level,
      buildKind: 'greedy',
      modifiers: runModifiersFor(wsMax, daily.challenges),
      heroId,
      heroLevel: 10,
      heroSkills: canonicalSkillsForLevel(heroId, 10),
      heroPark: 'merge',
      useAbilities: true,
      endlessWaves: 0,
      seed: nextSeed(),
      verifyDeterminism: d === 0,
    });
  }

  // 7. Endless 10 waves on every island (+ startEndlessFromWave1 checks)
  for (let i = 0; i < levels.length; i++) {
    if (quick && i % 4 !== 0) continue;
    const level = levels[i];
    const heroId = HERO_IDS[i % HERO_IDS.length];
    const heroLvl = i % 2 === 0 ? 20 : 10;
    scenarios.push({
      id: `${level.id}:endless10:${heroId}:L${heroLvl}`,
      family: 'endless',
      level,
      buildKind: 'greedy',
      modifiers: wsMax,
      heroId,
      heroLevel: heroLvl,
      heroSkills: canonicalSkillsForLevel(heroId, heroLvl),
      heroPark: HERO_PARK_MODES[i % HERO_PARK_MODES.length],
      useAbilities: true,
      endlessWaves: 10,
      seed: nextSeed(),
      verifyDeterminism: i === 0,
    });
  }

  if (levels.length > 0) {
    const startDirectLevels = quick ? [levels[0]] : [levels[0], levels[Math.min(4, levels.length - 1)]];
    for (const lvl of startDirectLevels) {
      scenarios.push({
        id: `${lvl.id}:endlessFromStart`,
        family: 'endless',
        level: lvl,
        buildKind: 'greedy',
        modifiers: wsMax,
        heroId: 'bran',
        heroLevel: 20,
        heroSkills: defaultLevel20Skills('bran'),
        heroPark: 'roam',
        useAbilities: true,
        endlessWaves: 10,
        startEndlessFromWave1: true,
        seed: nextSeed(),
      });
    }
  }

  return scenarios;
}
