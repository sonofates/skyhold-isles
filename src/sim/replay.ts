import { ITEMS, ITEM_IDS, isItemId, type ItemCounts, type ItemId } from '../data/market.ts';
import { cleanBelt } from './itemSystem.ts';
import { EventBus } from '../core/eventBus.ts';
import type {
  AbilityId,
  HeroId,
  HeroSkillSlot,
  TargetingMode,
  TowerType,
} from '../core/types.ts';
import { ABILITY_DEFS, ABILITY_IDS } from '../data/abilities.ts';
import { BALANCE } from '../data/balance.ts';
import { getHeroSkillNode, isHeroId } from '../data/heroes.ts';
import type { LevelDef } from '../data/levels/types.ts';
import {
  combineRunModifiers,
  NEUTRAL_RUN_MODIFIERS,
  type RunModifierPatch,
  type RunModifiers,
} from '../data/runModifiers.ts';
import { ALL_TOWER_TYPES, specializationsFor, TOWER_DEFS } from '../data/towers.ts';
import { SimWorld } from './world.ts';

export const SIM_REPLAY_VERSION = 1 as const;

const branches = ALL_TOWER_TYPES.flatMap(type => specializationsFor(type));
const branchIds = new Set(branches.map(branch => branch.id));
const towerAbilityIds = new Set(branches.flatMap(branch => branch.abilities.map(ability => ability.id)));

const TARGETING_MODES: readonly TargetingMode[] = ['first', 'last', 'strongest', 'closest'];

function isTargetingMode(val: unknown): val is TargetingMode {
  return typeof val === 'string' && (TARGETING_MODES as readonly string[]).includes(val);
}

function isTowerType(val: unknown): val is TowerType {
  return typeof val === 'string' && Object.prototype.hasOwnProperty.call(TOWER_DEFS, val);
}

function isAbilityId(val: unknown): val is AbilityId {
  return typeof val === 'string' && (ABILITY_IDS as readonly string[]).includes(val);
}

/**
 * Canonical deterministic player command executed against `SimWorld`.
 * Every interactive action in 2D and 3D play maps 1-to-1 to a `SimCommand`.
 */
export type SimCommand =
  | { readonly kind: 'startWave' }
  | { readonly kind: 'setAutoWave'; readonly enabled: boolean }
  | {
      readonly kind: 'placeTower';
      readonly col: number;
      readonly row: number;
      readonly towerType: TowerType;
      readonly targetingMode?: TargetingMode;
    }
  | {
      readonly kind: 'placeTowerOnPlot';
      readonly plotIndex: number;
      readonly towerType: TowerType;
      readonly targetingMode?: TargetingMode;
    }
  | { readonly kind: 'upgradeTower'; readonly towerId: number }
  | { readonly kind: 'specializeTower'; readonly towerId: number; readonly specializationId: string }
  | { readonly kind: 'buyTowerAbility'; readonly towerId: number; readonly abilityId: string }
  | { readonly kind: 'sellTower'; readonly towerId: number }
  | { readonly kind: 'setTargeting'; readonly towerId: number; readonly mode: TargetingMode }
  | { readonly kind: 'setRally'; readonly towerId: number; readonly x: number; readonly z: number }
  | { readonly kind: 'moveHero'; readonly x: number; readonly z: number }
  | { readonly kind: 'castHeroSkill'; readonly slot: HeroSkillSlot; readonly x?: number; readonly z?: number }
  | { readonly kind: 'useItem'; readonly id: ItemId; readonly x?: number; readonly z?: number }
  | { readonly kind: 'castAbility'; readonly id: AbilityId; readonly x?: number; readonly z?: number }
  | { readonly kind: 'startEndlessFromStart' }
  | { readonly kind: 'enterEndless' };

/**
 * Tick-stamped command record.
 * - `tick` is `world.tick` at the moment the command was applied (`0` before the 1st `fixedTick`,
 *   `K` after `K` fixed ticks have executed and before tick `K + 1`).
 * - `seq` preserves strict within-tick execution order when multiple commands happen on the same tick.
 */
export interface StampedSimCommand {
  readonly tick: number;
  readonly seq: number;
  readonly command: SimCommand;
}

export interface SimReplayHeroConfig {
  readonly heroId: HeroId;
  readonly level: number;
  readonly skills: readonly string[];
}

export interface SimReplaySummary {
  readonly totalTicks: number;
  readonly outcome: 'ongoing' | 'won' | 'lost';
  readonly lives: number;
  readonly startingLives: number;
  readonly gold: number;
  readonly stars: 0 | 1 | 2 | 3;
  readonly waveReached: number;
  readonly enemiesKilled: number;
  readonly stateHash: string;
}

