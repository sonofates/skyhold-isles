import { ItemSystem } from './itemSystem.ts';
import { ITEMS, MARKET_RULES, type ItemCounts, type ItemId } from '../data/market.ts';
import type { EventBus } from '../core/eventBus.ts';
import { ObjectPool } from '../core/pool.ts';
import type { AbilityId, HeroId, HeroSkillSlot, TargetingMode, TowerMvpSummary, TowerType } from '../core/types.ts';
import { ABILITY_DEFS, type AbilityDef } from '../data/abilities.ts';
import { BALANCE } from '../data/balance.ts';
import { championLevel } from '../data/champions.ts';
import { HERO_MAX_LEVEL, isHeroId } from '../data/heroes.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { NEUTRAL_RUN_MODIFIERS, type RunModifiers } from '../data/runModifiers.ts';
import { computeStarsForLivesLost, type Difficulty } from '../data/stars.ts';
import { getTowerTierStats, specializationsFor, towerStats, TOWER_DEFS, type PurchasedSpecialization } from '../data/towers.ts';
import { AbilitySystem } from './abilitySystem.ts';
import { CombatSystem } from './combatSystem.ts';
import {
  createEnemyEntity,
  createProjectileEntity,
  type EnemyEntity,
  type ProjectileEntity,
  type TowerEntity,
} from './entities.ts';
import { EnemySystem } from './enemySystem.ts';
import { MapGrid } from './grid.ts';
import { HeroSystem, hashHeroSeed, type HeroEntity, type HeroRuntimeState } from './heroSystem.ts';
import { CompiledPath } from './path.ts';
import { ProjectileSystem } from './projectileSystem.ts';
import {
  computeSimStateHash,
  parseSimReplay,
  serializeSimReplay,
  SIM_REPLAY_VERSION,
  SimReplayPlayer,
  type ReplayVerificationResult,
  type SimCommand,
  type SimReplayHeroConfig,
  type SimReplayLog,
  type SimReplaySummary,
  type StampedSimCommand,
} from './replay.ts';
import { SoldierSystem } from './soldierSystem.ts';
import { SpatialHashGrid } from './spatialHash.ts';
import { WaveSystem } from './waveSystem.ts';

export {
  computeSimStateHash,
  parseSimReplay,
  serializeSimReplay,
  SIM_REPLAY_VERSION,
  SimReplayPlayer,
  type ReplayVerificationResult,
  type SimCommand,
  type SimReplayHeroConfig,
  type SimReplayLog,
  type SimReplaySummary,
  type StampedSimCommand,
};

export interface SimWorldOptions {
  readonly itemBelt?: ItemCounts;
  readonly spendItem?: (id: ItemId) => boolean;
  readonly heroId?: HeroId | null;
  readonly heroLevel?: number;
  readonly heroSkills?: readonly string[];
  readonly seed?: number;
  readonly modifiers?: RunModifiers;
  /** Automatically record tick-stamped `StampedSimCommand`s for every player action on this world. */
  readonly recordCommands?: boolean;
}

export interface AbilityRuntimeState {
  readonly id: AbilityId;
  readonly name: string;
  readonly cooldown: number;
  readonly maxCooldown: number;
  readonly ready: boolean;
  readonly usable: boolean;
  readonly requiresTarget: boolean;
  readonly radius: number;
  readonly activeRemaining: number;
  readonly disabled: boolean;
}

function isRunModifiers(val: RunModifiers | SimWorldOptions): val is RunModifiers {
  return 'startGoldMul' in val && 'enemyHpMul' in val;
}

const VALID_TARGETING_MODES: readonly TargetingMode[] = ['first', 'last', 'strongest', 'closest'];

function isValidTowerType(val: unknown): val is TowerType {
  return typeof val === 'string' && Object.prototype.hasOwnProperty.call(TOWER_DEFS, val);
}

function isValidTargetingMode(val: unknown): val is TargetingMode {
  return typeof val === 'string' && (VALID_TARGETING_MODES as readonly string[]).includes(val);
}

export function computeSellRefund(totalInvested: number): number {
  return Math.round(totalInvested * BALANCE.sellRefundRatio);
}

/**
 * Star rating for a win: based on lives LOST against the island's difficulty table
 * (`src/data/stars.ts`). Defaults reproduce the classic 20-life Breezy rule (18+ left = 3★, 10+ = 2★).
 */
export function computeStarRating(
  livesRemaining: number,
  difficulty: Difficulty = 'Breezy',
  startingLives: number = BALANCE.startingLives,
): 1 | 2 | 3 {
  return computeStarsForLivesLost(startingLives - livesRemaining, difficulty);
}

export class SimWorld {
  readonly level: LevelDef;
  readonly grid: MapGrid;
  readonly groundPath: CompiledPath;
  /** Extra spawn lanes (level.extraGroundPaths), compiled like the main road. */
  readonly extraGroundPaths: readonly CompiledPath[];
  readonly flightPath: CompiledPath;
  readonly spatialHash: SpatialHashGrid;
  readonly enemyPool: ObjectPool<EnemyEntity>;
  readonly projectilePool: ObjectPool<ProjectileEntity>;
  readonly enemySystem: EnemySystem;
  readonly projectileSystem: ProjectileSystem;
  readonly combatSystem: CombatSystem;
  readonly waveSystem: WaveSystem;
  readonly itemSystem: ItemSystem;
  readonly abilitySystem: AbilitySystem;
  /** Barracks soldiers (idle on islands without a barracks). */
  readonly soldierSystem: SoldierSystem;
  /** Deterministic hero system (idle when no hero is selected for the run). */
  readonly heroSystem: HeroSystem;
  readonly events: EventBus;
  /** Workshop upgrades + challenge toggles applied to this run (neutral = classic rules). */
  readonly mods: RunModifiers;
  /** Deterministic uint32 seed used by this run. */
  readonly seed: number;
  /** Initial hero configuration for deterministic replay reconstruction (`null` when no hero). */
  readonly heroConfig: SimReplayHeroConfig | null;

