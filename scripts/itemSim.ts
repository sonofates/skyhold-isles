/**
 * Headless Market item balance + campaign economy simulator.
 *
 * Usage:
 *   npm run sim:items                        full item balance + economy report & target checks
 *   npm run sim:items -- --normal-belt       only the paired and progressing Normal item probes
 *   npm run sim:items -- --md                Markdown tables for docs/market-balance.md
 *   npm run sim:items -- --levels=l1c,i14    filter islands (keeps full campaign entry progression)
 *   npm run sim:items -- --loadout=a,b,c     override 3-item belt (defaults to top-3 by marginal value/crystal)
 *   npm run sim:items -- --workers=1         single-threaded execution
 */
import os from 'node:os';
import { isMainThread, Worker } from 'node:worker_threads';
import { EventBus } from '../src/core/eventBus.ts';
import { computeMeteorDamage } from '../src/data/abilities.ts';
import { BALANCE } from '../src/data/balance.ts';
import { DIFFICULTIES, DIFFICULTY_IDS, starsAwarded, type DifficultyId } from '../src/data/difficulty.ts';
import { ENEMY_DEFS } from '../src/data/enemies.ts';
import type { LevelDef } from '../src/data/levels/index.ts';
import { LEVELS_2D, registeredChapterIslands } from '../src/data/levels2d/index.ts';
import {
  ITEMS,
  ITEM_IDS,
  MARKET_RULES,
  isItemId,
  heartstoneCeiling,
  type ItemCounts,
  type ItemId,
} from '../src/data/market.ts';
import { combineRunModifiers, type RunModifierPatch } from '../src/data/runModifiers.ts';
import { ENEMY_MELEE } from '../src/data/soldiers.ts';
import { getTowerTierStats, specializationsFor, TOWER_DEFS, towerStats } from '../src/data/towers.ts';
import {
  awardMarketWin,
  buyItem,
  marketWallet,
  sanitizeMarket,
} from '../src/game/market.ts';
import type { EnemyEntity } from '../src/sim/entities.ts';
import { findMergePoint } from '../src/sim/groundGraph.ts';
import { SimWorld } from '../src/sim/world.ts';
import { runLevelBalanceSim, type SimRunResult } from './balanceSim.ts';
import { driveScriptedHero } from './heroBalance.ts';
import { campaignKit, driveGlobalAbilities, type CampaignKit } from './lib/campaignKit.ts';
import { balanceBuildOrder, type BalanceBuildAction } from './lib/specializationBuilds.ts';

type Profile = 'campaign' | 'weak';
const PROFILES: readonly Profile[] = ['campaign', 'weak'];

export interface BaselineWaveInfo {
  readonly waveNumber: number;
  readonly livesLost: number;
  readonly peakGroundProgress: number;
}

export interface ItemRunSpec {
  readonly jobId: number;
  readonly levelIndex: number;
  readonly difficulty: DifficultyId;
  readonly profile: Profile;
  readonly xp: number;
  readonly stars: number;
  readonly belt: ItemCounts;
  readonly baselineOutcome: 'ongoing' | 'won' | 'lost';
  readonly baselineWaves: readonly BaselineWaveInfo[];
}

export interface ItemRunOutcome {
  readonly jobId: number;
  readonly levelId: string;
  readonly difficulty: DifficultyId;
  readonly profile: Profile;
  readonly outcome: 'ongoing' | 'won' | 'lost';
  readonly finalLives: number;
  readonly heroXp: number;
  readonly effectiveLives: number;
  readonly restoredLives: number;
  readonly startingLives: number;
  readonly rawStars: number;
  readonly awardedStars: number;
  readonly wavesReached: number;
  readonly totalWaves: number;
  readonly used: ItemCounts;
  readonly totalCasts: number;
  readonly crystalsSpent: number;
  readonly waves?: readonly BaselineWaveInfo[];
}

function nextActionCost(world: SimWorld, queue: readonly BalanceBuildAction[]): number {
  for (const act of queue) {
    if (act.action === 'build') {
      if (!act.towerType || !world.grid.canPlaceTower(act.col, act.row)) continue;
      return getTowerTierStats(act.towerType, 1).upgradeCost;
    }
    const tid = world.grid.getTowerIdAt(act.col, act.row);
    if (tid === -1) continue;
    const tower = world.getTowerById(tid);
    if (!tower) continue;
    if (act.action === 'specialize' || act.action === 'buyAbility') {
      const branches = specializationsFor(tower);
      const branchId = act.action === 'specialize' ? act.id : tower.specialization?.id;
      const branch = branches.find((b) => b.id === branchId);
      const item = act.action === 'specialize' ? branch : branch?.abilities.find((a) => a.id === act.id);
      if (item) return item.cost;
      continue;
    }
    if (tower.tier < 3) {
      return getTowerTierStats(tower.type, (tower.tier + 1) as 2 | 3).upgradeCost;
    }
  }
  return 0;
}

function tryExecuteBuildAction(world: SimWorld, act: BalanceBuildAction): 'done' | 'wait' | 'invalid' {
  if (act.action === 'build') {
    if (!act.towerType || !world.grid.canPlaceTower(act.col, act.row)) return 'invalid';
    const cost = getTowerTierStats(act.towerType, 1).upgradeCost;
    if (world.gold < cost) return 'wait';
    return world.placeTower(act.col, act.row, act.towerType, act.targetingMode ?? 'first') ? 'done' : 'invalid';
  }
  const tid = world.grid.getTowerIdAt(act.col, act.row);
  if (tid === -1) return 'invalid';
  const tower = world.getTowerById(tid);
  if (!tower) return 'invalid';
  if (act.action === 'specialize' || act.action === 'buyAbility') {
    const branches = specializationsFor(tower);
    const branchId = act.action === 'specialize' ? act.id : tower.specialization?.id;
    const branch = branches.find((b) => b.id === branchId);
    const item = act.action === 'specialize' ? branch : branch?.abilities.find((a) => a.id === act.id);
    if (!item) return 'invalid';
    if (world.gold < item.cost) return 'wait';
    const ok = act.action === 'specialize' ? world.specializeTower(tid, act.id) : world.buyTowerAbility(tid, act.id);
    return ok ? 'done' : 'invalid';
  }
  if (tower.tier >= 3) return 'invalid';
  const cost = getTowerTierStats(tower.type, (tower.tier + 1) as 2 | 3).upgradeCost;
  if (world.gold < cost) return 'wait';
  return world.upgradeTower(tid) ? 'done' : 'invalid';
}

function towerCoverageDps(world: SimWorld, x: number, z: number, flying: boolean): number {
  let dps = 0;
  for (let i = 0; i < world.towers.length; i++) {
    const t = world.towers[i];
    if (t.type === 'barracks' || t.type === 'beacon') continue;
    const def = TOWER_DEFS[t.type];
    if (flying && !def.hitsFlyers) continue;
    const st = towerStats(t);
    const effRange = st.range * (1 + t.auraRange + (t.heroRangeBonus ?? 0));
    const d = Math.hypot(t.x - x, t.z - z);
    if (d <= effRange && d >= st.minRange) {
      dps += st.damage * st.fireRate;
    }
  }
  if (world.hero && world.hero.state !== 'dead' && Math.hypot(world.hero.x - x, world.hero.z - z) <= 3.5) {
    dps += 35;
  }
  return dps;
}

/**
 * Picks the hardest waves from the itemless baseline run so charges are saved for genuine danger
 * waves rather than wasted on early skirmishes that towers already clean up cleanly.
 */