/** Complete self-contained deterministic replay log for a `SimWorld` run. */
export interface SimReplayLog {
  readonly version: typeof SIM_REPLAY_VERSION;
  readonly levelId: string;
  readonly seed: number;
  readonly modifiers: RunModifiers;
  readonly itemBelt?: ItemCounts;
  readonly hero: SimReplayHeroConfig | null;
  readonly commands: readonly StampedSimCommand[];
  readonly summary: SimReplaySummary;
}

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;
const _hashF64 = new Float64Array(1);
const _hashU32 = new Uint32Array(_hashF64.buffer);
const _activeEnemyOrder: number[] = [];
const _activeProjOrder: number[] = [];

class Fnv64 {
  private h = FNV_OFFSET_64;

  u32(v: number): void {
    const u = v >>> 0;
    this.byte(u & 0xff);
    this.byte((u >>> 8) & 0xff);
    this.byte((u >>> 16) & 0xff);
    this.byte((u >>> 24) & 0xff);
  }

  f64(v: number): void {
    _hashF64[0] = v === 0 ? 0 : v;
    this.u32(_hashU32[0]);
    this.u32(_hashU32[1]);
  }

  str(s: string): void {
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) {
      this.u32(s.charCodeAt(i));
    }
  }

  hex(): string {
    return this.h.toString(16).padStart(16, '0');
  }

  private byte(b: number): void {
    this.h ^= BigInt(b & 0xff);
    this.h = (this.h * FNV_PRIME_64) & MASK_64;
  }
}

/**
 * Computes a deterministic 64-bit FNV-1a state digest across economy, waves, abilities,
 * towers, barracks soldiers, hero/gizmos/fire-rings, active enemies, and active projectiles.
 */