  readonly towers: TowerEntity[] = [];
  private nextTowerId = 1;

  /** Number of 60 Hz `fixedTick` steps executed so far (`0` before wave 1 ticks). */
  tick = 0;
  gold: number;
  lives: number;
  /** Lives this run started with (stars are rated on lives lost from here). */
  readonly startingLives: number;
  enemiesKilledTotal = 0;
  outcome: 'ongoing' | 'won' | 'lost' = 'ongoing';

  /** Optional live observer fired whenever a command is appended to the replay log. */
  onCommandRecorded: ((entry: StampedSimCommand) => void) | null = null;
  private recordingCommands = false;
  private commandSeq = 0;
  private tickAbortGen = 0;
  private poolClearGen = 0;
  private readonly commandLog: StampedSimCommand[] = [];
  private readonly hoverCandidates: number[] = [];
  private readonly abilityStateCache: Partial<Record<AbilityId, AbilityRuntimeState>> = {};
  private abilitiesListCache: readonly [AbilityRuntimeState, AbilityRuntimeState] | null = null;

  constructor(
    baseLevel: LevelDef,
    events: EventBus,
    modsOrOptions: RunModifiers | SimWorldOptions = NEUTRAL_RUN_MODIFIERS,
    options?: SimWorldOptions,
  ) {
    const mods = isRunModifiers(modsOrOptions)
      ? modsOrOptions
      : (modsOrOptions.modifiers ?? NEUTRAL_RUN_MODIFIERS);
    const opts = isRunModifiers(modsOrOptions) ? options : modsOrOptions;
    // Champion Host rewrites the story waves (a copy; the shared level data stays untouched).
    const level = mods.championWaves ? championLevel(baseLevel) : baseLevel;
    this.itemSystem = new ItemSystem(opts?.itemBelt, opts?.spendItem, Math.min(mods.itemUseCap, MARKET_RULES.useCap[mods.marketDifficulty]));
    this.level = level;
    this.events = events;
    this.mods = mods;
    this.grid = new MapGrid(level);

    const layout = level.layout2d;
    if (layout) {
      // Plot map: traced polylines in world units (lane i = entrance i), see Level2DLayout.
      this.groundPath = CompiledPath.fromWorld(layout.paths[0] ?? [], BALANCE.tilePathTopY, true);
      this.extraGroundPaths = layout.paths
        .slice(1)
        .map((pts) => CompiledPath.fromWorld(pts, BALANCE.tilePathTopY, true));
      this.flightPath = CompiledPath.fromWorld(layout.flightPath, BALANCE.flyerHeight, false);
    } else {
      this.groundPath = new CompiledPath(
        level.pathWaypoints,
        level.cols,
        level.rows,
        BALANCE.tilePathTopY,
        true,
      );
      this.extraGroundPaths = (level.extraGroundPaths ?? []).map(
        (wps) => new CompiledPath(wps, level.cols, level.rows, BALANCE.tilePathTopY, true),
      );
      this.flightPath = new CompiledPath(
        level.flightPath,
        level.cols,
        level.rows,
        BALANCE.flyerHeight,
        false,
      );
    }

    const worldW = layout ? layout.imageSize[0] / layout.pxPerUnit : level.cols * BALANCE.tileSize;
    const worldD = layout ? layout.imageSize[1] / layout.pxPerUnit : level.rows * BALANCE.tileSize;
    this.spatialHash = new SpatialHashGrid(worldW, worldD, BALANCE.pools.maxEnemies);
    this.enemyPool = new ObjectPool<EnemyEntity>(BALANCE.pools.maxEnemies, createEnemyEntity);
    this.projectilePool = new ObjectPool<ProjectileEntity>(
      BALANCE.pools.maxProjectiles,
      createProjectileEntity,
    );
    this.enemySystem = new EnemySystem(
      this.enemyPool,
      this.groundPath,
      this.flightPath,
      this.spatialHash,
      events,
      this.extraGroundPaths,
      level.hexRadius,
    );
    this.projectileSystem = new ProjectileSystem(
      this.projectilePool,
      this.enemyPool,
      this.spatialHash,
      this.enemySystem,
      events,
    );
    this.combatSystem = new CombatSystem(
      this.enemyPool,
      this.spatialHash,
      this.enemySystem,
      this.projectileSystem,
      events,
    );
    this.waveSystem = new WaveSystem(level, events);
    this.abilitySystem = new AbilitySystem(events);
    this.soldierSystem = new SoldierSystem(this.enemyPool, this.spatialHash, this.enemySystem, events);
    const rawHeroLevel = opts?.heroLevel;
    const resolvedHeroLevel =
      typeof rawHeroLevel === 'number' && Number.isFinite(rawHeroLevel)
        ? Math.max(1, Math.min(HERO_MAX_LEVEL, Math.floor(rawHeroLevel)))
        : 1;
    this.seed =
      typeof opts?.seed === 'number' && Number.isFinite(opts.seed)
        ? opts.seed >>> 0
        : hashHeroSeed(level.id, opts?.heroId ?? 'none', resolvedHeroLevel);
    this.heroConfig =
      opts?.heroId && isHeroId(opts.heroId)
        ? {
            heroId: opts.heroId,
            level: resolvedHeroLevel,
            skills: opts.heroSkills ? [...opts.heroSkills] : [],
          }
        : null;
    const heroCfg = this.heroConfig
      ? {
          heroId: this.heroConfig.heroId,
          level: this.heroConfig.level,
          skills: this.heroConfig.skills,
          seed: this.seed,
          respawnMul: mods.heroRespawnMul ?? 1,
        }
      : null;
    this.heroSystem = new HeroSystem(
      level.id,
      [this.groundPath, ...this.extraGroundPaths],
      this.enemyPool,
      this.spatialHash,
      this.enemySystem,
      this.projectileSystem,
      this.soldierSystem,
      events,
      heroCfg,
      this.grid,
    );
    this.recordingCommands = opts?.recordCommands === true;

    this.abilitySystem.cooldownMul = mods.abilityCooldownMul;
    this.combatSystem.towerRateMul = mods.towerFireRateMul;
    this.soldierSystem.towerRateMul = mods.towerFireRateMul;
    this.enemySystem.speedMul = mods.enemySpeedMul;

    const rawGold =
      Math.round(level.startingGold * (Number.isFinite(mods.startGoldMul) ? mods.startGoldMul : 1)) +
      (Number.isFinite(mods.startGoldBonus) ? Math.round(mods.startGoldBonus) : 0);
    this.gold = Number.isFinite(rawGold) ? Math.max(0, Math.min(10_000_000, rawGold)) : 0;
    const rawLives =
      mods.maxLives !== null && Number.isFinite(mods.maxLives)
        ? Math.floor(mods.maxLives)
        : BALANCE.startingLives + (Number.isFinite(mods.bonusLives) ? Math.round(mods.bonusLives) : 0);
    this.startingLives = Math.max(1, Math.min(100_000, rawLives));
    this.lives = this.startingLives;
  }

