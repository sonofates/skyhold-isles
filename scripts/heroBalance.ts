import { EventBus } from '../src/core/eventBus.ts';
import type { HeroId, HeroSkillSlot } from '../src/core/types.ts';
import { BALANCE } from '../src/data/balance.ts';
import {
  defaultLevel20Skills,
  HERO_DEFS,
  HERO_IDS,
  resolveHeroStats,
} from '../src/data/heroes.ts';
import type { LevelDef, ScriptedBuildAction } from '../src/data/levels/index.ts';
import { getLevelById } from '../src/data/levels2d/index.ts';
import { getTowerTierStats } from '../src/data/towers.ts';
import type { EnemyEntity } from '../src/sim/entities.ts';
import { findMergePoint } from '../src/sim/groundGraph.ts';
import { computeStarRating, SimWorld } from '../src/sim/world.ts';

const REPORT_ISLANDS = ['l1c', 'i05', 'i10', 'i16'] as const;

export interface HeroIslandRunSummary {
  readonly levelId: string;
  readonly heroId: HeroId | 'none';
  readonly heroLevel: number;
  readonly scriptKind: 'greedy' | 'weak';
  readonly outcome: 'ongoing' | 'won' | 'lost';
  readonly finalLives: number;
  readonly stars: number;
  readonly wavesReached: number;
  readonly totalWaves: number;
  readonly heroDamage: number;
  readonly heroKills: number;
  readonly skillCasts: readonly [number, number];
  readonly heroDeaths: number;
  readonly heroRunXp: number;
}

function tryExecuteTowerAction(world: SimWorld, act: ScriptedBuildAction): boolean | 'wait' {
  if (act.action === 'build') {
    if (!act.towerType || !world.grid.canPlaceTower(act.col, act.row)) return false;
    const cost = getTowerTierStats(act.towerType, 1).upgradeCost;
    if (world.gold < cost) return 'wait';
    return world.placeTower(act.col, act.row, act.towerType, act.targetingMode ?? 'first') !== null;
  }
  const tid = world.grid.getTowerIdAt(act.col, act.row);
  if (tid === -1) return false;
  const tower = world.getTowerById(tid);
  if (!tower || tower.tier >= 3) return false;
  const nextTier = (tower.tier + 1) as 2 | 3;
  const cost = getTowerTierStats(tower.type, nextTier).upgradeCost;
  if (world.gold < cost) return 'wait';
  return world.upgradeTower(tid);
}

function pickEnemyInReach(world: SimWorld, cx: number, cz: number, range: number, groundOnly: boolean): EnemyEntity | null {
  let best: EnemyEntity | null = null;
  let bestProg = -Infinity;
  const rSq = range * range;
  for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
    const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
    if (!e.active || e.hp <= 0 || e.burrowed) continue;
    if (groundOnly && e.flying) continue;
    if ((e.x - cx) ** 2 + (e.z - cz) ** 2 > rSq) continue;
    const prog = (e.dist + e.laneProgressOffset) / (e.totalDist + e.laneProgressOffset);
    if (prog > bestProg) {
      bestProg = prog;
      best = e;
    }
  }
  return best;
}

/**
 * Simple scripted hero AI:
 * - Walks to the road merge point at run start (and after respawning at the castle).
 * - Casts both active skills on cooldown whenever a valid target / combat trigger is in range.
 */