export function computeSimStateHash(world: SimWorld): string {
  const h = new Fnv64();
  h.str(world.level.id);
  h.u32(world.tick);
  h.str(world.outcome);
  h.f64(world.gold);
  h.f64(world.lives);
  h.u32(world.enemiesKilledTotal);

  // Preserve the v1 digest for recordings that predate the item belt.
  if (Object.keys(world.itemSystem.initial).length) {
    const belt = world.itemSystem.belt();
    for (const id of ITEM_IDS) h.f64(belt[id] ?? -1);
    h.f64(world.itemSystem.restoredLives);
  }
  const ws = world.waveSystem;
  h.str(ws.state);
  h.f64(ws.currentWaveIndex);
  h.f64(ws.interWaveTimer);
  h.f64(ws.getAutoShortenedBy());
  h.f64(ws.waveElapsed);
  h.f64(ws.pendingClearBonus);
  h.u32(ws.getPendingClearedWaves());
  h.u32(ws.getSpawnCursor());
  h.f64(ws.getCurrentWaveClearBonus());
  h.u32(ws.isEndless ? 1 : 0);
  h.u32(ws.autoWave ? 1 : 0);

  for (let i = 0; i < ABILITY_IDS.length; i++) {
    const id = ABILITY_IDS[i];
    h.f64(world.abilitySystem.getCooldown(id));
  }
  h.f64(world.abilitySystem.getOverchargeRemaining());
  const pendingMeteors = world.abilitySystem.getPendingMeteors();
  h.u32(pendingMeteors.length);
  for (let i = 0; i < pendingMeteors.length; i++) {
    const m = pendingMeteors[i];
    h.f64(m.x);
    h.f64(m.z);
    h.f64(m.remaining);
    h.f64(m.damage);
  }

  h.u32(world.towers.length);
  for (let i = 0; i < world.towers.length; i++) {
    const t = world.towers[i];
    h.u32(t.id);
    h.f64(t.col);
    h.f64(t.row);
    h.str(t.type);
    h.u32(t.tier);
    if (t.specialization) {
      h.str(t.specialization.id);
      h.u32(t.specialization.abilities.length);
      for (const id of t.specialization.abilities) h.str(id);
    }
    h.str(t.targetingMode);
    h.f64(t.cooldownTimer);
    h.f64(t.stunTimer);
    h.f64(t.totalDamageDealt);
    h.u32(t.kills);
    h.u32(t.shotCount);
    h.f64(t.overhaulTimer ?? 0);
    h.f64(t.overhaulRateBonus ?? 0);
    // Chapter-four state only when present, so hashes of older replays stay unchanged.
    if ((t.frostSlow ?? 0) > 0) h.f64(t.frostSlow ?? 0);
    if ((t.frostLockTimer ?? 0) > 0) h.f64(t.frostLockTimer ?? 0);
  }
  for (const patch of world.enemySystem.frostPatches) {
    if (!patch.active) continue;
    h.f64(patch.x);
    h.f64(patch.z);
    h.f64(patch.timeLeft);
  }

  const barracks = world.soldierSystem.barracks;
  h.u32(barracks.length);
  for (let i = 0; i < barracks.length; i++) {
    const b = barracks[i];
    h.u32(b.towerId);
    h.f64(b.rallyX);
    h.f64(b.rallyZ);
    if (b.remainingSeconds !== undefined) h.f64(b.remainingSeconds);
  }

  const soldiers = world.soldierSystem.soldiers;
  h.u32(soldiers.length);
  for (let i = 0; i < soldiers.length; i++) {
    const s = soldiers[i];
    h.u32(s.id);
    h.str(s.state);
    h.f64(s.x);
    h.f64(s.z);
    h.f64(s.hp);
    h.f64(s.respawnTimer);
    h.f64(s.attackTimer);
    h.f64(s.sinceHurt);
    h.f64(s.targetPoolIndex);
    h.u32(s.targetUid);
  }

  const hero = world.hero;
  h.u32(world.heroSystem.rng.getState());
  if (hero) {
    h.u32(1);
    h.str(hero.heroId);
    h.u32(hero.level);
    h.str(hero.state);
    h.f64(hero.x);
    h.f64(hero.z);
    h.f64(hero.postX);
    h.f64(hero.postZ);
    h.f64(hero.hp);
    h.f64(hero.respawnTimer);
    h.f64(hero.attackTimer);
    h.f64(hero.sinceHurt);
    h.u32(hero.shotCount);
    h.f64(hero.rallyBannerTimer);
    h.f64(hero.skillCooldowns[0]);
    h.f64(hero.skillCooldowns[1]);
    h.f64(hero.targetPoolIndex);
    h.u32(hero.targetUid);
    h.u32(hero.waypoints.length);
    for (let i = 0; i < hero.waypoints.length; i++) {
      h.f64(hero.waypoints[i].x);
      h.f64(hero.waypoints[i].z);
    }
    h.f64(hero.totalDamageDealt);
    h.u32(hero.kills);
    h.u32(world.heroSystem.runXp);
    h.f64(world.heroSystem.getBurnTickTimer());
    h.f64(world.heroSystem.getCalmHealTimer());
  } else {
    h.u32(0);
  }

  h.u32(world.heroSystem.gizmos.length);
  for (let i = 0; i < world.heroSystem.gizmos.length; i++) {
    const g = world.heroSystem.gizmos[i];
    h.u32(g.id);
    h.f64(g.x);
    h.f64(g.z);
    h.f64(g.remainingSec);
    h.f64(g.cooldownTimer);
    h.f64(g.boostTimer);
  }

  const fireRings = world.heroSystem.fireRings;
  h.u32(fireRings.length);
  for (let i = 0; i < fireRings.length; i++) {
    const r = fireRings[i];
    h.f64(r.x);
    h.f64(r.z);
    h.f64(r.remainingSec);
    h.f64(r.dps);
  }

  const pendingVolleys = world.heroSystem.getPendingVolleys();
  h.u32(pendingVolleys.length);
  for (let i = 0; i < pendingVolleys.length; i++) {
    const pv = pendingVolleys[i];
    h.f64(pv.x);
    h.f64(pv.z);
    h.f64(pv.remainingSec);
    h.f64(pv.damage);
  }

  const burnZones = world.projectileSystem.getBurnZones();
  h.u32(world.projectileSystem.getActiveBurnZoneCount());
  h.f64(world.projectileSystem.getBurnTickTimer());
  for (let i = 0; i < burnZones.length; i++) {
    const z = burnZones[i];
    if (!z.active) continue;
    h.f64(z.x);
    h.f64(z.z);
    h.f64(z.timeLeft);
    h.f64(z.damage);
  }

  _activeEnemyOrder.length = 0;
  for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
    const idx = world.enemyPool.getActiveIndex(i);
    const uid = world.enemyPool.items[idx].uid;
    let pos = _activeEnemyOrder.length;
    _activeEnemyOrder.push(idx);
    while (pos > 0 && world.enemyPool.items[_activeEnemyOrder[pos - 1]].uid > uid) {
      _activeEnemyOrder[pos] = _activeEnemyOrder[pos - 1];
      pos--;
    }
    _activeEnemyOrder[pos] = idx;
  }
  h.u32(_activeEnemyOrder.length);
  for (let i = 0; i < _activeEnemyOrder.length; i++) {
    const idx = _activeEnemyOrder[i];
    const e = world.enemyPool.items[idx];
    h.u32(e.uid);
    h.str(e.type);
    h.f64(e.x);
    h.f64(e.z);
    h.f64(e.dist);
    h.f64(e.hp);
    h.f64(e.armor);
    h.f64(e.armorBreakTimer);
    h.f64(e.shield);
    h.f64(e.slowTimer);
    h.f64(e.slowRatio);
    h.f64(e.stunTimer);
    if (e.frozenTimer > 0) h.f64(e.frozenTimer);
    h.f64(e.markTimer);
    h.f64(e.markVuln);
    h.u32(e.burrowed ? 1 : 0);
    h.f64(e.abilityTimer);
    h.f64(e.channelTimer);
    h.f64(e.bossPhase);
    h.f64(e.hexTargetId);
    h.f64(e.blockers);
    h.f64(e.meleeTimer);
    h.f64(e.heroBlockers);
    h.f64(e.heroDamageReduction);
    h.f64(e.heroMeleeTimer);
    h.f64(world.heroSystem.getEnemyBurnRemaining(idx, e.uid));
    h.f64(world.heroSystem.getEnemyBurnDps(idx, e.uid));
  }

  _activeProjOrder.length = 0;
  for (let i = 0; i < world.projectilePool.getActiveCount(); i++) {
    const idx = world.projectilePool.getActiveIndex(i);
    let pos = _activeProjOrder.length;
    _activeProjOrder.push(idx);
    while (pos > 0 && _activeProjOrder[pos - 1] > idx) {
      _activeProjOrder[pos] = _activeProjOrder[pos - 1];
      pos--;
    }
    _activeProjOrder[pos] = idx;
  }
  h.u32(_activeProjOrder.length);
  for (let i = 0; i < _activeProjOrder.length; i++) {
    const p = world.projectilePool.items[_activeProjOrder[i]];
    h.f64(p.x);
    h.f64(p.z);
    h.f64(p.progress);
    h.f64(p.damage);
  }

  return h.hex();
}