function computeHardWaves(
  totalWaves: number,
  baselineOutcome: 'ongoing' | 'won' | 'lost',
  baselineWaves: readonly BaselineWaveInfo[],
  maxFocusWaves: number,
): ReadonlySet<number> {
  const hard = new Set<number>();
  if (baselineOutcome === 'lost') {
    const lostWave = baselineWaves.length > 0 ? baselineWaves[baselineWaves.length - 1].waveNumber : totalWaves;
    for (let w = Math.max(1, lostWave - 1); w <= totalWaves; w++) hard.add(w);
  }
  const ranked = [...baselineWaves]
    .filter((w) => w.livesLost > 0 || w.peakGroundProgress >= 0.85)
    .sort((a, b) => b.livesLost - a.livesLost || b.peakGroundProgress - a.peakGroundProgress || b.waveNumber - a.waveNumber);
  for (const w of ranked) {
    if (hard.size >= maxFocusWaves && w.livesLost === 0) break;
    hard.add(w.waveNumber);
    if (hard.size >= maxFocusWaves && baselineOutcome === 'won') break;
  }
  return hard;
}

interface PolicyRuntime {
  readonly hardWaves: ReadonlySet<number>;
  readonly purseWaves: ReadonlySet<number>;
  readonly baselineLostEarly: boolean;
  readonly baselineFlawless: boolean;
  lastCastSec: Record<ItemId, number>;
  lastPurseWave: number;
}

function buildPurseSchedule(
  totalWaves: number,
  charges: number,
  baselineOutcome: 'ongoing' | 'won' | 'lost',
  baselineWaves: readonly BaselineWaveInfo[],
): ReadonlySet<number> {
  const out = new Set<number>();
  if (charges <= 0) return out;
  const firstTrouble =
    baselineWaves.find((w) => w.livesLost > 0)?.waveNumber ??
    (baselineOutcome === 'lost' ? baselineWaves.length : Math.max(2, Math.floor(totalWaves * 0.6)));
  if (charges === 1) {
    out.add(Math.max(1, Math.min(totalWaves - 1, firstTrouble - 1)));
    return out;
  }
  const anchors = [
    Math.max(1, Math.min(firstTrouble - 1, Math.floor(totalWaves * 0.25))),
    Math.max(2, Math.min(firstTrouble, Math.floor(totalWaves * 0.5))),
    Math.max(3, Math.min(totalWaves - 1, Math.max(firstTrouble, Math.floor(totalWaves * 0.72)))),
  ];
  for (const w of anchors) {
    if (out.size >= charges) break;
    out.add(Math.max(1, Math.min(totalWaves, w)));
  }
  for (let w = 1; out.size < charges && w <= totalWaves; w++) out.add(w);
  return out;
}

function enemyProgress(e: EnemyEntity): number {
  return e.totalDist > 0 ? e.dist / e.totalDist : 0;
}

function driveItems(
  world: SimWorld,
  rt: PolicyRuntime,
  queue: readonly BalanceBuildAction[],
): boolean {
  const belt = world.itemSystem.belt();
  const now = world.elapsedSimSec;
  const wave = Math.max(1, world.waveSystem.currentWaveOneBased);
  const totalWaves = world.level.waves.length;
  const ws = world.waveSystem.state;
  const isHardWave = rt.hardWaves.has(wave);
  let castPurse = false;

  // 1. Heartstone: restore lost lives when full heal value is reached, or in lethal danger.
  if ((belt.heartstone ?? 0) > 0 && world.lives < world.startingLives) {
    const missing = heartstoneCeiling(world.startingLives, world.mods.marketDifficulty) - world.lives;
    const urgent = world.lives <= 6 || (wave === totalWaves && world.lives <= 12);
    if (missing >= ITEMS.heartstone.lives || urgent) {
      world.useItem('heartstone');
    }
  }

  // 2. Sky Purse: convert into tower tempo before/at tough waves while build steps still wait on gold
  //    (skip spending consumables on islands the player already clears flawlessly without items).
  if (!rt.baselineFlawless && (belt.skyPurse ?? 0) > 0 && queue.length > 0 && rt.lastPurseWave !== wave) {
    const needed = nextActionCost(world, queue);
    const starvedStart = wave === 1 && (world.gold < needed && (world.towers.length === 0 || rt.baselineLostEarly));
    const scheduled = rt.purseWaves.has(wave) && (ws === 'betweenWaves' || world.gold < needed);
    const lateFlush = wave >= totalWaves - 2 && world.gold < needed;
    if (starvedStart || scheduled || lateFlush) {
      if (world.useItem('skyPurse')) {
        rt.lastPurseWave = wave;
        rt.lastCastSec.skyPurse = now;
        castPurse = true;
      }
    }
  }

  if (ws === 'betweenWaves' || ws === 'preFirstWave') return castPurse;

  const pool = world.enemyPool;
  const count = pool.getActiveCount();
  if (count === 0) return castPurse;

  let maxProg = 0;
  let maxUnheldGround: EnemyEntity | null = null;
  let maxUnheldGroundProg = 0;
  let unheldGroundThreats = 0;
  let imminentLeakers = 0;
  for (let i = 0; i < count; i++) {
    const e = pool.items[pool.getActiveIndex(i)];
    if (!e.active || e.hp <= 0) continue;
    const prog = enemyProgress(e);
    if (prog > maxProg) maxProg = prog;
    const held = !e.flying && !e.burrowed && e.blockers + e.heroBlockers >= ENEMY_MELEE[e.type].holdCost;
    if (!held && e.dist > 1.5 && prog >= 0.80) imminentLeakers++;
    if (!e.flying && !e.burrowed && ENEMY_MELEE[e.type].block === 'block' && !held) {
      if (prog >= 0.45) unheldGroundThreats++;
      if (prog > maxUnheldGroundProg) {
        maxUnheldGroundProg = prog;
        maxUnheldGround = e;
      }
    }
  }
  const emergency = maxProg >= 0.87;
  if (!isHardWave && !emergency) return castPurse;

  // 3. Cloudguard Banner: plant 3 soldiers ahead of an unheld ground push AT the highest-DPS kill-zone.
  if (
    (belt.cloudguard ?? 0) > 0 &&
    maxUnheldGround &&
    now - rt.lastCastSec.cloudguard >= 6.0 &&
    (maxUnheldGroundProg >= 0.82 || (isHardWave && maxUnheldGroundProg >= 0.48 && (unheldGroundThreats >= 2 || maxUnheldGround.livesCost >= 2)))
  ) {
    const path = world.enemySystem.getPath(false, maxUnheldGround.lane);
    const pt = { x: 0, y: 0, z: 0 };
    let bestX = NaN;
    let bestZ = NaN;
    let bestDps = -1;
    for (const offset of [0.4, 1.0, 1.7, 2.4]) {
      const candDist = Math.min(path.totalLength - 0.6, maxUnheldGround.dist + offset);
      if (candDist < maxUnheldGround.dist) continue;
      path.sample(Math.max(0, candDist), pt);
      const alreadyGuarded = world.soldierSystem.barracks.some(
        (b) => Math.hypot(b.rallyX - pt.x, b.rallyZ - pt.z) <= 2.2 && b.squad.some((s) => s.state !== 'dead'),
      );
      if (alreadyGuarded) continue;
      const dps = towerCoverageDps(world, pt.x, pt.z, false);
      if (dps > bestDps) {
        bestDps = dps;
        bestX = pt.x;
        bestZ = pt.z;
      }
    }
    if (Number.isFinite(bestX) && (bestDps > 20 || maxUnheldGroundProg >= 0.82)) {
      if (world.useItem('cloudguard', bestX, bestZ)) {
        rt.lastCastSec.cloudguard = now;
      }
    }
  }

  // 4. Frost Lantern: freeze surfaced packs inside tower kill-zones (or emergency leakers near the gate).
  if ((belt.frostLantern ?? 0) > 0 && now - rt.lastCastSec.frostLantern >= ITEMS.frostLantern.seconds) {
    const rSq = ITEMS.frostLantern.radius ** 2;
    let bestCenter: EnemyEntity | null = null;
    let bestScore = 0;
    let bestHits = 0;
    for (let i = 0; i < count; i++) {
      const c = pool.items[pool.getActiveIndex(i)];
      if (!c.active || c.hp <= 0 || c.burrowed) continue;
      const cProg = enemyProgress(c);
      if (cProg < (emergency ? 0.78 : 0.48)) continue;
      const killZoneDps = towerCoverageDps(world, c.x, c.z, c.flying);
      if (killZoneDps < 25 && cProg < 0.86) continue;
      const dpsMul = 1 + Math.min(2.5, killZoneDps / 85);
      let score = 0;
      let hits = 0;
      for (let j = 0; j < count; j++) {
        const e = pool.items[pool.getActiveIndex(j)];
        if (!e.active || e.hp <= 0 || e.burrowed) continue;
        if ((e.x - c.x) ** 2 + (e.z - c.z) ** 2 > rSq) continue;
        const slowOnly = !!ENEMY_DEFS[e.type].isBoss || e.elite;
        if (slowOnly ? e.slowTimer > 0.6 : e.frozenTimer > 0.4 || e.stunTimer > 0.4) continue;
        hits++;
        const p = enemyProgress(e);
        score += e.livesCost * (0.8 + p * 1.6) * dpsMul * (slowOnly ? 1.25 : 1.0);
      }
      if (score > bestScore) {
        bestScore = score;
        bestCenter = c;
        bestHits = hits;
      }
    }
    if (bestCenter && ((bestHits >= 3 && bestScore >= 7.5) || (bestHits >= 1 && maxProg >= 0.85))) {
      if (world.useItem('frostLantern', bestCenter.x, bestCenter.z)) {
        rt.lastCastSec.frostLantern = now;
      }
    }
  }

  // 5. Ember Pot: armor-piercing burst + ground burn on high-value clusters / dangerous leakers.
  if ((belt.emberPot ?? 0) > 0 && now - rt.lastCastSec.emberPot >= Math.max(2.0, ITEMS.emberPot.burnSeconds)) {
    const rSq = ITEMS.emberPot.radius ** 2;
    const potDmg = Math.round(computeMeteorDamage(wave) * ITEMS.emberPot.meteorFraction);
    let bestCenter: EnemyEntity | null = null;
    let bestScore = 0;
    let bestHits = 0;
    for (let i = 0; i < count; i++) {
      const c = pool.items[pool.getActiveIndex(i)];
      if (!c.active || c.hp <= 0 || c.burrowed) continue;
      const cProg = enemyProgress(c);
      if (cProg < (emergency ? 0.75 : 0.56)) continue;
      let score = 0;
      let hits = 0;
      for (let j = 0; j < count; j++) {
        const e = pool.items[pool.getActiveIndex(j)];
        if (!e.active || e.hp <= 0 || e.burrowed) continue;
        if ((e.x - c.x) ** 2 + (e.z - c.z) ** 2 > rSq) continue;
        hits++;
        const p = enemyProgress(e);
        const effDmg = Math.min(e.hp, potDmg + (e.flying ? 0 : ITEMS.emberPot.burnDamage * 2));
        const killBonus = e.hp <= potDmg ? 1.4 : 1.0;
        const armorBonus = e.armor >= 6 ? 1.3 : 1.0;
        score += (effDmg / Math.max(40, potDmg)) * e.livesCost * (1 + p * p * 2.2) * killBonus * armorBonus;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCenter = c;
        bestHits = hits;
      }
    }
    if (bestCenter && ((bestHits >= 3 && bestScore >= 4.0) || (bestHits >= 1 && maxProg >= 0.85))) {
      if (world.useItem('emberPot', bestCenter.x, bestCenter.z)) {
        rt.lastCastSec.emberPot = now;
      }
    }
  }

  // 6. Gale Bell: push foes back into the towers' kill-zone right before they breach the sanctuary.
  if (
    (belt.galeBell ?? 0) > 0 &&
    now - rt.lastCastSec.galeBell >= 4.5 &&
    (maxProg >= 0.85 || (isHardWave && imminentLeakers >= 2 && maxProg >= 0.80))
  ) {
    if (world.useItem('galeBell')) {
      rt.lastCastSec.galeBell = now;
    }
  }

  return castPurse;
}