  private scaleWaveBonus(bonus: number): number {
    const mul = Number.isFinite(this.mods.waveBonusMul) ? this.mods.waveBonusMul : 1;
    if (mul === 1) return bonus;
    const scaled = Math.round(bonus * mul);
    return Number.isFinite(scaled) ? Math.max(0, Math.min(10_000_000, scaled)) : 0;
  }

  /** Elapsed deterministic simulation time in seconds (`tick * BALANCE.fixedDt`). */
  get elapsedSimSec(): number {
    return this.tick * BALANCE.fixedDt;
  }

  /** Whether player commands on this world are currently being recorded with tick stamps. */
  get isRecordingCommands(): boolean {
    return this.recordingCommands;
  }

  /** Enables or pauses tick-stamped command recording on this world. */
  setCommandRecording(enabled: boolean): void {
    this.recordingCommands = enabled;
  }

  /** Clears recorded commands without resetting simulation state. */
  clearRecordedCommands(): void {
    this.commandLog.length = 0;
    this.commandSeq = 0;
  }

  /** Read-only snapshot of all tick-stamped commands recorded on this world so far. */
  getRecordedCommands(): readonly StampedSimCommand[] {
    return this.commandLog;
  }

  private recordCommand(command: SimCommand): void {
    if (!this.recordingCommands) return;
    const entry: StampedSimCommand = {
      tick: this.tick,
      seq: this.commandSeq++,
      command,
    };
    this.commandLog.push(entry);
    this.onCommandRecorded?.(entry);
  }

  /** Executes a canonical `SimCommand` against this world (`true` when valid and applied). */
  applyCommand(command: SimCommand): boolean {
    switch (command.kind) {
      case 'startWave':
        return this.startNextWave();
      case 'setAutoWave':
        if (this.outcome === 'lost') return false;
        this.setAutoWave(command.enabled);
        return true;
      case 'placeTower':
        return (
          this.placeTower(command.col, command.row, command.towerType, command.targetingMode ?? 'first') !==
          null
        );
      case 'placeTowerOnPlot':
        return (
          this.placeTowerOnPlot(
            command.plotIndex,
            command.towerType,
            command.targetingMode ?? 'first',
          ) !== null
        );
      case 'upgradeTower':
        return this.upgradeTower(command.towerId);
      case 'specializeTower':
        return this.specializeTower(command.towerId, command.specializationId);
      case 'buyTowerAbility':
        return this.buyTowerAbility(command.towerId, command.abilityId);
      case 'sellTower':
        return this.sellTower(command.towerId) > 0;
      case 'setTargeting':
        return this.setTowerTargeting(command.towerId, command.mode);
      case 'setRally':
        return this.setRallyPoint(command.towerId, command.x, command.z);
      case 'moveHero':
        return this.commandHeroMove(command.x, command.z);
      case 'castHeroSkill':
        return this.castHeroSkill(command.slot, command.x ?? NaN, command.z ?? NaN);
      case 'useItem':
        return this.useItem(command.id, command.x, command.z);
      case 'castAbility':
        return this.castAbility(command.id, command.x ?? NaN, command.z ?? NaN);
      case 'startEndlessFromStart':
        return this.startEndlessFromStart();
      case 'enterEndless':
        return this.enterEndlessMode();
    }
  }

  /** Exports a self-contained deterministic `SimReplayLog` (including final state hash). */
  exportReplay(): SimReplayLog {
    return {
      version: SIM_REPLAY_VERSION,
      levelId: this.level.id,
      seed: this.seed,
      modifiers: {
        ...this.mods,
        towerFireRateMul: { ...this.mods.towerFireRateMul },
        bannedTowers: [...this.mods.bannedTowers],
      },
      itemBelt: this.itemSystem.initial,
      hero: this.heroConfig
        ? {
            heroId: this.heroConfig.heroId,
            level: this.heroConfig.level,
            skills: [...this.heroConfig.skills],
          }
        : null,
      commands: this.commandLog.map((e) => ({ tick: e.tick, seq: e.seq, command: { ...e.command } })),
      summary: {
        totalTicks: this.tick,
        outcome: this.outcome,
        lives: this.lives,
        startingLives: this.startingLives,
        gold: this.gold,
        stars: this.outcome === 'won' ? this.computeStars() : 0,
        waveReached: this.waveSystem.currentWaveOneBased,
        enemiesKilled: this.enemiesKilledTotal,
        stateHash: computeSimStateHash(this),
      },
    };
  }