/** Serializes a `SimReplayLog` to compact JSON. */
export function serializeSimReplay(replay: SimReplayLog): string {
  return JSON.stringify(replay);
}

function parseSimCommand(raw: unknown): SimCommand | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  switch (c.kind) {
    case 'startWave':
      return { kind: 'startWave' };
    case 'setAutoWave':
      return typeof c.enabled === 'boolean' ? { kind: 'setAutoWave', enabled: c.enabled } : null;
    case 'placeTower': {
      if (
        typeof c.col !== 'number' ||
        !Number.isFinite(c.col) ||
        typeof c.row !== 'number' ||
        !Number.isFinite(c.row) ||
        !isTowerType(c.towerType)
      ) {
        return null;
      }
      const mode = isTargetingMode(c.targetingMode) ? c.targetingMode : undefined;
      return mode
        ? { kind: 'placeTower', col: Math.floor(c.col), row: Math.floor(c.row), towerType: c.towerType, targetingMode: mode }
        : { kind: 'placeTower', col: Math.floor(c.col), row: Math.floor(c.row), towerType: c.towerType };
    }
    case 'placeTowerOnPlot': {
      if (typeof c.plotIndex !== 'number' || !Number.isFinite(c.plotIndex) || !isTowerType(c.towerType)) {
        return null;
      }
      const mode = isTargetingMode(c.targetingMode) ? c.targetingMode : undefined;
      return mode
        ? { kind: 'placeTowerOnPlot', plotIndex: Math.floor(c.plotIndex), towerType: c.towerType, targetingMode: mode }
        : { kind: 'placeTowerOnPlot', plotIndex: Math.floor(c.plotIndex), towerType: c.towerType };
    }
    case 'upgradeTower':
      return typeof c.towerId === 'number' && Number.isFinite(c.towerId)
        ? { kind: 'upgradeTower', towerId: Math.floor(c.towerId) }
        : null;
    case 'specializeTower':
      return typeof c.towerId === 'number' && Number.isSafeInteger(c.towerId) &&
        typeof c.specializationId === 'string' && branchIds.has(c.specializationId)
        ? { kind: 'specializeTower', towerId: c.towerId, specializationId: c.specializationId } : null;
    case 'buyTowerAbility':
      return typeof c.towerId === 'number' && Number.isSafeInteger(c.towerId) &&
        typeof c.abilityId === 'string' && towerAbilityIds.has(c.abilityId)
        ? { kind: 'buyTowerAbility', towerId: c.towerId, abilityId: c.abilityId } : null;
    case 'sellTower':
      return typeof c.towerId === 'number' && Number.isFinite(c.towerId)
        ? { kind: 'sellTower', towerId: Math.floor(c.towerId) }
        : null;
    case 'setTargeting':
      return typeof c.towerId === 'number' && Number.isFinite(c.towerId) && isTargetingMode(c.mode)
        ? { kind: 'setTargeting', towerId: Math.floor(c.towerId), mode: c.mode }
        : null;
    case 'setRally':
      return typeof c.towerId === 'number' &&
        Number.isFinite(c.towerId) &&
        typeof c.x === 'number' &&
        Number.isFinite(c.x) &&
        typeof c.z === 'number' &&
        Number.isFinite(c.z)
        ? { kind: 'setRally', towerId: Math.floor(c.towerId), x: c.x, z: c.z }
        : null;
    case 'moveHero':
      return typeof c.x === 'number' && Number.isFinite(c.x) && typeof c.z === 'number' && Number.isFinite(c.z)
        ? { kind: 'moveHero', x: c.x, z: c.z }
        : null;
    case 'castHeroSkill': {
      if (c.slot !== 0 && c.slot !== 1) return null;
      const hasX = c.x !== undefined;
      const hasZ = c.z !== undefined;
      if (hasX !== hasZ) return null;
      if (hasX && (typeof c.x !== 'number' || !Number.isFinite(c.x) || typeof c.z !== 'number' || !Number.isFinite(c.z))) {
        return null;
      }
      return hasX
        ? { kind: 'castHeroSkill', slot: c.slot, x: c.x as number, z: c.z as number }
        : { kind: 'castHeroSkill', slot: c.slot };
    }
    case 'useItem':
      if (!isItemId(c.id)) return null;
      if (ITEMS[c.id].target === 'self') return { kind: 'useItem', id: c.id };
      return typeof c.x === 'number' && Number.isFinite(c.x) && typeof c.z === 'number' && Number.isFinite(c.z)
        ? { kind: 'useItem', id: c.id, x: c.x, z: c.z } : null;
    case 'castAbility': {
      if (!isAbilityId(c.id)) return null;
      const hasX = c.x !== undefined;
      const hasZ = c.z !== undefined;
      if (hasX !== hasZ) return null;
      if (hasX && (typeof c.x !== 'number' || !Number.isFinite(c.x) || typeof c.z !== 'number' || !Number.isFinite(c.z))) {
        return null;
      }
      if (ABILITY_DEFS[c.id].requiresTarget && !hasX) return null;
      return hasX
        ? { kind: 'castAbility', id: c.id, x: c.x as number, z: c.z as number }
        : { kind: 'castAbility', id: c.id };
    }
    case 'startEndlessFromStart':
      return { kind: 'startEndlessFromStart' };
    case 'enterEndless':
      return { kind: 'enterEndless' };
    default:
      return null;
  }
}