export function executeItemSimJob(spec: ItemRunSpec): ItemRunOutcome {
  const level = LEVELS_2D[spec.levelIndex];
  const baseKit = campaignKit(spec.xp, spec.stars);
  const patch = DIFFICULTIES[spec.difficulty].patch;
  const modifiers = combineRunModifiers(baseKit.modifiers, patch);
  const kit: CampaignKit = { ...baseKit, modifiers };
  const scriptActions = balanceBuildOrder(level, spec.profile === 'weak' ? 'weak' : 'greedy');
  const totalBeltCharges = Object.values(spec.belt).reduce((s, n) => s + (n ?? 0), 0);

  if (totalBeltCharges === 0) {
    const res = runLevelBalanceSim(
      level,
      spec.profile === 'weak' ? 'weak' : 'greedy',
      scriptActions,
      kit,
    );
    const rawStars = res.outcome === 'won' ? res.stars : 0;
    const awarded = res.outcome === 'won' ? starsAwarded(rawStars, spec.difficulty) : 0;
    return {
      jobId: spec.jobId,
      levelId: level.id,
      difficulty: spec.difficulty,
      profile: spec.profile,
      outcome: res.outcome,
      finalLives: res.finalLives,
      heroXp: res.heroXp,
      effectiveLives: res.finalLives,
      restoredLives: 0,
      startingLives: res.startingLives,
      rawStars,
      awardedStars: awarded,
      wavesReached: res.waves.length,
      totalWaves: level.waves.length,
      used: {},
      totalCasts: 0,
      crystalsSpent: 0,
      waves: res.waves.map((w) => ({
        waveNumber: w.waveNumber,
        livesLost: w.livesLost,
        peakGroundProgress: w.peakGroundProgress,
      })),
    };
  }

  const events = new EventBus();
  const world = new SimWorld(level, events, {
    ...kit,
    itemBelt: spec.belt,
  });
  const post = world.hero ? findMergePoint([world.groundPath, ...world.extraGroundPaths]) : null;
  let wavesReached = 0;
  events.on('waveStarted', () => {
    wavesReached++;
  });

  const queue = [...scriptActions];
  const executeStep = (): boolean => {
    while (queue.length > 0) {
      const res = tryExecuteBuildAction(world, queue[0]);
      if (res === 'invalid') {
        queue.shift();
        continue;
      }
      if (res === 'wait') return false;
      queue.shift();
      return true;
    }
    return false;
  };

  const baselineFlawless =
    spec.baselineOutcome === 'won' && spec.baselineWaves.every((w) => w.livesLost === 0);
  const rt: PolicyRuntime = {
    hardWaves: computeHardWaves(
      level.waves.length,
      spec.baselineOutcome,
      spec.baselineWaves,
      Math.max(3, totalBeltCharges),
    ),
    purseWaves: buildPurseSchedule(
      level.waves.length,
      world.itemSystem.initial.skyPurse ?? 0,
      spec.baselineOutcome,
      spec.baselineWaves,
    ),
    baselineLostEarly: spec.baselineOutcome === 'lost' && spec.baselineWaves.length <= 5,
    baselineFlawless,
    lastCastSec: {
      emberPot: -99,
      frostLantern: -99,
      heartstone: -99,
      skyPurse: -99,
      cloudguard: -99,
      galeBell: -99,
    },
    lastPurseWave: -1,
  };

  while (executeStep()) {
    // spend starting gold greedily before wave 1
  }
  if (post) {
    world.commandHeroMove(post.x, post.z);
    for (let i = 0; i < 720 && world.hero?.state === 'moving'; i++) world.fixedTick(BALANCE.fixedDt);
  }
  world.startNextWave();

  const COMBAT_COOLDOWN_SEC = 8.0;
  let combatCooldown = COMBAT_COOLDOWN_SEC;
  let wasBetweenWaves = false;

  const maxTicks = 60 * 2600;
  for (let tick = 0; tick < maxTicks && world.outcome === 'ongoing'; tick++) {
    const state = world.waveSystem.state;
    if (state === 'betweenWaves') {
      wasBetweenWaves = true;
      if (tick % 15 === 0) driveItems(world, rt, queue);
      while (executeStep()) {
        // spend between waves greedily
      }
    } else {
      if (wasBetweenWaves) {
        combatCooldown = COMBAT_COOLDOWN_SEC;
        wasBetweenWaves = false;
      }
      if (combatCooldown > 0) {
        combatCooldown = Math.max(0, combatCooldown - BALANCE.fixedDt);
      }
      if (combatCooldown <= 0 && executeStep()) {
        combatCooldown = COMBAT_COOLDOWN_SEC;
      }
    }

    if (tick % 30 === 0) {
      if (post) driveScriptedHero(world, post.x, post.z);
      driveGlobalAbilities(world, kit);
      if (state !== 'betweenWaves') driveItems(world, rt, queue);
    } else if (tick % 15 === 0 && (world.itemSystem.belt().heartstone ?? 0) > 0) {
      if (world.lives < world.startingLives && (heartstoneCeiling(world.startingLives, world.mods.marketDifficulty) - world.lives >= ITEMS.heartstone.lives || world.lives <= 6)) {
        world.useItem('heartstone');
      }
    }

    world.fixedTick(BALANCE.fixedDt);
  }

  const initial = world.itemSystem.initial;
  const remaining = world.itemSystem.belt();
  const used: ItemCounts = {};
  let totalCasts = 0;
  let crystalsSpent = 0;
  for (const id of ITEM_IDS) {
    const u = Math.max(0, (initial[id] ?? 0) - (remaining[id] ?? 0));
    if (u > 0) {
      used[id] = u;
      totalCasts += u;
      crystalsSpent += u * ITEMS[id].price;
    }
  }
  const rawStars = world.outcome === 'won' ? world.computeStars() : 0;
  const awardedStars = world.outcome === 'won' ? starsAwarded(rawStars, spec.difficulty) : 0;
  const effectiveLives = Math.max(0, world.lives - world.itemSystem.restoredLives);

  return {
    jobId: spec.jobId,
    levelId: level.id,
    difficulty: spec.difficulty,
    profile: spec.profile,
    outcome: world.outcome,
    finalLives: world.lives,
    heroXp: world.heroSystem.runXp,
    effectiveLives,
    restoredLives: world.itemSystem.restoredLives,
    startingLives: world.startingLives,
    rawStars,
    awardedStars,
    wavesReached,
    totalWaves: level.waves.length,
    used,
    totalCasts,
    crystalsSpent,
  };
}