  /** Star rating the run would earn if it were won right now. */
  computeStars(): 1 | 2 | 3 {
    return computeStarRating(this.lives - this.itemSystem.restoredLives, this.level.difficulty, this.startingLives);
  }

  setAutoWave(enabled: boolean): void {
    if (this.outcome === 'lost') return;
    const next = Boolean(enabled);
    const changed = this.waveSystem.autoWave !== next;
    if (changed) this.recordCommand({ kind: 'setAutoWave', enabled: next });
    this.waveSystem.setAutoWave(next);
  }

  /** Active hero entity in this run, or null when running without a hero. */
  get hero(): HeroEntity | null {
    return this.heroSystem.hero;
  }

  /** Orders the active hero to move along the ground road graph to `(x, z)`. */
  commandHeroMove(x: number, z: number): boolean {
    if (this.outcome !== 'ongoing') return false;
    if (!this.recordingCommands) return this.heroSystem.commandMove(x, z);
    return this.heroSystem.commandMove(x, z, () => {
      this.recordCommand({ kind: 'moveHero', x, z });
    });
  }

  /** Casts one of the active hero's two skills (`slot` = `0` or `1`). */
  castHeroSkill(slot: HeroSkillSlot, x = NaN, z = NaN): boolean {
    if (this.outcome !== 'ongoing') return false;
    if (!this.recordingCommands) return this.heroSystem.castSkill(slot, x, z, this.towers);
    const hasCoords = Number.isFinite(x) && Number.isFinite(z);
    return this.heroSystem.castSkill(slot, x, z, this.towers, () => {
      this.recordCommand(hasCoords ? { kind: 'castHeroSkill', slot, x, z } : { kind: 'castHeroSkill', slot });
    });
  }

  /** Snapshot of the active hero's HP, state, XP, and skill cooldowns (null when no hero). */
  getHeroState(): HeroRuntimeState | null {
    return this.heroSystem.getRuntimeState(this.outcome === 'ongoing');
  }

  /** Abilities are usable once the first wave has started, unless disabled by a challenge modifier. */
  canUseAbilities(): boolean {
    return (
      !this.mods.abilitiesDisabled &&
      this.outcome === 'ongoing' &&
      this.waveSystem.state !== 'preFirstWave'
    );
  }

  useItem(id: ItemId, x?: number, z?: number): boolean {
    return this.itemSystem.use(this, id, x, z, () => {
      const includeCoords =
        ITEMS[id].target !== 'self' &&
        typeof x === 'number' &&
        typeof z === 'number' &&
        Number.isFinite(x) &&
        Number.isFinite(z);
      this.recordCommand(includeCoords ? { kind: 'useItem', id, x, z } : { kind: 'useItem', id });
    });
  }

