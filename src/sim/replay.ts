import { EventBus } from '../core/eventBus.ts';
import type {
  AbilityId,
  HeroId,
  HeroSkillSlot,
  TargetingMode,
  TowerType,
} from '../core/types.ts';
import { ABILITY_IDS } from '../data/abilities.ts';
import { BALANCE } from '../data/balance.ts';
import { isHeroId } from '../data/heroes.ts';
import type { LevelDef } from '../data/levels/types.ts';
import {
  combineRunModifiers,
  NEUTRAL_RUN_MODIFIERS,
  type RunModifierPatch,
  type RunModifiers,
} from '../data/runModifiers.ts';
import { TOWER_DEFS } from '../data/towers.ts';
import { SimWorld } from './world.ts';

export const SIM_REPLAY_VERSION = 1 as const;

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
  | { readonly kind: 'sellTower'; readonly towerId: number }
  | { readonly kind: 'setTargeting'; readonly towerId: number; readonly mode: TargetingMode }
  | { readonly kind: 'setRally'; readonly towerId: number; readonly x: number; readonly z: number }
  | { readonly kind: 'moveHero'; readonly x: number; readonly z: number }
  | { readonly kind: 'castHeroSkill'; readonly slot: HeroSkillSlot; readonly x?: number; readonly z?: number }
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

  const ws = world.waveSystem;
  h.str(ws.state);
  h.f64(ws.currentWaveIndex);
  h.f64(ws.interWaveTimer);
  h.f64(ws.waveElapsed);
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
    h.str(t.type);
    h.u32(t.tier);
    h.str(t.targetingMode);
    h.f64(t.cooldownTimer);
    h.f64(t.stunTimer);
    h.f64(t.totalDamageDealt);
    h.u32(t.kills);
    h.u32(t.shotCount);
  }

  const barracks = world.soldierSystem.barracks;
  h.u32(barracks.length);
  for (let i = 0; i < barracks.length; i++) {
    const b = barracks[i];
    h.u32(b.towerId);
    h.f64(b.rallyX);
    h.f64(b.rallyZ);
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
  }

  const hero = world.hero;
  if (hero) {
    h.u32(1);
    h.str(hero.heroId);
    h.u32(hero.level);
    h.str(hero.state);
    h.f64(hero.x);
    h.f64(hero.z);
    h.f64(hero.hp);
    h.f64(hero.respawnTimer);
    h.f64(hero.skillCooldowns[0]);
    h.f64(hero.skillCooldowns[1]);
    h.f64(hero.totalDamageDealt);
    h.u32(hero.kills);
    h.u32(world.heroSystem.runXp);
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

  const burnZones = world.projectileSystem.getBurnZones();
  h.u32(world.projectileSystem.getActiveBurnZoneCount());
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
    _activeEnemyOrder.push(world.enemyPool.getActiveIndex(i));
  }
  _activeEnemyOrder.sort((ia, ib) => world.enemyPool.items[ia].uid - world.enemyPool.items[ib].uid);
  h.u32(_activeEnemyOrder.length);
  for (let i = 0; i < _activeEnemyOrder.length; i++) {
    const e = world.enemyPool.items[_activeEnemyOrder[i]];
    h.u32(e.uid);
    h.str(e.type);
    h.f64(e.x);
    h.f64(e.z);
    h.f64(e.dist);
    h.f64(e.hp);
    h.f64(e.shield);
    h.f64(e.slowRatio);
    h.f64(e.stunTimer);
  }

  _activeProjOrder.length = 0;
  for (let i = 0; i < world.projectilePool.getActiveCount(); i++) {
    _activeProjOrder.push(world.projectilePool.getActiveIndex(i));
  }
  _activeProjOrder.sort((a, b) => a - b);
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
      const hasCoords =
        typeof c.x === 'number' && Number.isFinite(c.x) && typeof c.z === 'number' && Number.isFinite(c.z);
      return hasCoords
        ? { kind: 'castHeroSkill', slot: c.slot, x: c.x as number, z: c.z as number }
        : { kind: 'castHeroSkill', slot: c.slot };
    }
    case 'castAbility': {
      if (!isAbilityId(c.id)) return null;
      const hasCoords =
        typeof c.x === 'number' && Number.isFinite(c.x) && typeof c.z === 'number' && Number.isFinite(c.z);
      return hasCoords
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
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const banned = Array.isArray(r.bannedTowers) ? r.bannedTowers.filter(isTowerType) : [];
  const rates: Partial<Record<TowerType, number>> = {};
  if (r.towerFireRateMul && typeof r.towerFireRateMul === 'object' && !Array.isArray(r.towerFireRateMul)) {
    for (const [k, v] of Object.entries(r.towerFireRateMul)) {
      if (isTowerType(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) rates[k] = v;
    }
  }
  const patch: RunModifierPatch = {
    startGoldBonus: num(r.startGoldBonus, 0),
    startGoldMul: Math.max(0, num(r.startGoldMul, 1)),
    bonusLives: Math.floor(num(r.bonusLives, 0)),
    maxLives:
      typeof r.maxLives === 'number' && Number.isFinite(r.maxLives)
        ? Math.max(1, Math.floor(r.maxLives))
        : null,
    abilityCooldownMul: Math.max(0.1, num(r.abilityCooldownMul, 1)),
    killGoldMul: Math.max(0, num(r.killGoldMul, 1)),
    waveBonusMul: Math.max(0, num(r.waveBonusMul, 1)),
    towerFireRateMul: rates,
    enemySpeedMul: Math.max(0.1, num(r.enemySpeedMul, 1)),
    enemyHpMul: Math.max(0.1, num(r.enemyHpMul, 1)),
    bannedTowers: banned,
    abilitiesDisabled: r.abilitiesDisabled === true,
    championWaves: r.championWaves === true,
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
    const skills = Array.isArray(h.skills) ? h.skills.filter((x): x is string => typeof x === 'string') : [];
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

  return {
    version: SIM_REPLAY_VERSION,
    levelId: r.levelId,
    seed: r.seed >>> 0,
    modifiers: sanitizeReplayModifiers(r.modifiers),
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

/**
 * Interactive deterministic replay controller for UI playback, fast-forward (`1x`–`8x`),
 * timeline scrubbing (`seekToTick`), and headless verification (`runToEnd` / `verifyFinalState`).
 */
export class SimReplayPlayer {
  readonly level: LevelDef;
  readonly replay: SimReplayLog;
  readonly events: EventBus;
  world!: SimWorld;

  private cmdIndex = 0;
  private accumulator = 0;

  constructor(level: LevelDef, replay: SimReplayLog, events: EventBus = new EventBus()) {
    this.level = level;
    this.replay = replay;
    this.events = events;
    this.reset(true);
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
    if (this.cmdIndex < this.replay.commands.length) return false;
    return this.world.tick >= this.totalTicks || this.world.outcome !== 'ongoing';
  }

  private createWorld(): SimWorld {
    return new SimWorld(this.level, this.events, this.replay.modifiers, {
      heroId: this.replay.hero?.heroId ?? null,
      heroLevel: this.replay.hero?.level ?? 1,
      heroSkills: this.replay.hero?.skills ?? [],
      seed: this.replay.seed,
      recordCommands: false,
    });
  }

  /** Flushes all commands scheduled for `this.world.tick` (or earlier) in strict `(tick, seq)` order. */
  flushCommandsForCurrentTick(): number {
    let applied = 0;
    const cmds = this.replay.commands;
    while (this.cmdIndex < cmds.length && cmds[this.cmdIndex].tick <= this.world.tick) {
      this.world.applyCommand(cmds[this.cmdIndex].command);
      this.cmdIndex++;
      applied++;
    }
    return applied;
  }

  /** Resets playback back to tick `0` and applies any pre-wave `tick === 0` commands. */
  reset(emitInitialEvents = true): void {
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
    const steps = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    let executed = 0;
    for (let i = 0; i < steps; i++) {
      this.flushCommandsForCurrentTick();
      if (this.world.tick >= this.totalTicks && this.cmdIndex >= this.replay.commands.length) break;
      if (this.world.outcome !== 'ongoing') break;
      this.world.fixedTick(BALANCE.fixedDt);
      executed++;
      this.flushCommandsForCurrentTick();
    }
    return executed;
  }

  /**
   * Frame-driven stepping for Pixi / RAF loops (`speed` supports `1`, `2`, `3`, `4`, `8`, etc.).
   * Returns `{ alpha, ticksExecuted, currentTick, finished }` for smooth render interpolation.
   */
  stepFrame(
    rawDt: number,
    speedMultiplier = 1,
    paused = false,
  ): { alpha: number; ticksExecuted: number; currentTick: number; finished: boolean } {
    const safeDt = Number.isFinite(rawDt) ? Math.min(Math.max(0, rawDt), BALANCE.maxFrameDt) : 0;
    const speed = Number.isFinite(speedMultiplier) ? Math.max(0, Math.min(8, speedMultiplier)) : 1;
    let ticksExecuted = 0;

    if (!paused && !this.finished && speed > 0) {
      this.accumulator += safeDt * speed;
      while (this.accumulator >= BALANCE.fixedDt && ticksExecuted < MAX_REPLAY_STEPS_PER_FRAME && !this.finished) {
        const ran = this.stepTicks(1);
        this.accumulator -= BALANCE.fixedDt;
        ticksExecuted += ran;
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
    if (clamped === this.world.tick) {
      this.flushCommandsForCurrentTick();
      return;
    }

    const prevMuted = this.events.muted;
    this.events.muted = true;
    try {
      if (clamped < this.world.tick) {
        this.reset(false);
      }
      if (clamped > this.world.tick) {
        this.stepTicks(clamped - this.world.tick);
      }
    } finally {
      this.events.muted = prevMuted;
    }
  }

  /** Steps all remaining ticks to `totalTicks` and returns verification results against `replay.summary`. */
  runToEnd(): ReplayVerificationResult {
    while (!this.finished && this.world.outcome === 'ongoing') {
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
}