async function runSpecsParallel(specs: readonly ItemRunSpec[], maxWorkers: number): Promise<ItemRunOutcome[]> {
  if (specs.length === 0) return [];
  const workerCount = Math.max(1, Math.min(maxWorkers, specs.length));
  if (workerCount <= 1) return specs.map(executeItemSimJob);

  const buckets: ItemRunSpec[][] = Array.from({ length: workerCount }, () => []);
  for (let i = 0; i < specs.length; i++) {
    buckets[i % workerCount].push(specs[i]);
  }
  const chunks = await Promise.all(
    buckets.map(
      (bucket) =>
        new Promise<ItemRunOutcome[]>((resolve, reject) => {
          const worker = new Worker(new URL('./lib/itemWorker.mjs', import.meta.url), {
            workerData: bucket,
          });
          worker.once('message', (msg: ItemRunOutcome[]) => resolve(msg));
          worker.once('error', reject);
          worker.once('exit', (code) => {
            if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
          });
        }),
    ),
  );
  const out = chunks.flat();
  out.sort((a, b) => a.jobId - b.jobId);
  return out;
}

interface EntryProgression {
  readonly xp: number;
  readonly stars: number;
  readonly kit: CampaignKit;
  readonly greedyResult: SimRunResult;
}

function buildFirstClearEntries(levels: readonly LevelDef[], difficulty: 'easy' | 'normal'): EntryProgression[] {
  let xp = 0;
  let stars = 0;
  const patch: RunModifierPatch = DIFFICULTIES[difficulty].patch;
  return levels.map((level) => {
    const entryXp = xp;
    const entryStars = stars;
    const kit = campaignKit(entryXp, entryStars);
    const greedyResult = runLevelBalanceSim(level, 'greedy', balanceBuildOrder(level, 'greedy'), {
      ...kit,
      modifiers: combineRunModifiers(kit.modifiers, patch),
    });
    xp += greedyResult.heroXp;
    if (greedyResult.outcome === 'won') stars += starsAwarded(greedyResult.stars, difficulty);
    return { xp: entryXp, stars: entryStars, kit, greedyResult };
  });
}

interface MarginalStats {
  readonly id: ItemId;
  readonly price: number;
  casts: number;
  runsUsed: number;
  crystalsSpent: number;
  deltaWins: number;
  deltaLives: number;
  deltaEffectiveLives: number;
  deltaStars: number;
  deltaWavesOnLosses: number;
  marginalValue: number;
  valuePerCrystalSpent: number;
  valuePerUnitPrice: number;
}

/**
 * Unified marginal survival & victory gain vs the itemless run on the same (island, difficulty, profile):
 *  - +8 life-equivalents for converting a Defeat into a Victory
 *  - +1 per net surviving life at the end of the run (0 on defeat)
 *  - +1.5 per extra wave reached when both runs still ended in defeat
 */
function computeRunMarginalGain(base: ItemRunOutcome, withItem: ItemRunOutcome): number {
  const winDiff = (withItem.outcome === 'won' ? 1 : 0) - (base.outcome === 'won' ? 1 : 0);
  const baseLives = base.outcome === 'won' ? base.finalLives : 0;
  const itemLives = withItem.outcome === 'won' ? withItem.finalLives : 0;
  const waveGain =
    base.outcome !== 'won' && withItem.outcome !== 'won'
      ? Math.max(0, withItem.wavesReached - base.wavesReached)
      : 0;
  return winDiff * 8 + (itemLives - baseLives) + waveGain * 1.5;
}

export interface EconomyScenarioSummary {
  readonly name: string;
  readonly description: string;
  readonly totalEarned: number;
  readonly starterCrystals: number;
  readonly starterItems: number;
  readonly starterItemsWorth: number;
  readonly crystalsPerIsland: number;
  readonly avgCatalogItemsPerIsland: number;
  readonly avgLoadoutItemsPerIsland: number;
  readonly avgItemsInclStarterPerIsland: number;
  readonly checkpoints: readonly {
    readonly islandId: string;
    readonly islandNumber: number;
    readonly cumulativeCrystals: number;
    readonly cumulativeItemsAffordable: number;
  }[];
}