  castMeteor(x: number, z: number): boolean {
    if (!this.canUseAbilities()) return false;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !this.abilitySystem.canCast('meteor')) return false;
    this.recordCommand({ kind: 'castAbility', id: 'meteor', x, z });
    return this.abilitySystem.castMeteor(x, z, Math.max(1, this.waveSystem.currentWaveOneBased));
  }

  castOvercharge(): boolean {
    if (!this.canUseAbilities() || !this.abilitySystem.canCast('overcharge')) return false;
    this.recordCommand({ kind: 'castAbility', id: 'overcharge' });
    return this.abilitySystem.castOvercharge(this.towers);
  }

  /** Unified global ability cast (`'meteor'` at `(x, z)` or `'overcharge'`). */
  castAbility(id: AbilityId, x = NaN, z = NaN): boolean {
    if (id === 'meteor') return this.castMeteor(x, z);
    if (id === 'overcharge') return this.castOvercharge();
    return false;
  }

  /** Cooldown and usability state for a global ability (`'meteor'` | `'overcharge'`). */
  getAbilityState(id: AbilityId): AbilityRuntimeState {
    const def: AbilityDef = ABILITY_DEFS[id];
    const cd = this.abilitySystem.getCooldown(id);
    const maxCd = this.abilitySystem.getMaxCooldown(id);
    const ready = this.abilitySystem.canCast(id);
    const usable = ready && this.canUseAbilities();
    const activeRemaining = id === 'overcharge' ? this.abilitySystem.getOverchargeRemaining() : 0;
    const disabled = this.mods.abilitiesDisabled;

    const prev = this.abilityStateCache[id];
    if (
      prev !== undefined &&
      prev.cooldown === cd &&
      prev.maxCooldown === maxCd &&
      prev.ready === ready &&
      prev.usable === usable &&
      prev.activeRemaining === activeRemaining &&
      prev.disabled === disabled
    ) {
      return prev;
    }

    const next: AbilityRuntimeState = {
      id,
      name: def.name,
      cooldown: cd,
      maxCooldown: maxCd,
      ready,
      usable,
      requiresTarget: def.requiresTarget,
      radius: def.radius ?? 0,
      activeRemaining,
      disabled,
    };
    this.abilityStateCache[id] = next;
    return next;
  }

  /** Cooldown and usability state for all global abilities (`['meteor', 'overcharge']`). */
  getAbilitiesState(): readonly AbilityRuntimeState[] {
    const m = this.getAbilityState('meteor');
    const o = this.getAbilityState('overcharge');
    const prev = this.abilitiesListCache;
    if (prev !== null && prev[0] === m && prev[1] === o) {
      return prev;
    }
    const next: readonly [AbilityRuntimeState, AbilityRuntimeState] = [m, o];
    this.abilitiesListCache = next;
    return next;
  }

  /** Island card → Endless: the whole run is endless from wave 1 (no victory, no stars). */
  startEndlessFromStart(): boolean {
    if (this.outcome !== 'ongoing' || this.waveSystem.state !== 'preFirstWave') return false;
    this.recordCommand({ kind: 'startEndlessFromStart' });
    this.waveSystem.startEndlessFromStart();
    return true;
  }

  enterEndlessMode(): boolean {
    if (this.outcome !== 'won' || this.waveSystem.isEndless) return false;
    this.recordCommand({ kind: 'enterEndless' });
    this.outcome = 'ongoing';
    this.waveSystem.enterEndlessMode();
    return true;
  }

  getMvpTowerSummary(): TowerMvpSummary | null {
    if (this.towers.length === 0) return null;
    let best = this.towers[0];
    for (let i = 1; i < this.towers.length; i++) {
      const candidate = this.towers[i];
      if (
        candidate.totalDamageDealt > best.totalDamageDealt ||
        (candidate.totalDamageDealt === best.totalDamageDealt && candidate.kills > best.kills)
      ) {
        best = candidate;
      }
    }
    return {
      name: TOWER_DEFS[best.type].name,
      type: best.type,
      tier: best.tier,
      damageDealt: Math.round(best.totalDamageDealt),
      kills: best.kills,
    };
  }

  private readonly onStartWaveBonusFn = (bonus: number): void => {
    this.gold += this.scaleWaveBonus(bonus);
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
  };

  startNextWave(): boolean {
    if (this.outcome !== 'ongoing' || !this.waveSystem.canStartNextWave()) return false;
    this.recordCommand({ kind: 'startWave' });
    return this.waveSystem.startNextWave(this.onStartWaveBonusFn);
  }

  debugSkipToWave(waveOneBased: number): boolean {
    this.tickAbortGen++;
    this.poolClearGen++;
    this.waveSystem.abortStep();
    this.combatSystem.abortCurrentStep();
    this.projectilePool.clear();
    this.projectileSystem.clearBurnZones();
    this.abilitySystem.clearPending();
    this.heroSystem.clearTransientZones(false, this.towers, true);
    this.soldierSystem.clearCombatState(true);
    this.enemyPool.clear();
    this.spatialHash.clear();
    if (this.lives <= 0) {
      this.lives = this.startingLives;
    }
    this.outcome = 'ongoing';
    const ok = this.waveSystem.skipToWave(waveOneBased);
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    return ok;
  }

  private clearVictoryTransients(): void {
    this.tickAbortGen++;
    this.poolClearGen++;
    this.waveSystem.abortStep();
    this.combatSystem.abortCurrentStep();
    this.projectilePool.clear();
    this.projectileSystem.clearBurnZones();
    this.abilitySystem.clearPending();
    this.heroSystem.clearTransientZones(false, this.towers, true);
    this.soldierSystem.clearCombatState(true);
    this.enemyPool.clear();
    this.spatialHash.clear();
  }

  private clearDefeatTransients(): void {
    this.tickAbortGen++;
    this.waveSystem.abortStep();
    this.combatSystem.abortCurrentStep();
    this.projectilePool.clear();
    this.projectileSystem.clearBurnZones();
    this.abilitySystem.clearPending();
    this.heroSystem.clearTransientZones(false, this.towers, true);
    this.soldierSystem.clearCombatState(true);
  }

  /** Releases all pooled entities, ground zones, soldiers, gizmos, and spatial-hash buckets after a run. */
  dispose(): void {
    this.tickAbortGen++;
    this.poolClearGen++;
    this.waveSystem.abortStep();
    this.combatSystem.abortCurrentStep();
    this.heroSystem.clearTransientZones(true, this.towers, false);
    this.soldierSystem.clearAll();
    this.enemyPool.clear();
    this.projectilePool.clear();
    this.projectileSystem.clearBurnZones();
    this.abilitySystem.reset();
    this.spatialHash.clear();
    this.grid.resetOccupancy();
    this.towers.length = 0;
  }

  debugForceWin(): void {
    if (this.outcome !== 'ongoing') return;
    if (this.lives <= 0) this.lives = 1;
    const stars = this.computeStars();
    this.heroSystem.onVictory(stars);
    this.waveSystem.markFinished();
    this.clearVictoryTransients();
    this.outcome = 'won';
    this.events.emit('gameWon', {
      stars,
      livesRemaining: this.lives,
    });
  }

  debugForceLose(): void {
    if (this.outcome !== 'ongoing') return;
    this.lives = 0;
    this.clearDefeatTransients();
    this.outcome = 'lost';
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    this.events.emit('gameLost', {
      waveIndex: Math.max(0, this.waveSystem.currentWaveIndex),
      endless: this.waveSystem.isEndless,
    });
  }

  /** Tower types a challenge forbids this run. */
  isTowerBanned(type: TowerType): boolean {
    if (!isValidTowerType(type)) return false;
    return this.mods.bannedTowers.includes(type);
  }

  /**
   * True when `type` can be built and afforded at `(col, row)` right now
   * (checks run outcome, challenge bans, tile/plot occupancy, gold cost, and barracks road reach).
   */
  canPlaceTowerAt(col: number, row: number, type: TowerType): boolean {
    if (this.outcome !== 'ongoing') return false;
    if (!isValidTowerType(type)) return false;
    if (this.isTowerBanned(type)) return false;
    if (!this.grid.canPlaceTower(col, row)) return false;
    const stats = getTowerTierStats(type, 1);
    if (this.gold < stats.upgradeCost) return false;
    if (TOWER_DEFS[type].role === 'barracks') {
      const x = this.grid.siteWorldX(col, row);
      const z = this.grid.siteWorldZ(col, row);
      if (!this.soldierSystem.hasRoadInRange(x, z, stats.range)) return false;
    }
    return true;
  }

  private placeTowerInternal(
    col: number,
    row: number,
    type: TowerType,
    safeMode: TargetingMode,
    commandToRecord: SimCommand,
  ): TowerEntity | null {
    if (!this.canPlaceTowerAt(col, row, type)) return null;
    const stats = getTowerTierStats(type, 1);
    const x = this.grid.siteWorldX(col, row);
    const z = this.grid.siteWorldZ(col, row);

    this.gold -= stats.upgradeCost;
    const tower: TowerEntity = {
      id: this.nextTowerId++,
      col,
      row,
      x,
      z,
      type,
      tier: 1,
      totalInvested: stats.upgradeCost,
      targetingMode: safeMode,
      cooldownTimer: 0.15,
      stunTimer: 0,
      yaw: 0,
      prevYaw: 0,
      targetYaw: 0,
      recoil: 0,
      popAnimTimer: 0.32,
      totalDamageDealt: 0,
      kills: 0,
      auraRate: 0,
      auraRange: 0,
      shotCount: 0,
    };

    this.towers.push(tower);
    this.grid.setTowerAt(col, row, tower.id);
    this.recordCommand(commandToRecord);
    if (TOWER_DEFS[type].role === 'barracks') {
      this.combatSystem.applyBeaconAuras(this.towers);
      this.soldierSystem.addBarracks(tower);
    }

    this.events.emit('towerBuilt', {
      towerId: tower.id,
      type: tower.type,
      tier: tower.tier,
      x,
      z,
    });
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    return tower;
  }

  /**
   * Builds a tower on a site: a grass tile (col, row), or on plot levels plot `col` (row 0) —
   * see `placeTowerOnPlot`.
   */
  placeTower(
    col: number,
    row: number,
    type: TowerType,
    targetingMode: TargetingMode = 'first',
  ): TowerEntity | null {
    const safeMode: TargetingMode = isValidTargetingMode(targetingMode) ? targetingMode : 'first';
    return this.placeTowerInternal(
      col,
      row,
      type,
      safeMode,
      safeMode !== 'first'
        ? { kind: 'placeTower', col, row, towerType: type, targetingMode: safeMode }
        : { kind: 'placeTower', col, row, towerType: type },
    );
  }

  /** Plot levels: builds on plot `plotIndex` (one tower per plot; selling frees it). */
  placeTowerOnPlot(
    plotIndex: number,
    type: TowerType,
    targetingMode: TargetingMode = 'first',
  ): TowerEntity | null {
    if (!this.grid.isPlotMode) return null;
    const safeMode: TargetingMode = isValidTargetingMode(targetingMode) ? targetingMode : 'first';
    return this.placeTowerInternal(
      plotIndex,
      0,
      type,
      safeMode,
      safeMode !== 'first'
        ? { kind: 'placeTowerOnPlot', plotIndex, towerType: type, targetingMode: safeMode }
        : { kind: 'placeTowerOnPlot', plotIndex, towerType: type },
    );
  }

  upgradeTower(towerId: number): boolean {
    if (this.outcome !== 'ongoing') return false;
    const tower = this.getTowerById(towerId);
    if (!tower || tower.tier >= 3) return false;

    const nextTier = (tower.tier + 1) as 2 | 3;
    const nextStats = getTowerTierStats(tower.type, nextTier);
    if (this.gold < nextStats.upgradeCost) return false;

    this.gold -= nextStats.upgradeCost;
    tower.tier = nextTier;
    tower.totalInvested += nextStats.upgradeCost;
    tower.popAnimTimer = 0.32;
    this.recordCommand({ kind: 'upgradeTower', towerId });
    if (TOWER_DEFS[tower.type].role === 'barracks') this.soldierSystem.onUpgrade(tower);

    this.emitTowerUpgrade(tower);
    return true;
  }

  specializeTower(towerId: number, specializationId: string): boolean {
    const tower = this.getTowerById(towerId);
    if (this.outcome !== 'ongoing' || !this.grid.isPlotMode || !tower || tower.tier !== 3 || tower.specialization) return false;
    const branch = specializationsFor(tower).find(b => b.id === specializationId);
    if (!branch || this.gold < branch.cost) return false;
    const stats = { ...towerStats(tower), ...branch.changes, tier: 4 as const, upgradeCost: branch.cost };
    this.applyTowerPurchase(tower, { id: branch.id, abilities: [], stats }, branch.cost,
      { kind: 'specializeTower', towerId, specializationId });
    return true;
  }

  buyTowerAbility(towerId: number, abilityId: string): boolean {
    const tower = this.getTowerById(towerId);
    const current = tower?.specialization;
    if (this.outcome !== 'ongoing' || !tower || !current || current.abilities.includes(abilityId)) return false;
    const branch = specializationsFor(tower).find(b => b.id === current.id);
    const ability = branch?.abilities.find(a => a.id === abilityId);
    if (!ability || this.gold < ability.cost) return false;
    const next = {
      id: current.id,
      abilities: [...current.abilities, abilityId],
      stats: { ...current.stats, ...ability.changes },
    };
    this.applyTowerPurchase(tower, next, ability.cost, { kind: 'buyTowerAbility', towerId, abilityId });
    return true;
  }

  private applyTowerPurchase(tower: TowerEntity, next: PurchasedSpecialization, cost: number, command: SimCommand): void {
    this.gold -= cost;
    tower.totalInvested += cost;
    tower.specialization = next;
    tower.popAnimTimer = 0.32;
    // Both squads keep their current HP, posts and engagements. Subsequent blows and respawns
    // read this live profile. Branches preserve the base squad size, maximum HP and rally radius.
    if (tower.type === 'barracks') {
      const barracks = this.soldierSystem.getBarracks(tower.id);
      if (barracks) barracks.stats = next.stats;
    } else if (tower.type === 'beacon') {
      // Rally orders and soldier swings can both precede the next combat update.
      this.combatSystem.applyBeaconAuras(this.towers);
    }
    this.recordCommand(command);
    this.emitTowerUpgrade(tower);
  }

  private emitTowerUpgrade(tower: TowerEntity): void {
    this.events.emit('towerUpgraded', {
      towerId: tower.id,
      type: tower.type,
      tier: towerStats(tower).tier,
      x: tower.x,
      z: tower.z,
    });
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
  }

  sellTower(towerId: number): number {
    if (this.outcome !== 'ongoing') return 0;
    const idx = this.towers.findIndex((t) => t.id === towerId);
    if (idx === -1) return 0;

    const tower = this.towers[idx];
    const refund = computeSellRefund(tower.totalInvested);
    this.gold += refund;
    this.grid.clearTowerAt(tower.col, tower.row);
    this.towers.splice(idx, 1);
    // Every beacon lends rate (tier III also range): drop it now, or a rally set before the next
    // combat step could still use the sold beacon's range bonus and land outside the barracks reach.
    if (tower.type === 'beacon') this.combatSystem.applyBeaconAuras(this.towers);
    this.recordCommand({ kind: 'sellTower', towerId });
    if (TOWER_DEFS[tower.type].role === 'barracks') this.soldierSystem.removeBarracks(tower.id);

    this.events.emit('towerSold', {
      towerId: tower.id,
      type: tower.type,
      tier: towerStats(tower).tier,
      refund,
      x: tower.x,
      z: tower.z,
    });
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    return refund;
  }

  /**
   * Moves a barracks' rally point toward (x, z): clamped onto the road within the barracks range.
   * False if the tower is not a barracks (or the run is over).
   */
  setRallyPoint(towerId: number, x: number, z: number): boolean {
    if (this.outcome !== 'ongoing') return false;
    const tower = this.getTowerById(towerId);
    if (!tower || TOWER_DEFS[tower.type].role !== 'barracks') return false;
    if (!this.recordingCommands) return this.soldierSystem.setRally(tower, x, z);
    return this.soldierSystem.setRally(tower, x, z, () => {
      this.recordCommand({ kind: 'setRally', towerId, x, z });
    });
  }

  setTowerTargeting(towerId: number, mode: TargetingMode): boolean {
    if (this.outcome !== 'ongoing' || !isValidTargetingMode(mode)) return false;
    const tower = this.getTowerById(towerId);
    if (!tower) return false;
    if (tower.targetingMode !== mode) {
      tower.targetingMode = mode;
      this.recordCommand({ kind: 'setTargeting', towerId, mode });
    }
    return true;
  }

  getTowerById(towerId: number): TowerEntity | null {
    for (let i = 0; i < this.towers.length; i++) {
      if (this.towers[i].id === towerId) return this.towers[i];
    }
    return null;
  }

  private readonly getActiveEnemiesFn = (): number => this.enemyPool.getActiveCount();

  private readonly onWaveSpawnFn = (
    enemyType: EnemyEntity['type'],
    hpScale: number,
    elite: boolean,
    lane: number,
    groupHpScale: number,
  ): void => {
    const fx = this.waveSystem.getEndlessMutatorEffects();
    const spawned = this.enemySystem.spawnEnemy(
      enemyType,
      hpScale * this.mods.enemyHpMul * fx.hpMul,
      elite,
      lane,
      groupHpScale,
    );
    if (spawned) {
      spawned.reward = Math.max(
        1,
        Math.round(
          spawned.reward *
            this.waveSystem.getRewardMultiplier() *
            this.mods.killGoldMul *
            fx.killGoldMul,
        ),
      );
    }
  };

  private readonly onWaveBonusFn = (bonus: number, clearedWaves = 0): void => {
    this.gold += this.scaleWaveBonus(bonus);
    if (clearedWaves > 0) {
      this.heroSystem.onWaveCleared(clearedWaves);
    }
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
  };

  private readonly onWaveClearedOnlyFn = (clearedWaves = 1): void => {
    this.heroSystem.onWaveCleared(clearedWaves);
  };

  private readonly onAllClearedWinFn = (): void => {
    if (this.outcome === 'ongoing' && this.lives > 0 && !this.waveSystem.isEndless) {
      const stars = this.computeStars();
      this.heroSystem.onVictory(stars);
      this.clearVictoryTransients();
      this.outcome = 'won';
      this.events.emit('gameWon', {
        stars,
        livesRemaining: this.lives,
      });
    }
  };

  private readonly onEnemyLeakedFn = (leaked: EnemyEntity): void => {
    if (this.outcome !== 'ongoing') {
      if (leaked.blockers > 0) {
        leaked.blockers = 0;
        this.soldierSystem.blockedCount = Math.max(0, this.soldierSystem.blockedCount - 1);
      }
      leaked.heroBlockers = 0;
      leaked.heroDamageReduction = 0;
      return;
    }
    this.lives = Math.max(0, this.lives - leaked.livesCost);
    const justLost = this.lives <= 0;
    if (justLost) {
      this.clearDefeatTransients();
      this.outcome = 'lost';
    } else if (leaked.blockers > 0 || leaked.heroBlockers > 0) {
      if (leaked.blockers > 0) {
        leaked.blockers = 0;
        this.soldierSystem.blockedCount = Math.max(0, this.soldierSystem.blockedCount - 1);
      }
      leaked.heroBlockers = 0;
      leaked.heroDamageReduction = 0;
      this.events.emit('enemyUnblocked', {
        enemyId: leaked.uid,
        enemyType: leaked.type,
        x: leaked.x,
        y: leaked.y,
        z: leaked.z,
      });
    }
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    if (justLost && this.outcome === 'lost') {
      this.events.emit('gameLost', {
        waveIndex: Math.max(0, this.waveSystem.currentWaveIndex),
        endless: this.waveSystem.isEndless,
      });
    }
  };

  private readonly onEnemyKilledFn = (killed: EnemyEntity): void => {
    if (killed.blockers > 0) {
      killed.blockers = 0;
      this.soldierSystem.blockedCount = Math.max(0, this.soldierSystem.blockedCount - 1);
    }
    killed.heroBlockers = 0;
    killed.heroDamageReduction = 0;
    if (this.outcome !== 'ongoing') return;
    this.enemiesKilledTotal++;
    this.gold += killed.reward;
    this.heroSystem.onEnemyKilled(killed);
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
  };

  fixedTick(dt: number): void {
    if (this.outcome !== 'ongoing' || !Number.isFinite(dt) || dt <= 0) return;
    this.tick++;
    const gen = this.tickAbortGen;

    // Run + endless-wave modifiers for everything spawned this tick (incl. escorts, raiders, mites).
    const waveFx = this.waveSystem.getEndlessMutatorEffects();
    this.enemySystem.speedMul = this.mods.enemySpeedMul * waveFx.speedMul;
    this.enemySystem.armorBonus = waveFx.armorBonus;

    this.waveSystem.update(
      dt,
      this.getActiveEnemiesFn,
      this.onWaveSpawnFn,
      this.onWaveBonusFn,
      this.onAllClearedWinFn,
      this.onWaveClearedOnlyFn,
    );

    if (this.outcome !== 'ongoing' || this.tickAbortGen !== gen) return;

    const wsState = this.waveSystem.state;
    const isCombatActive =
      wsState === 'spawning' || wsState === 'clearing' || wsState === 'allSpawned';
    this.abilitySystem.update(
      dt,
      isCombatActive,
      this.enemyPool,
      this.spatialHash,
      this.enemySystem,
    );

    if (this.outcome !== 'ongoing' || this.tickAbortGen !== gen) return;

    const clearGen = this.poolClearGen;
    this.enemySystem.update(
      dt,
      this.onEnemyLeakedFn,
      this.onEnemyKilledFn,
      this.towers,
      this.waveSystem.getCurrentWaveHpScale() * this.mods.enemyHpMul * waveFx.hpMul,
    );

    if (this.poolClearGen !== clearGen) {
      this.enemyPool.clear();
      this.spatialHash.clear();
    }
    if (this.outcome !== 'ongoing' || this.tickAbortGen !== gen) return;

    this.waveSystem.checkCompletion(
      this.getActiveEnemiesFn,
      this.onWaveBonusFn,
      this.onAllClearedWinFn,
      this.onWaveClearedOnlyFn,
    );

    if (this.outcome !== 'ongoing' || this.tickAbortGen !== gen) return;

    const fireRateMul = this.abilitySystem.getFireRateMultiplier();
    this.soldierSystem.update(dt, this.towers, fireRateMul);
    if (this.outcome !== 'ongoing' || this.tickAbortGen !== gen) return;
    this.heroSystem.update(dt, this.towers, fireRateMul);
    if (this.outcome !== 'ongoing' || this.tickAbortGen !== gen) return;
    this.combatSystem.update(dt, this.towers, fireRateMul);
    if (this.outcome !== 'ongoing' || this.tickAbortGen !== gen) return;
    this.projectileSystem.update(dt, this.towers);
  }

  findHoveredEnemy(
    groundHitX: number,
    groundHitZ: number,
    flyerHitX: number,
    flyerHitZ: number,
  ): EnemyEntity | null {
    let best: EnemyEntity | null = null;
    let bestDistSq = Infinity;
    const hoverCandidates = this.hoverCandidates;

    this.spatialHash.query(flyerHitX, flyerHitZ, 1.4, hoverCandidates);
    for (let i = 0; i < hoverCandidates.length; i++) {
      const e = this.enemyPool.items[hoverCandidates[i]];
      if (!e.active || e.hp <= 0 || !e.flying) continue;
      const dx = e.x - flyerHitX;
      const dz = e.z - flyerHitZ;
      const dSq = dx * dx + dz * dz;
      const r = e.radius + 0.45;
      if (dSq <= r * r && dSq < bestDistSq) {
        bestDistSq = dSq;
        best = e;
      }
    }
    if (best) return best;

    this.spatialHash.query(groundHitX, groundHitZ, 1.4, hoverCandidates);
    for (let i = 0; i < hoverCandidates.length; i++) {
      const e = this.enemyPool.items[hoverCandidates[i]];
      if (!e.active || e.hp <= 0 || e.flying || e.burrowed) continue;
      const dx = e.x - groundHitX;
      const dz = e.z - groundHitZ;
      const dSq = dx * dx + dz * dz;
      const r = e.radius + 0.45;
      if (dSq <= r * r && dSq < bestDistSq) {
        bestDistSq = dSq;
        best = e;
      }
    }
    return best;
  }
}