function driveScriptedHero(world: SimWorld, mergeX: number, mergeZ: number): void {
  const h = world.hero;
  if (!h || h.state === 'dead') return;

  if (h.state !== 'moving' && Math.hypot(h.postX - mergeX, h.postZ - mergeZ) > 0.25) {
    world.commandHeroMove(mergeX, mergeZ);
  }

  const ws = world.waveSystem.state;
  const inWave = ws === 'spawning' || ws === 'allSpawned' || ws === 'clearing';
  if (!inWave) return;

  for (const slot of [0, 1] as readonly HeroSkillSlot[]) {
    if (h.skillCooldowns[slot] > 0) continue;
    const act = h.stats.actives[slot];
    switch (act.kind) {
      case 'rallyBanner': {
        if (pickEnemyInReach(world, h.x, h.z, act.radius + 1.0, true)) {
          world.castHeroSkill(slot, h.x, h.z);
        }
        break;
      }
      case 'shieldBash': {
        const foe = pickEnemyInReach(world, h.x, h.z, act.radius, true);
        if (foe) world.castHeroSkill(slot, foe.x, foe.z);
        break;
      }
      case 'deployGizmo': {
        if (pickEnemyInReach(world, h.x, h.z, act.radius + 2.0, false)) {
          world.castHeroSkill(slot, mergeX + 0.55, mergeZ);
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
        const foe = pickEnemyInReach(world, h.x, h.z, reach, false);
        if (foe) world.castHeroSkill(slot, foe.x, foe.z);
        break;
      }
    }
  }
}

export function runHeroIslandSim(
  level: LevelDef,
  scriptKind: 'greedy' | 'weak',
  heroId: HeroId | 'none',
  heroLevel: number,
): HeroIslandRunSummary {
  const events = new EventBus();
  const skills = heroId !== 'none' && heroLevel >= 20 ? defaultLevel20Skills(heroId) : [];
  const world = new SimWorld(
    level,
    events,
    heroId === 'none'
      ? {}
      : {
          heroId,
          heroLevel,
          heroSkills: skills,
          seed: 1001,
        },
  );

  const casts: [number, number] = [0, 0];
  let deaths = 0;
  let wavesStarted = 0;
  const merge = findMergePoint([world.groundPath, ...world.extraGroundPaths]);

  events.on('waveStarted', () => {
    wavesStarted++;
  });
  events.on('heroSkillCast', (ev) => {
    casts[ev.slot]++;
  });
  events.on('heroDied', () => {
    deaths++;
  });
  events.on('heroRespawn', () => {
    world.commandHeroMove(merge.x, merge.z);
  });

  if (world.hero) {
    world.commandHeroMove(merge.x, merge.z);
  }

  const actions = [...((scriptKind === 'greedy' ? level.scriptedBuildOrder : level.weakBuildOrder) ?? [])];
  const stepBuild = (): boolean => {
    while (actions.length > 0) {
      const r = tryExecuteTowerAction(world, actions[0]);
      if (r === 'wait') return false;
      actions.shift();
      if (r === true) return true;
    }
    return false;
  };

  // Pre-wave 1: walk hero to merge point & spend initial gold just like balanceSim.
  for (let pre = 0; pre < 60 * 12 && world.hero?.state === 'moving'; pre++) {
    world.heroSystem.update(BALANCE.fixedDt, world.towers, 1);
  }
  while (stepBuild()) {
    // spend starting gold
  }
  world.startNextWave();

  const COMBAT_COOLDOWN_SEC = 8.0;
  let combatCooldown = COMBAT_COOLDOWN_SEC;
  let wasBetween = false;
  const maxTicks = 60 * 2600;

  for (let tick = 0; tick < maxTicks && world.outcome === 'ongoing'; tick++) {
    const state = world.waveSystem.state;
    if (state === 'betweenWaves') {
      wasBetween = true;
      while (stepBuild()) {
        // spend between waves
      }
    } else {
      if (wasBetween) {
        combatCooldown = COMBAT_COOLDOWN_SEC;
        wasBetween = false;
      }
      if (combatCooldown > 0) combatCooldown = Math.max(0, combatCooldown - BALANCE.fixedDt);
      if (combatCooldown <= 0 && stepBuild()) combatCooldown = COMBAT_COOLDOWN_SEC;
    }

    driveScriptedHero(world, merge.x, merge.z);
    world.fixedTick(BALANCE.fixedDt);
  }

  const h = world.hero;
  return {
    levelId: level.id,
    heroId,
    heroLevel,
    scriptKind,
    outcome: world.outcome,
    finalLives: world.lives,
    stars: world.outcome === 'won' ? computeStarRating(world.lives, level.difficulty, world.startingLives) : 0,
    wavesReached: wavesStarted,
    totalWaves: level.waves.length,
    heroDamage: h ? Math.round(h.totalDamageDealt) : 0,
    heroKills: h ? h.kills : 0,
    skillCasts: casts,
    heroDeaths: deaths,
    heroRunXp: world.heroSystem.runXp,
  };
}

/**
 * Controlled 60-second combat benchmark on L1c comparing:
 *  - Reference 1: one Tier-2 Barracks (140g)
 *  - Reference 2: two Tier-3 Towers (T3 Archer + T3 Cannon = 500g)
 *  - Each hero solo at Level 1 and Level 20 (with one T1 archer nearby so Tobb/Wren/Bran/Sela support effects register).
 */
function printUnitEquivalenceTable(): void {
  const base = getLevelById('l1c');
  if (!base) return;

  const benchLevel: LevelDef = {
    ...base,
    startingGold: 10000,
    enemyHpScale: 3.5,
    waves: [
      {
        clearBonus: 0,
        groups: [
          { enemyType: 'grunt', count: 30, spawnInterval: 1.2, startDelay: 0, lane: 0, elite: true },
          { enemyType: 'brute', count: 14, spawnInterval: 3.0, startDelay: 1, lane: 1, elite: true },
          { enemyType: 'flyer', count: 16, spawnInterval: 2.2, startDelay: 2, lane: 0, elite: true },
        ],
      },
    ],
  };

  // Pick a plot right beside the L1c merge point.
  const measureWorld = new SimWorld(benchLevel, new EventBus());
  const merge = findMergePoint([measureWorld.groundPath, ...measureWorld.extraGroundPaths]);
  let bestPlot = 0;
  let bestDist = Infinity;
  for (let p = 0; p < measureWorld.grid.plotCount; p++) {
    const px = measureWorld.grid.siteWorldX(p, 0);
    const pz = measureWorld.grid.siteWorldZ(p, 0);
    const d = Math.hypot(px - merge.x, pz - merge.z);
    if (d < bestDist && measureWorld.soldierSystem.hasRoadInRange(px, pz, 3.2)) {
      bestDist = d;
      bestPlot = p;
    }
  }
  let secondPlot = (bestPlot + 1) % measureWorld.grid.plotCount;
  let secondDist = Infinity;
  for (let p = 0; p < measureWorld.grid.plotCount; p++) {
    if (p === bestPlot) continue;
    const px = measureWorld.grid.siteWorldX(p, 0);
    const pz = measureWorld.grid.siteWorldZ(p, 0);
    const d = Math.hypot(px - merge.x, pz - merge.z);
    if (d < secondDist) {
      secondDist = d;
      secondPlot = p;
    }
  }

  const runBench = (setup: (w: SimWorld) => void): { dmg: number; kills: number } => {
    const w = new SimWorld(benchLevel, new EventBus());
    setup(w);
    w.startNextWave();
    for (let t = 0; t < 60 * 55 && w.outcome === 'ongoing'; t++) {
      w.fixedTick(BALANCE.fixedDt);
    }
    let dmg = 0;
    let kills = 0;
    for (const tw of w.towers) {
      dmg += tw.totalDamageDealt;
      kills += tw.kills;
    }
    return { dmg: Math.round(dmg), kills };
  };

  const t2Barracks = runBench((w) => {
    const t = w.placeTowerOnPlot(bestPlot, 'barracks')!;
    w.upgradeTower(t.id);
  });
  const twoT3Towers = runBench((w) => {
    const t1 = w.placeTowerOnPlot(bestPlot, 'archer')!;
    w.upgradeTower(t1.id);
    w.upgradeTower(t1.id);
    const t2 = w.placeTowerOnPlot(secondPlot, 'cannon')!;
    w.upgradeTower(t2.id);
    w.upgradeTower(t2.id);
  });
  const supportBaseline = runBench((w) => {
    w.placeTowerOnPlot(bestPlot, 'archer');
    w.placeTowerOnPlot(secondPlot, 'barracks');
  });

  console.log('=== Unit Power Equivalence Benchmark (55s mixed ground/armored/flyer wave on l1c) ===');
  console.log(`  Ref: 1x Tier-2 Barracks (140g)            -> ${String(t2Barracks.dmg).padStart(5)} dmg | ${String(t2Barracks.kills).padStart(2)} kills`);
  console.log(`  Ref: 2x Tier-3 Towers (Archer+Cannon 500g)-> ${String(twoT3Towers.dmg).padStart(5)} dmg | ${String(twoT3Towers.kills).padStart(2)} kills`);
  console.log('');
  console.log('  Hero     | L1 Stats (HP/Arm/DPS) | L1 Marginal Dmg | L20 Stats (HP/Arm/DPS) | L20 Marginal Dmg');
  console.log('  ---------+-----------------------+-----------------+------------------------+-----------------');

  for (const id of HERO_IDS) {
    const runHeroBench = (lvl: number): number => {
      const skills = lvl >= 20 ? defaultLevel20Skills(id) : [];
      const w = new SimWorld(benchLevel, new EventBus(), { heroId: id, heroLevel: lvl, heroSkills: skills, seed: 77 });
      w.placeTowerOnPlot(bestPlot, 'archer');
      w.placeTowerOnPlot(secondPlot, 'barracks');
      w.commandHeroMove(merge.x, merge.z);
      for (let pre = 0; pre < 60 * 10 && w.hero?.state === 'moving'; pre++) {
        w.heroSystem.update(BALANCE.fixedDt, w.towers, 1);
      }
      w.startNextWave();
      for (let t = 0; t < 60 * 55 && w.outcome === 'ongoing'; t++) {
        driveScriptedHero(w, merge.x, merge.z);
        w.fixedTick(BALANCE.fixedDt);
      }
      let total = w.hero ? w.hero.totalDamageDealt : 0;
      for (const tw of w.towers) total += tw.totalDamageDealt;
      return Math.round(total - supportBaseline.dmg);
    };

    const s1 = resolveHeroStats(id, 1, []);
    const s20 = resolveHeroStats(id, 20, defaultLevel20Skills(id));
    const dps1 = (s1.damage * s1.attackSpeed).toFixed(0);
    const dps20 = (s20.damage * s20.attackSpeed).toFixed(0);
    const m1 = runHeroBench(1);
    const m20 = runHeroBench(20);
    console.log(
      `  ${id.padEnd(8)} | ${String(s1.maxHp).padStart(4)}/${String(s1.armor).padStart(2)}/${dps1.padStart(3)} dps       | ` +
        `${String(m1).padStart(11)} dmg | ${String(s20.maxHp).padStart(4)}/${String(s20.armor).padStart(2)}/${dps20.padStart(3)} dps        | ` +
        `${String(m20).padStart(12)} dmg`,
    );
  }
  console.log('');
}

function fmtOutcome(r: HeroIslandRunSummary): string {
  const wl = r.outcome === 'won' ? 'W' : 'L';
  return `${wl} ${String(r.finalLives).padStart(2)}L ${r.stars}* (w${String(r.wavesReached).padStart(2)}/${r.totalWaves})`;
}

function main(): void {
  console.log('=== Skyhold Isles Hero Balance Report (Informational) ===\n');
  printUnitEquivalenceTable();

  for (const levelId of REPORT_ISLANDS) {
    const level = getLevelById(levelId);
    if (!level) {
      console.error(`Missing level: ${levelId}`);
      continue;
    }
    const baseGreedy = runHeroIslandSim(level, 'greedy', 'none', 1);
    const baseWeak = runHeroIslandSim(level, 'weak', 'none', 1);

    console.log(`=== Island ${level.id} — ${level.name} (${level.difficulty}, ${level.waves.length} waves) ===`);
    console.log(
      `  Baseline (no hero):  greedy ${fmtOutcome(baseGreedy)}  |  weak ${fmtOutcome(baseWeak)}`,
    );
    console.log(
      '  Hero               | Lv | Greedy Result      | Weak Result        | HeroDmg (G / W)     | Kills (G/W) | Casts G    | Deaths G/W | XP G',
    );
    console.log(
      '  -------------------+----+--------------------+--------------------+---------------------+-------------+------------+------------+------',
    );

    for (const heroId of HERO_IDS) {
      const def = HERO_DEFS[heroId];
      for (const heroLevel of [1, 20] as const) {
        const g = runHeroIslandSim(level, 'greedy', heroId, heroLevel);
        const w = runHeroIslandSim(level, 'weak', heroId, heroLevel);
        const casts = `${g.skillCasts[0]}+${g.skillCasts[1]}`;
        console.log(
          `  ${def.name.padEnd(18)} | ${String(heroLevel).padStart(2)} | ${fmtOutcome(g).padEnd(18)} | ${fmtOutcome(w).padEnd(18)} | ` +
            `${String(g.heroDamage).padStart(7)} / ${String(w.heroDamage).padStart(7)} | ` +
            `${String(g.heroKills).padStart(4)} / ${String(w.heroKills).padStart(4)} | ` +
            `${casts.padStart(10)} | ${String(g.heroDeaths).padStart(4)} / ${String(w.heroDeaths).padStart(3)} | ` +
            `${String(g.heroRunXp).padStart(5)}`,
        );
      }
    }
    console.log('');
  }
}

if (process.argv[1]?.endsWith('heroBalance.ts')) main();