function simulateCampaignEconomy(
  levels: readonly LevelDef[],
  normalStarsByIsland: readonly number[],
  loadout: readonly ItemId[],
): EconomyScenarioSummary[] {
  const avgCatalogPrice = ITEM_IDS.reduce((s, id) => s + ITEMS[id].price, 0) / ITEM_IDS.length;
  const avgLoadoutPrice =
    loadout.length > 0
      ? loadout.reduce((s, id) => s + ITEMS[id].price, 0) / loadout.length
      : avgCatalogPrice;
  const starterItems = ITEM_IDS.length * MARKET_RULES.starterCount;
  const starterItemsWorth = ITEM_IDS.reduce((s, id) => s + ITEMS[id].price * MARKET_RULES.starterCount, 0);

  const runScenario = (
    name: string,
    description: string,
    stepIsland: (save: ReturnType<typeof sanitizeMarket>, i: number, level: LevelDef) => void,
  ): EconomyScenarioSummary => {
    const save = sanitizeMarket();
    const checkpoints: EconomyScenarioSummary['checkpoints'][number][] = [];
    for (let i = 0; i < levels.length; i++) {
      stepIsland(save, i, levels[i]);
      const crystals = marketWallet(save).crystals;
      checkpoints.push({
        islandId: levels[i].id,
        islandNumber: i + 1,
        cumulativeCrystals: crystals,
        cumulativeItemsAffordable: Number((crystals / avgCatalogPrice).toFixed(1)),
      });
    }
    const spendProbe = sanitizeMarket(JSON.parse(JSON.stringify(save)));
    let boughtCount = 0;
    while (loadout.length > 0) {
      const pick = loadout[boughtCount % loadout.length];
      if (!buyItem(spendProbe, 'sim', pick)) break;
      boughtCount++;
    }
    const totalEarned = marketWallet(save).crystals;
    const crystalsPerIsland = totalEarned / levels.length;
    const avgCatalogItemsPerIsland = crystalsPerIsland / avgCatalogPrice;
    const avgLoadoutItemsPerIsland = crystalsPerIsland / avgLoadoutPrice;
    const avgItemsInclStarterPerIsland = avgCatalogItemsPerIsland + starterItems / levels.length;
    return {
      name,
      description,
      totalEarned,
      starterCrystals: MARKET_RULES.starterCrystals,
      starterItems,
      starterItemsWorth,
      crystalsPerIsland,
      avgCatalogItemsPerIsland,
      avgLoadoutItemsPerIsland,
      avgItemsInclStarterPerIsland,
      checkpoints,
    };
  };

  return [
    runScenario(
      'Typical Campaign (No IAP)',
      `${levels.length} Normal first clears, replays every third island, Daily Squalls every fourth island after the first`,
      (save, i, level) => {
        const stars = Math.max(1, normalStarsByIsland[i] ?? 2);
        awardMarketWin(save, 'player', level.id, stars, 'normal', true, null);
        if (i % 3 === 2) {
          const isHardAttempt = i <= 12;
          awardMarketWin(save, 'player', level.id, isHardAttempt ? 2 : 3, isHardAttempt ? 'hard' : 'normal', false, null);
        }
        if (i > 0 && i % 4 === 0) {
          awardMarketWin(save, 'player', levels[Math.max(0, i - 2)].id, 2, 'normal', false, 1000 + i);
        }
      },
    ),
    runScenario(
      'First Clears Only (Zero Replays / Dailies)',
      `${levels.length} Normal first clears at simulated stars, 0 replays, 0 Daily Squalls`,
      (save, i, level) => {
        const stars = Math.max(1, normalStarsByIsland[i] ?? 2);
        awardMarketWin(save, 'player', level.id, stars, 'normal', true, null);
      },
    ),
    runScenario(
      'Struggling Player (Mixed Easy/Normal + Retries)',
      'Normal first clears through island 17, then Easy, with Normal replays and Daily Squalls (losses pay 0)',
      (save, i, level) => {
        const dropToEasy = i >= 17;
        const stars = dropToEasy ? 1 : Math.min(2, Math.max(1, normalStarsByIsland[i] ?? 1));
        awardMarketWin(save, 'player', level.id, stars, dropToEasy ? 'easy' : 'normal', true, null);
        if (i % 4 === 1) {
          awardMarketWin(save, 'player', levels[Math.max(0, i - 1)].id, 2, 'normal', false, null);
        }
        if (i > 0 && i % 5 === 0) {
          awardMarketWin(save, 'player', levels[0].id, 2, 'normal', false, 2000 + i);
        }
      },
    ),
    runScenario(
      'Easy-Only Casual',
      'Every island cleared once on Easy (1★ cap), with Daily Squalls',
      (save, i, level) => {
        awardMarketWin(save, 'player', level.id, 1, 'easy', true, null);
        if (i === 7 || i === 15 || i === 23) {
          awardMarketWin(save, 'player', levels[0].id, 2, 'normal', false, 3000 + i);
        }
      },
    ),
  ];
}

function fmtRun(r: ItemRunOutcome): string {
  if (r.outcome !== 'won') return `L @${r.wavesReached}`;
  const healTag = r.restoredLives > 0 ? `(+${r.restoredLives}♥)` : '';
  return `W ${r.finalLives}/${r.startingLives}${healTag} ${r.awardedStars}★`;
}

/** A fixed rescue, economy and damage belt, stocked to the live per-slot cap. Keep the kit
 * paired for the marginal comparison, then let the belt player spend its own earned stars. */