function sanitizeReplayModifiers(raw: unknown): RunModifiers {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NEUTRAL_RUN_MODIFIERS;
  const r = raw as Record<string, unknown>;
  const optNum = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const banned = Array.isArray(r.bannedTowers) ? r.bannedTowers.filter(isTowerType) : [];
  const rates: Partial<Record<TowerType, number>> = {};
  if (r.towerFireRateMul && typeof r.towerFireRateMul === 'object' && !Array.isArray(r.towerFireRateMul)) {
    for (const [k, v] of Object.entries(r.towerFireRateMul)) {
      if (isTowerType(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) rates[k] = v;
    }
  }
  const patch: RunModifierPatch = {
    startGoldBonus: optNum(r.startGoldBonus),
    startGoldMul: optNum(r.startGoldMul),
    bonusLives: optNum(r.bonusLives),
    maxLives:
      typeof r.maxLives === 'number' && Number.isFinite(r.maxLives) && r.maxLives >= 1
        ? Math.floor(r.maxLives)
        : null,
    abilityCooldownMul: optNum(r.abilityCooldownMul),
    killGoldMul: optNum(r.killGoldMul),
    waveBonusMul: optNum(r.waveBonusMul),
    towerFireRateMul: rates,
    enemySpeedMul: optNum(r.enemySpeedMul),
    enemyHpMul: optNum(r.enemyHpMul),
    bannedTowers: banned,
    abilitiesDisabled: r.abilitiesDisabled === true,
    itemsDisabled: r.itemsDisabled === true,
    itemUseCap: optNum(r.itemUseCap),
    // Older recordings used full keep repairs and only the explicit per-slot cap.
    marketDifficulty: r.marketDifficulty === 'normal' || r.marketDifficulty === 'hard' ? r.marketDifficulty : 'easy',
    championWaves: r.championWaves === true,
    heroRespawnMul: optNum(r.heroRespawnMul),
  };
  return combineRunModifiers(patch);
}

/**
 * Safely parses and validates a serialized JSON string (or parsed object) into a `SimReplayLog`.
 * Never throws; returns `null` if invalid or corrupt.
 */
export function parseSimReplay(input: unknown): SimReplayLog | null {
  let obj: unknown = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const r = obj as Record<string, unknown>;
  if (r.version !== SIM_REPLAY_VERSION) return null;
  if (typeof r.levelId !== 'string' || r.levelId.length === 0) return null;
  if (typeof r.seed !== 'number' || !Number.isFinite(r.seed)) return null;
  if (!Array.isArray(r.commands)) return null;

  let hero: SimReplayHeroConfig | null = null;
  if (r.hero !== null && r.hero !== undefined) {
    if (typeof r.hero !== 'object' || Array.isArray(r.hero)) return null;
    const h = r.hero as Record<string, unknown>;
    if (!isHeroId(h.heroId)) return null;
    const level =
      typeof h.level === 'number' && Number.isFinite(h.level) ? Math.max(1, Math.min(20, Math.floor(h.level))) : 1;
    const skills: string[] = [];
    if (Array.isArray(h.skills)) {
      const seen = new Set<string>();
      for (let k = 0; k < h.skills.length; k++) {
        const sid: unknown = h.skills[k];
        if (typeof sid !== 'string' || seen.has(sid)) continue;
        if (getHeroSkillNode(h.heroId, sid)) {
          seen.add(sid);
          skills.push(sid);
        }
      }
    }
    hero = { heroId: h.heroId, level, skills };
  }

  const commands: StampedSimCommand[] = [];
  for (let i = 0; i < r.commands.length; i++) {
    const rawEntry: unknown = r.commands[i];
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return null;
    const entry = rawEntry as Record<string, unknown>;
    if (typeof entry.tick !== 'number' || !Number.isFinite(entry.tick) || entry.tick < 0) return null;
    const seq = typeof entry.seq === 'number' && Number.isFinite(entry.seq) ? Math.max(0, Math.floor(entry.seq)) : i;
    const cmd = parseSimCommand(entry.command);
    if (!cmd) return null;
    commands.push({ tick: Math.floor(entry.tick), seq, command: cmd });
  }
  commands.sort((a, b) => a.tick - b.tick || a.seq - b.seq);

  const sumRaw =
    r.summary && typeof r.summary === 'object' && !Array.isArray(r.summary)
      ? (r.summary as Record<string, unknown>)
      : {};
  const lastCmdTick = commands.length > 0 ? commands[commands.length - 1].tick : 0;
  const totalTicks =
    typeof sumRaw.totalTicks === 'number' && Number.isFinite(sumRaw.totalTicks) && sumRaw.totalTicks >= 0
      ? Math.max(lastCmdTick, Math.floor(sumRaw.totalTicks))
      : lastCmdTick;
  const outcome =
    sumRaw.outcome === 'won' || sumRaw.outcome === 'lost' || sumRaw.outcome === 'ongoing'
      ? sumRaw.outcome
      : 'ongoing';
  const starsRaw = sumRaw.stars;
  const stars: 0 | 1 | 2 | 3 =
    starsRaw === 1 || starsRaw === 2 || starsRaw === 3 ? starsRaw : 0;
  const intOr0 = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;

  const modifiers = sanitizeReplayModifiers(r.modifiers);
  return {
    version: SIM_REPLAY_VERSION,
    levelId: r.levelId,
    seed: r.seed >>> 0,
    modifiers,
    itemBelt: modifiers.itemsDisabled ? {} : cleanBelt(r.itemBelt, modifiers.itemUseCap),
    hero,
    commands,
    summary: {
      totalTicks,
      outcome,
      lives: intOr0(sumRaw.lives),
      startingLives: Math.max(1, intOr0(sumRaw.startingLives) || BALANCE.startingLives),
      gold: intOr0(sumRaw.gold),
      stars,
      waveReached: intOr0(sumRaw.waveReached),
      enemiesKilled: intOr0(sumRaw.enemiesKilled),
      stateHash: typeof sumRaw.stateHash === 'string' ? sumRaw.stateHash : '',
    },
  };
}

/** Max fixed ticks executed in one `SimReplayPlayer.stepFrame` call (supports up to 8x fast-forward). */
const MAX_REPLAY_STEPS_PER_FRAME = 48;

export interface ReplayVerificationResult {
  readonly matchesOutcome: boolean;
  readonly matchesHash: boolean;
  readonly actualOutcome: 'ongoing' | 'won' | 'lost';
  readonly expectedOutcome: 'ongoing' | 'won' | 'lost';
  readonly actualHash: string;
  readonly expectedHash: string;
}

function normalizeReplayLog(replay: SimReplayLog): SimReplayLog {
  let needsSort = false;
  for (let i = 1; i < replay.commands.length; i++) {
    const prev = replay.commands[i - 1];
    const cur = replay.commands[i];
    if (cur.tick < prev.tick || (cur.tick === prev.tick && cur.seq < prev.seq)) {
      needsSort = true;
      break;
    }
  }
  const commands = needsSort
    ? [...replay.commands].sort((a, b) => a.tick - b.tick || a.seq - b.seq)
    : replay.commands;
  const lastCmdTick = commands.length > 0 ? Math.max(0, Math.floor(commands[commands.length - 1].tick)) : 0;
  const rawTotal = replay.summary.totalTicks;
  const safeTotal =
    typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal >= 0
      ? Math.max(lastCmdTick, Math.floor(rawTotal))
      : lastCmdTick;
  if (!needsSort && safeTotal === rawTotal) return replay;
  return {
    ...replay,
    commands,
    summary: safeTotal === rawTotal ? replay.summary : { ...replay.summary, totalTicks: safeTotal },
  };
}

/**
 * Interactive deterministic replay controller for UI playback, fast-forward (`1x`–`8x`),
 * timeline scrubbing (`seekToTick`), and headless verification (`runToEnd` / `verifyFinalState`).
 */
export class SimReplayPlayer {
  readonly level: LevelDef;
  readonly replay: SimReplayLog;
  readonly events: EventBus;
  world!: SimWorld;
  /** Default playback speed (`1`..`8`) used when `stepFrame` omits `speedMultiplier`. */
  speed = 1;
  /** Default pause state used when `stepFrame` omits `paused`. */
  paused = false;

  private cmdIndex = 0;
  private accumulator = 0;
  private resetGen = 0;
  private disposed = false;

  constructor(level: LevelDef, replay: SimReplayLog, events: EventBus = new EventBus()) {
    this.level = level;
    this.replay = normalizeReplayLog(replay);
    this.events = events;
    this.reset(true);
  }

  /** Sets default replay speed (`0.25`..`8`) and returns the clamped multiplier. */
  setSpeed(speed: number): number {
    if (Number.isFinite(speed) && speed > 0) {
      this.speed = Math.max(0.25, Math.min(8, speed));
    }
    return this.speed;
  }

  /** Cycles replay speed `1x -> 2x -> 3x -> 4x -> 1x` and returns the new multiplier. */
  cycleSpeed(): number {
    if (this.speed < 2) this.speed = 2;
    else if (this.speed < 3) this.speed = 3;
    else if (this.speed < 4) this.speed = 4;
    else this.speed = 1;
    return this.speed;
  }

  get currentTick(): number {
    return this.world.tick;
  }

  get totalTicks(): number {
    return this.replay.summary.totalTicks;
  }

  get totalCommands(): number {
    return this.replay.commands.length;
  }

  get appliedCommands(): number {
    return this.cmdIndex;
  }

  get progress(): number {
    if (this.totalTicks <= 0) return 1;
    return Math.max(0, Math.min(1, this.world.tick / this.totalTicks));
  }

  get finished(): boolean {
    if (this.disposed) return true;
    if (this.world.tick >= this.totalTicks && this.cmdIndex >= this.replay.commands.length) {
      return true;
    }
    if (this.world.outcome === 'lost') return true;
    if (this.world.outcome === 'won') {
      for (let i = this.cmdIndex; i < this.replay.commands.length; i++) {
        if (this.replay.commands[i].command.kind === 'enterEndless') return false;
      }
      return true;
    }
    return false;
  }

  private createWorld(): SimWorld {
    return new SimWorld(this.level, this.events, this.replay.modifiers, {
      heroId: this.replay.hero?.heroId ?? null,
      heroLevel: this.replay.hero?.level ?? 1,
      heroSkills: this.replay.hero?.skills ?? [],
      seed: this.replay.seed,
      itemBelt: this.replay.itemBelt,
      recordCommands: false,
    });
  }

  /** Flushes all commands scheduled for `this.world.tick` (or earlier) in strict `(tick, seq)` order. */
  flushCommandsForCurrentTick(): number {
    let applied = 0;
    const gen = this.resetGen;
    const cmds = this.replay.commands;
    while (this.cmdIndex < cmds.length && cmds[this.cmdIndex].tick <= this.world.tick) {
      const cmd = cmds[this.cmdIndex].command;
      this.cmdIndex++;
      this.world.applyCommand(cmd);
      applied++;
      if (this.resetGen !== gen) break;
    }
    return applied;
  }

  /** Resets playback back to tick `0` and applies any pre-wave `tick === 0` commands. */
  reset(emitInitialEvents = true): void {
    this.resetGen++;
    this.disposed = false;
    this.world?.dispose();
    this.cmdIndex = 0;
    this.accumulator = 0;
    const prevMuted = this.events.muted;
    if (!emitInitialEvents) this.events.muted = true;
    try {
      this.world = this.createWorld();
      this.flushCommandsForCurrentTick();
    } finally {
      this.events.muted = prevMuted;
    }
  }

  /** Advances replay by up to `count` fixed 60 Hz ticks, dispatching tick-stamped commands at exact boundaries. */
  stepTicks(count = 1): number {
    if (this.disposed) return 0;
    const steps = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    const gen = this.resetGen;
    let executed = 0;
    for (let i = 0; i < steps; i++) {
      this.flushCommandsForCurrentTick();
      if (this.resetGen !== gen || this.finished) break;
      if (this.world.outcome !== 'ongoing') {
        if (this.world.outcome === 'won') {
          this.world.tick++;
          executed++;
          this.flushCommandsForCurrentTick();
          if (this.resetGen !== gen) break;
          continue;
        }
        break;
      }
      this.world.fixedTick(BALANCE.fixedDt);
      executed++;
      if (this.resetGen !== gen) break;
      this.flushCommandsForCurrentTick();
      if (this.resetGen !== gen) break;
    }
    return executed;
  }

  /**
   * Frame-driven stepping for Pixi / RAF loops (`speed` supports `1`, `2`, `3`, `4`, `8`, etc.).
   * Returns `{ alpha, ticksExecuted, currentTick, finished }` for smooth render interpolation.
   */
  stepFrame(
    rawDt: number,
    speedMultiplier = this.speed,
    paused = this.paused,
  ): { alpha: number; ticksExecuted: number; currentTick: number; finished: boolean } {
    const safeDt = Number.isFinite(rawDt) ? Math.min(Math.max(0, rawDt), BALANCE.maxFrameDt) : 0;
    const speed = Number.isFinite(speedMultiplier) ? Math.max(0, Math.min(8, speedMultiplier)) : 1;
    let ticksExecuted = 0;

    if (!paused && !this.finished && speed > 0) {
      const wasPlayerPaused = this.paused;
      const gen = this.resetGen;
      this.accumulator += safeDt * speed;
      while (
        this.resetGen === gen &&
        this.accumulator >= BALANCE.fixedDt &&
        ticksExecuted < MAX_REPLAY_STEPS_PER_FRAME &&
        !this.finished &&
        !(this.paused && !wasPlayerPaused)
      ) {
        this.accumulator -= BALANCE.fixedDt;
        const ran = this.stepTicks(1);
        ticksExecuted += ran;
        if (this.resetGen !== gen) break;
        if (ran === 0) {
          this.accumulator = 0;
          break;
        }
      }
      if (this.accumulator > 0.25) this.accumulator = 0.25;
    }

    const alpha = !this.finished ? Math.min(1, Math.max(0, this.accumulator / BALANCE.fixedDt)) : 0;
    return {
      alpha,
      ticksExecuted,
      currentTick: this.world.tick,
      finished: this.finished,
    };
  }

  /**
   * Scrubs forward or backward to `targetTick` (`0..totalTicks`).
   * Mutes `this.events` during fast-forward / rewind rebuilds so audio/FX listeners aren't flooded.
   */
  seekToTick(targetTick: number): void {
    const clamped = Number.isFinite(targetTick)
      ? Math.max(0, Math.min(this.totalTicks, Math.floor(targetTick)))
      : 0;
    this.accumulator = 0;

    const prevMuted = this.events.muted;
    this.events.muted = true;
    try {
      if (this.disposed || clamped < this.world.tick) {
        this.reset(false);
      }
      if (clamped === this.world.tick) {
        this.flushCommandsForCurrentTick();
      } else if (clamped > this.world.tick) {
        this.stepTicks(clamped - this.world.tick);
      }
    } finally {
      this.events.muted = prevMuted;
    }
  }

  /** Steps all remaining ticks to `totalTicks` and returns verification results against `replay.summary`. */
  runToEnd(): ReplayVerificationResult {
    while (!this.finished) {
      const ran = this.stepTicks(1);
      if (ran === 0) break;
    }
    this.flushCommandsForCurrentTick();
    return this.verifyState();
  }

  /** Compares current `world` outcome and state hash against `replay.summary`. */
  verifyState(): ReplayVerificationResult {
    const actualHash = computeSimStateHash(this.world);
    const expectedHash = this.replay.summary.stateHash;
    return {
      matchesOutcome: this.world.outcome === this.replay.summary.outcome,
      matchesHash: expectedHash.length > 0 ? actualHash === expectedHash : true,
      actualOutcome: this.world.outcome,
      expectedOutcome: this.replay.summary.outcome,
      actualHash,
      expectedHash,
    };
  }

  /** Releases all pooled entities and subsystems in `this.world` when playback is closed. */
  dispose(): void {
    this.disposed = true;
    this.accumulator = 0;
    this.world?.dispose();
  }
}