function normalBeltProbe(levels: readonly LevelDef[], entries: readonly EntryProgression[], selected: ReadonlySet<string>) {
  const belt = { heartstone: MARKET_RULES.useCap.normal, skyPurse: MARKET_RULES.useCap.normal, emberPot: MARKET_RULES.useCap.normal };
  let xp = 0;
  let stars = 0;
  let bareLoss = 0;
  let pairedLoss = 0;
  let progressingLoss = 0;
  let wins = 0;
  console.log('Normal first-clear belt (Heartstone, Sky Purse, Ember Pot). Net lives lost after healing:');
  console.log('Island  no belt  same kit  own progression  leaks  heals  stars  casts');
  for (const [levelIndex, level] of levels.entries()) {
    const entry = entries[levelIndex];
    const spec = { levelIndex, jobId: 0, difficulty: 'normal', profile: 'campaign', belt } as const;
    const paired = executeItemSimJob({ ...spec, xp: entry.xp, stars: entry.stars,
      baselineOutcome: entry.greedyResult.outcome, baselineWaves: entry.greedyResult.waves });
    const kit = campaignKit(xp, stars);
    const sameKit = kit.heroLevel === entry.kit.heroLevel && stars === entry.stars;
    const forecast = sameKit ? entry.greedyResult : runLevelBalanceSim(level, 'greedy', balanceBuildOrder(level, 'greedy'), kit);
    const result = sameKit ? paired : executeItemSimJob({ ...spec, xp, stars, baselineOutcome: forecast.outcome, baselineWaves: forecast.waves });
    const base = entry.greedyResult.startingLives - entry.greedyResult.finalLives;
    const same = paired.startingLives - paired.finalLives;
    const own = result.startingLives - result.finalLives;
    if (selected.has(level.id)) console.log([level.id, base, same, own, own + result.restoredLives, result.restoredLives,
      result.awardedStars, result.totalCasts].join('\t'));
    bareLoss += base;
    pairedLoss += same;
    progressingLoss += own;
    if (paired.outcome === 'won' && result.outcome === 'won') wins++;
    xp += result.heroXp;
    stars += result.awardedStars;
  }
  if (levels.length === LEVELS_2D.length && selected.size === levels.length) {
    const ok = wins === levels.length && bareLoss > 0 && [pairedLoss, progressingLoss].every(n => n >= 0.60 * bareLoss && n < bareLoss);
    console.log(`${ok ? 'PASS' : 'FAIL'}  Normal belt clears ${wins}/${levels.length} on both profiles and retains ≥60% of net lives lost: ${pairedLoss}/${bareLoss} paired, ${progressingLoss}/${bareLoss} with its own XP and stars`);
    if (!ok) process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const arg = (key: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const md = process.argv.includes('--md');
  const ids = arg('levels')?.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids?.some((id) => !LEVELS_2D.some((l) => l.id === id))) {
    throw new Error(`Unknown island in --levels: ${ids.join(',')}`);
  }
  const selectedSet = new Set(LEVELS_2D.filter((l) => !ids || ids.includes(l.id)).map((l) => l.id));
  const lastIdx = LEVELS_2D.findLastIndex((l) => selectedSet.has(l.id));
  const levels = LEVELS_2D.slice(0, lastIdx + 1);

  const workersArg = Number(arg('workers'));
  const maxWorkers =
    Number.isFinite(workersArg) && workersArg >= 1
      ? Math.floor(workersArg)
      : Math.min(8, os.availableParallelism());

  const loadoutArg = arg('loadout')?.split(',').map((s) => s.trim()).filter(Boolean);
  if (loadoutArg && (loadoutArg.length > MARKET_RULES.slots || !loadoutArg.every(isItemId))) {
    throw new Error(`Invalid --loadout (expected 1..${MARKET_RULES.slots} valid item IDs)`);
  }

  // Step 1: Compute sequential first-clear entry progressions (Easy and Normal).
  const normalEntries = buildFirstClearEntries(levels, 'normal');
  normalBeltProbe(levels, normalEntries, selectedSet);
  if (process.argv.includes('--normal-belt')) return;
  const easyEntries = buildFirstClearEntries(levels, 'easy');

  let nextJobId = 1;
  const selectedIndices: number[] = [];
  for (let i = 0; i < levels.length; i++) {
    if (selectedSet.has(levels[i].id)) selectedIndices.push(i);
  }

  // Step 2: Parallelize the remaining itemless baseline runs (campaign Hard + weak Easy/Normal/Hard).
  const baselineWaveMap = new Map<string, { outcome: 'ongoing' | 'won' | 'lost'; waves: readonly BaselineWaveInfo[]; out: ItemRunOutcome }>();
  const extraBaseSpecs: ItemRunSpec[] = [];
  for (const idx of selectedIndices) {
    const level = levels[idx];
    for (const d of DIFFICULTY_IDS) {
      const entry = d === 'easy' ? easyEntries[idx] : normalEntries[idx];
      for (const p of PROFILES) {
        if (p === 'campaign' && (d === 'easy' || d === 'normal')) {
          const res = entry.greedyResult;
          const rawStars = res.outcome === 'won' ? res.stars : 0;
          const awarded = res.outcome === 'won' ? starsAwarded(rawStars, d) : 0;
          const waves = res.waves.map((w) => ({
            waveNumber: w.waveNumber,
            livesLost: w.livesLost,
            peakGroundProgress: w.peakGroundProgress,
          }));
          baselineWaveMap.set(`${level.id}:${d}:${p}`, {
            outcome: res.outcome,
            waves,
            out: {
              jobId: 0,
              levelId: level.id,
              difficulty: d,
              profile: p,
              outcome: res.outcome,
              finalLives: res.finalLives,
              heroXp: res.heroXp,
              effectiveLives: res.finalLives,
              restoredLives: 0,
              startingLives: res.startingLives,
              rawStars,
              awardedStars: awarded,
              wavesReached: res.waves.length,
              totalWaves: level.waves.length,
              used: {},
              totalCasts: 0,
              crystalsSpent: 0,
            },
          });
        } else {
          extraBaseSpecs.push({
            jobId: nextJobId++,
            levelIndex: idx,
            difficulty: d,
            profile: p,
            xp: entry.xp,
            stars: entry.stars,
            belt: {},
            baselineOutcome: 'won',
            baselineWaves: [],
          });
        }
      }
    }
  }
  const extraBaseOutcomes = await runSpecsParallel(extraBaseSpecs, maxWorkers);
  for (const out of extraBaseOutcomes) {
    baselineWaveMap.set(`${out.levelId}:${out.difficulty}:${out.profile}`, {
      outcome: out.outcome,
      waves: out.waves ?? [],
      out,
    });
  }

  // Step 3: Single-item marginal value sweeps across all 6 items in parallel.
  const singleSpecs: { itemId: ItemId; spec: ItemRunSpec }[] = [];
  for (const itemId of ITEM_IDS) {
    for (const idx of selectedIndices) {
      const level = levels[idx];
      for (const d of DIFFICULTY_IDS) {
        const entry = d === 'easy' ? easyEntries[idx] : normalEntries[idx];
        const cap = MARKET_RULES.useCap[d];
        for (const p of PROFILES) {
          const base = baselineWaveMap.get(`${level.id}:${d}:${p}`)!;
          singleSpecs.push({
            itemId,
            spec: {
              jobId: nextJobId++,
              levelIndex: idx,
              difficulty: d,
              profile: p,
              xp: entry.xp,
              stars: entry.stars,
              belt: { [itemId]: cap },
              baselineOutcome: base.outcome,
              baselineWaves: base.waves,
            },
          });
        }
      }
    }
  }
  const singleOutcomes = await runSpecsParallel(
    singleSpecs.map((s) => s.spec),
    maxWorkers,
  );

  const marginalByItem = new Map<ItemId, MarginalStats>();
  for (const id of ITEM_IDS) {
    marginalByItem.set(id, {
      id,
      price: ITEMS[id].price,
      casts: 0,
      runsUsed: 0,
      crystalsSpent: 0,
      deltaWins: 0,
      deltaLives: 0,
      deltaEffectiveLives: 0,
      deltaStars: 0,
      deltaWavesOnLosses: 0,
      marginalValue: 0,
      valuePerCrystalSpent: 0,
      valuePerUnitPrice: 0,
    });
  }

  for (let k = 0; k < singleSpecs.length; k++) {
    const { itemId } = singleSpecs[k];
    const out = singleOutcomes[k];
    const base = baselineWaveMap.get(`${out.levelId}:${out.difficulty}:${out.profile}`)!.out;
    const st = marginalByItem.get(itemId)!;
    st.casts += out.totalCasts;
    if (out.totalCasts > 0) st.runsUsed++;
    st.crystalsSpent += out.crystalsSpent;
    st.deltaWins += (out.outcome === 'won' ? 1 : 0) - (base.outcome === 'won' ? 1 : 0);
    const baseLives = base.outcome === 'won' ? base.finalLives : 0;
    const itemLives = out.outcome === 'won' ? out.finalLives : 0;
    st.deltaLives += itemLives - baseLives;
    const baseEff = base.outcome === 'won' ? base.effectiveLives : 0;
    const itemEff = out.outcome === 'won' ? out.effectiveLives : 0;
    st.deltaEffectiveLives += itemEff - baseEff;
    st.deltaStars += out.awardedStars - base.awardedStars;
    if (base.outcome !== 'won' && out.outcome !== 'won') {
      st.deltaWavesOnLosses += Math.max(0, out.wavesReached - base.wavesReached);
    }
    st.marginalValue += computeRunMarginalGain(base, out);
  }

  for (const st of marginalByItem.values()) {
    st.valuePerCrystalSpent = st.crystalsSpent > 0 ? st.marginalValue / st.crystalsSpent : 0;
    st.valuePerUnitPrice = st.price > 0 ? st.marginalValue / st.price : 0;
  }

  const rankedItems = [...marginalByItem.values()].sort(
    (a, b) => b.valuePerCrystalSpent - a.valuePerCrystalSpent || b.marginalValue - a.marginalValue,
  );
  const chosenLoadout: readonly ItemId[] =
    (loadoutArg as ItemId[] | undefined) ?? rankedItems.slice(0, MARKET_RULES.slots).map((r) => r.id);

  // Step 4: Run the 3-item belt across every selected island x difficulty x profile.
  const beltSpecs: ItemRunSpec[] = [];
  for (const idx of selectedIndices) {
    const level = levels[idx];
    for (const d of DIFFICULTY_IDS) {
      const entry = d === 'easy' ? easyEntries[idx] : normalEntries[idx];
      const cap = MARKET_RULES.useCap[d];
      const belt: ItemCounts = Object.fromEntries(chosenLoadout.map((id) => [id, cap]));
      for (const p of PROFILES) {
        const base = baselineWaveMap.get(`${level.id}:${d}:${p}`)!;
        beltSpecs.push({
          jobId: nextJobId++,
          levelIndex: idx,
          difficulty: d,
          profile: p,
          xp: entry.xp,
          stars: entry.stars,
          belt,
          baselineOutcome: base.outcome,
          baselineWaves: base.waves,
        });
      }
    }
  }
  const beltOutcomes = await runSpecsParallel(beltSpecs, maxWorkers);
  const beltMap = new Map<string, ItemRunOutcome>();
  for (const out of beltOutcomes) {
    beltMap.set(`${out.levelId}:${out.difficulty}:${out.profile}`, out);
  }

  // Step 5: Print Item Balance Report.
  console.log(`=== Skyhold Isles Market Item & Economy Simulator ===`);
  console.log(
    `3-item belt policy loadout: [${chosenLoadout.join(', ')}] (Easy cap=${MARKET_RULES.useCap.easy}, Normal cap=${MARKET_RULES.useCap.normal}, Hard cap=${MARKET_RULES.useCap.hard})\n`,
  );

  console.log(
    `### 1. Single-Item Marginal Value (${selectedIndices.length} islands × 3 difficulties × 2 kits = ${selectedIndices.length * 6} runs/item)`,
  );
  const itemHeader = [
    'Item',
    'Price',
    'Casts',
    'Crystals',
    'ΔWins',
    'ΔLives',
    'ΔStars',
    'ΔWaves(L)',
    'MargVal',
    'Val/CrysSpent',
    'TotVal/Price',
  ];
  const printTable = (headers: string[], rows: string[][]): void => {
    if (md) {
      console.log(`| ${headers.join(' | ')} |`);
      console.log(`| ${headers.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`);
      for (const r of rows) console.log(`| ${r.join(' | ')} |`);
    } else {
      const widths = headers.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)));
      console.log(headers.map((h, c) => (c === 0 ? h.padEnd(widths[c]) : h.padStart(widths[c]))).join('  '));
      console.log(widths.map((w) => '-'.repeat(w)).join('  '));
      for (const r of rows) {
        console.log(r.map((v, c) => (c === 0 ? v.padEnd(widths[c]) : v.padStart(widths[c]))).join('  '));
      }
    }
  };

  printTable(
    itemHeader,
    rankedItems.map((s) => [
      s.id,
      String(s.price),
      String(s.casts),
      String(s.crystalsSpent),
      `${s.deltaWins >= 0 ? '+' : ''}${s.deltaWins}`,
      `${s.deltaLives >= 0 ? '+' : ''}${s.deltaLives}`,
      `${s.deltaStars >= 0 ? '+' : ''}${s.deltaStars}`,
      `+${s.deltaWavesOnLosses}`,
      s.marginalValue.toFixed(1),
      s.valuePerCrystalSpent.toFixed(3),
      s.valuePerUnitPrice.toFixed(2),
    ]),
  );
  const topSpentRatio =
    rankedItems.length >= 2 && rankedItems[1].valuePerCrystalSpent > 0
      ? rankedItems[0].valuePerCrystalSpent / rankedItems[1].valuePerCrystalSpent
      : 1;
  const byTotPrice = [...marginalByItem.values()].sort((a, b) => b.valuePerUnitPrice - a.valuePerUnitPrice);
  const topTotPriceRatio =
    byTotPrice.length >= 2 && byTotPrice[1].valuePerUnitPrice > 0
      ? byTotPrice[0].valuePerUnitPrice / byTotPrice[1].valuePerUnitPrice
      : 1;
  const minMaxSpentRatio =
    rankedItems.length >= 2 && rankedItems[rankedItems.length - 1].valuePerCrystalSpent > 0
      ? rankedItems[0].valuePerCrystalSpent / rankedItems[rankedItems.length - 1].valuePerCrystalSpent
      : Infinity;
  console.log(
    `\nDominance ratios: top/2nd Val/CrysSpent = ${topSpentRatio.toFixed(2)}x (${rankedItems[0].id} vs ${rankedItems[1].id})` +
      ` | top/2nd TotVal/Price = ${topTotPriceRatio.toFixed(2)}x (${byTotPrice[0].id} vs ${byTotPrice[1].id})` +
      ` | max/min Val/CrysSpent spread = ${minMaxSpentRatio.toFixed(2)}x\n`,
  );

  console.log(`### 2. Aggregate Summary: No Items vs 3-Item Belt [${chosenLoadout.join(', ')}]`);
  const summaryRows: string[][] = [];
  for (const p of PROFILES) {
    for (const d of DIFFICULTY_IDS) {
      const bases = selectedIndices.map((idx) => baselineWaveMap.get(`${levels[idx].id}:${d}:${p}`)!.out);
      const belts = selectedIndices.map((idx) => beltMap.get(`${levels[idx].id}:${d}:${p}`)!);
      const n = selectedIndices.length;
      const bWins = bases.filter((r) => r.outcome === 'won').length;
      const iWins = belts.filter((r) => r.outcome === 'won').length;
      const bAvgLives = bases.reduce((s, r) => s + (r.outcome === 'won' ? r.finalLives : 0), 0) / n;
      const iAvgLives = belts.reduce((s, r) => s + (r.outcome === 'won' ? r.finalLives : 0), 0) / n;
      const bStars = bases.reduce((s, r) => s + r.awardedStars, 0);
      const iStars = belts.reduce((s, r) => s + r.awardedStars, 0);
      const avgCasts = belts.reduce((s, r) => s + r.totalCasts, 0) / n;
      const avgCrystals = belts.reduce((s, r) => s + r.crystalsSpent, 0) / n;
      summaryRows.push([
        `${p} ${d}`,
        `${bWins}/${n} (${Math.round((bWins / n) * 100)}%)`,
        `${iWins}/${n} (${Math.round((iWins / n) * 100)}%)`,
        `${iWins - bWins >= 0 ? '+' : ''}${iWins - bWins}`,
        bAvgLives.toFixed(1),
        iAvgLives.toFixed(1),
        `${bStars} (${(bStars / n).toFixed(2)}★)`,
        `${iStars} (${(iStars / n).toFixed(2)}★)`,
        avgCasts.toFixed(2),
        avgCrystals.toFixed(1),
      ]);
    }
  }
  printTable(
    ['Profile / Diff', 'No-Item Wins', 'Belt Wins', 'ΔWins', 'No-Item Lives', 'Belt Lives', 'No-Item ★', 'Belt ★', 'Avg Casts', 'Avg Crys'],
    summaryRows,
  );
  console.log('');

  console.log(`### 3. Per-Island Results (No Items -> With Belt)`);
  const islandRows: string[][] = [];
  for (const idx of selectedIndices) {
    const id = levels[idx].id;
    const cell = (p: Profile, d: DifficultyId): string => {
      const b = baselineWaveMap.get(`${id}:${d}:${p}`)!.out;
      const w = beltMap.get(`${id}:${d}:${p}`)!;
      return `${fmtRun(b)} → ${fmtRun(w)}`;
    };
    islandRows.push([
      id,
      cell('campaign', 'easy'),
      cell('campaign', 'normal'),
      cell('campaign', 'hard'),
      cell('weak', 'easy'),
      cell('weak', 'normal'),
      cell('weak', 'hard'),
    ]);
  }
  printTable(
    ['Island', 'campaign easy', 'campaign normal', 'campaign hard', 'weak easy', 'weak normal', 'weak hard'],
    islandRows,
  );
  console.log('');

  // Step 6: Economy simulation (full campaign).
  if (levels.length === LEVELS_2D.length) {
    const normalStars = LEVELS_2D.map((_, i) => {
      const r = normalEntries[i].greedyResult;
      return r.outcome === 'won' ? starsAwarded(r.stars, 'normal') : 1;
    });
    const scenarios = simulateCampaignEconomy(LEVELS_2D, normalStars, chosenLoadout);
    const avgPrice = ITEM_IDS.reduce((s, id) => s + ITEMS[id].price, 0) / ITEM_IDS.length;
    console.log(
      `### 4. Campaign Economy Simulation (${levels.length} islands, no IAP, avg catalog price = ${avgPrice.toFixed(2)} crystals)`,
    );
    printTable(
      ['Playthrough Scenario', 'Total Crystals', 'Crystals / Isle', 'Bought Items / Isle', 'Incl. Starter / Isle'],
      scenarios.map((sc) => [
        sc.name,
        String(sc.totalEarned),
        sc.crystalsPerIsland.toFixed(1),
        sc.avgCatalogItemsPerIsland.toFixed(2),
        sc.avgItemsInclStarterPerIsland.toFixed(2),
      ]),
    );
    console.log('');
    const typical = scenarios[0];
    const milestoneIndices = levels.flatMap((_, i) => i === 0 || i === levels.length - 1 || (i + 1) % 5 === 0 ? [i] : []);
    console.log(`Cumulative wallet checkpoints (${typical.name}):`);
    printTable(
      ['Checkpoint', 'Island', 'Cumulative Crystals', 'Cumulative Items Affordable'],
      milestoneIndices.map((mi) => {
        const cp = typical.checkpoints[mi];
        return [`Isle ${cp.islandNumber}`, cp.islandId, String(cp.cumulativeCrystals), cp.cumulativeItemsAffordable.toFixed(1)];
      }),
    );
    console.log('');

    // Step 7: Balance & Economy Verdict Checks.
    if (selectedIndices.length === LEVELS_2D.length) {
      const chapterTwo = new Set([...registeredChapterIslands().map((l) => l.id), 'i27']);
      const hardBeltCampaign = LEVELS_2D.map((l) => beltMap.get(`${l.id}:hard:campaign`)!);
      const hardBaseCampaign = LEVELS_2D.map((l) => baselineWaveMap.get(`${l.id}:hard:campaign`)!.out);
      const hardBeltWins = hardBeltCampaign.filter((r) => r.outcome === 'won');
      const hardBaseWins = hardBaseCampaign.filter((r) => r.outcome === 'won');
      const hardThreeStars = hardBeltWins.filter((r) => r.awardedStars === 3);
      const hardCh2Wins = hardBeltCampaign.filter((r) => chapterTwo.has(r.levelId) && r.outcome === 'won');
      const hardCh2ThreeStars = hardCh2Wins.filter((r) => r.awardedStars === 3);
      const finaleHard = beltMap.get('i24:hard:campaign');
      const weakNormalBaseWins = LEVELS_2D.filter(
        (l) => baselineWaveMap.get(`${l.id}:normal:weak`)!.out.outcome === 'won',
      ).length;
      const weakNormalBeltWins = LEVELS_2D.filter((l) => beltMap.get(`${l.id}:normal:weak`)!.outcome === 'won').length;
      const weakEasyBaseWins = LEVELS_2D.filter(
        (l) => baselineWaveMap.get(`${l.id}:easy:weak`)!.out.outcome === 'won',
      ).length;
      const weakEasyBeltWins = LEVELS_2D.filter((l) => beltMap.get(`${l.id}:easy:weak`)!.outcome === 'won').length;
      const weakHardBeltWins = LEVELS_2D.filter((l) => beltMap.get(`${l.id}:hard:weak`)!.outcome === 'won').length;

      const check = (ok: boolean, msg: string): void => {
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
        if (!ok) process.exitCode = 1;
      };

      const normalBelt = LEVELS_2D.map(level => beltMap.get(`${level.id}:normal:campaign`)!);
      const netLoss = normalBelt.reduce((total, run) => total + run.startingLives - run.finalLives, 0);
      const baseLoss = normalEntries.reduce((total, { greedyResult: run }) => total + run.startingLives - run.finalLives, 0);
      check(
        normalBelt.every(run => run.outcome === 'won') && netLoss >= 0.6 * baseLoss && netLoss < baseLoss,
        `Selected Normal belt clears the campaign and retains ≥60% of net lives lost: ${netLoss}/${baseLoss}`,
      );
      check(
        weakNormalBeltWins >= weakNormalBaseWins + 3 && weakEasyBeltWins > weakEasyBaseWins,
        `Items turn struggling losses into wins: weak Normal ${weakNormalBaseWins}/${levels.length} -> ${weakNormalBeltWins}/${levels.length}, weak Easy ${weakEasyBaseWins}/${levels.length} -> ${weakEasyBeltWins}/${levels.length}`,
      );
      check(
        hardBeltWins.length > hardBaseWins.length && hardBeltWins.length < levels.length && hardCh2Wins.length < chapterTwo.size,
        `Items help on Hard without clearing everything effortlessly: campaign Hard ${hardBaseWins.length}/${levels.length} -> ${hardBeltWins.length}/${levels.length} (Ch2 ${hardCh2Wins.length}/${chapterTwo.size})`,
      );
      check(
        hardCh2ThreeStars.length === 0 &&
          hardThreeStars.length <= 6 &&
          weakHardBeltWins <= 7 &&
          !!finaleHard &&
          finaleHard.awardedStars <= 2 &&
          finaleHard.effectiveLives < finaleHard.startingLives,
        `Hard stays non-trivial: Ch2 Hard 3★ = ${hardCh2ThreeStars.length}/${hardCh2Wins.length}, total Hard 3★ = ${hardThreeStars.length}/${hardBeltWins.length}, i24 Hard = ${finaleHard ? fmtRun(finaleHard) : 'missing'}, weak Hard wins = ${weakHardBeltWins}/${levels.length}`,
      );
      check(
        topSpentRatio <= 2.0 && topTotPriceRatio <= 2.0 && minMaxSpentRatio <= 2.5,
        `No single item dominates (>2x next best per crystal): Val/CrysSpent ratio = ${topSpentRatio.toFixed(2)}x, TotVal/Price ratio = ${topTotPriceRatio.toFixed(2)}x, max/min spread = ${minMaxSpentRatio.toFixed(2)}x`,
      );
      check(
        typical.avgCatalogItemsPerIsland >= 2.0 &&
          typical.avgCatalogItemsPerIsland <= 4.0 &&
          scenarios[1].avgCatalogItemsPerIsland >= 2.0 &&
          scenarios[1].avgCatalogItemsPerIsland <= 4.0,
        `Economy affords ~2–4 items/island without grinding: first-clears = ${scenarios[1].avgCatalogItemsPerIsland.toFixed(2)}/isle, typical = ${typical.avgCatalogItemsPerIsland.toFixed(2)}/isle`,
      );
    }
  }
}

if (isMainThread && process.argv[1]?.endsWith('itemSim.ts')) {
  void main();
}
