import { computeMeteorDamage } from '../data/abilities.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import { ITEMS, MARKET_RULES, isItemId, heartstoneCeiling, type ItemCounts, type ItemId } from '../data/market.ts';
import type { EnemyEntity } from './entities.ts';
import type { LevelDef } from '../data/levels/types.ts';
import { worldToGridCoord } from './grid.ts';
import type { SimWorld } from './world.ts';

const MAX_USE_CAP = Math.max(MARKET_RULES.useCap.easy, MARKET_RULES.useCap.normal, MARKET_RULES.useCap.hard);

export function cleanBelt(raw: unknown, cap: number = MARKET_RULES.useCap.normal): ItemCounts {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const safeCap = typeof cap === 'number' && Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : MARKET_RULES.useCap.normal;
  const result: ItemCounts = {};
  let slotsUsed = 0;
  for (const [id, count] of Object.entries(raw)) {
    if (slotsUsed >= MARKET_RULES.slots) break;
    if (isItemId(id) && Number.isSafeInteger(count) && count >= 0) {
      result[id] = Math.min(MAX_USE_CAP, safeCap, count);
      slotsUsed++;
    }
  }
  return result;
}

function onMap(level: LevelDef, x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const layout = level.layout2d;
  if (!layout) return worldToGridCoord(x, z, level.cols, level.rows) !== null;
  return Math.abs(x) <= layout.imageSize[0] / (2 * layout.pxPerUnit) &&
    Math.abs(z) <= layout.imageSize[1] / (2 * layout.pxPerUnit);
}

function itemTargets(world: SimWorld, id: ItemId, x: number, z: number): EnemyEntity[] {
  const targets: EnemyEntity[] = [];
  if (id !== 'galeBell' && id !== 'emberPot' && id !== 'frostLantern') return targets;
  const pool = world.enemyPool;
  for (let i = 0; i < pool.getActiveCount(); i++) {
    const e = pool.items[pool.getActiveIndex(i)];
    if (!e.active || e.hp <= 0) continue;
    if (id === 'galeBell') {
      if (e.dist > 0) targets.push(e);
    } else if (!e.burrowed && Math.hypot(e.x - x, e.z - z) <= ITEMS[id].radius) {
      targets.push(e);
    }
  }
  return targets;
}

function crackBrittleOnFreeze(world: SimWorld, e: EnemyEntity, seconds: number): void {
  const brittleArmor = ENEMY_DEFS[e.type].brittleArmor;
  if (brittleArmor === undefined) return;
  if (e.armorBreakTimer <= 0 && e.armor > brittleArmor) {
    world.events.emit('armorCracked', {
      enemyId: e.uid,
      x: e.x,
      y: e.y + e.height * 0.7,
      z: e.z,
    });
  }
  e.armor = Math.min(e.baseArmor, brittleArmor);
  e.armorBreakTimer = Math.max(e.armorBreakTimer, seconds, ENEMY_DEFS[e.type].brittleDuration ?? 2.5);
}

export class ItemSystem {
  readonly initial: Readonly<ItemCounts>;
  private readonly remaining: ItemCounts;
  private healed = 0;
  private casts = 0;
  get restoredLives(): number { return this.healed; }
  private readonly spend?: (id: ItemId) => boolean;

  constructor(belt?: ItemCounts, spend?: (id: ItemId) => boolean, cap?: number) {
    this.initial = Object.freeze(cleanBelt(belt, cap));
    this.remaining = { ...this.initial };
    this.spend = spend;
  }

  belt(): ItemCounts { return { ...this.remaining }; }

  /** Further supplies become available as the keep takes damage. Healing preserves eligibility. */
  livesUntilNextUse(world: SimWorld): number {
    const lost = world.startingLives - world.lives + this.healed;
    return Math.max(0, this.casts * MARKET_RULES.livesLostPerExtraUse[world.mods.marketDifficulty] - lost);
  }

  use(world: SimWorld, id: ItemId, x = NaN, z = NaN, onAccepted?: () => void): boolean {
    if (!isItemId(id)) return false;
    const charges = this.remaining[id] ?? 0;
    if (!charges || this.livesUntilNextUse(world) > 0 || world.mods.itemsDisabled || world.mods.abilitiesDisabled || world.waveSystem.isEndless ||
        world.outcome !== 'ongoing' || world.waveSystem.state === 'preFirstWave') return false;
    const target = ITEMS[id].target;
    const road = { x: 0, z: 0, yaw: 0 };
    if (target !== 'self' && !onMap(world.level, x, z)) return false;
    if (target === 'road' && !world.soldierSystem.findRoadPoint(x, z, ITEMS.cloudguard.snapRadius, x, z, road)) return false;
    const repairLimit = heartstoneCeiling(world.startingLives, world.mods.marketDifficulty);
    if (id === 'heartstone' && world.lives >= repairLimit) return false;
    const enemies = itemTargets(world, id, x, z);
    if ((id === 'frostLantern' || id === 'galeBell') && !enemies.length) return false;
    // All rejection paths precede the synchronous debit and all renderer notifications.
    if (this.spend && !this.spend(id)) return false;
    this.remaining[id] = charges - 1;
    this.casts++;
    onAccepted?.();
    const castPoint = target === 'road' ? { x: road.x, z: road.z } : { x, z };
    world.events.emit('itemCast', { id, remaining: charges - 1, ...(target === 'self' ? {} : castPoint) });
    const wave = Math.max(1, world.waveSystem.currentWaveOneBased);
    switch (id) {
      case 'emberPot': {
        const def = ITEMS.emberPot;
        const damage = Math.round(computeMeteorDamage(wave) * def.meteorFraction);
        for (const e of enemies) {
          if (!e.active || e.hp <= 0) continue;
          world.enemySystem.applyDamage(e, damage, true);
        }
        world.projectileSystem.addBurnZone(x, z, def.radius, def.burnSeconds, def.burnDamage);
        break;
      }
      case 'frostLantern':
        for (const e of enemies) {
          if (!e.active || e.hp <= 0 || e.burrowed) continue;
          const slowOnly = !!ENEMY_DEFS[e.type].isBoss || e.elite;
          const def = ITEMS.frostLantern;
          if (slowOnly) {
            if (ENEMY_DEFS[e.type].ability?.kind === 'momentum') e.abilityTimer = 0;
            crackBrittleOnFreeze(world, e, def.seconds);
            world.enemySystem.applyMark(e, def.markVuln, def.seconds);
            e.slowRatio = Math.max(e.slowRatio, def.eliteSlow);
            e.slowTimer = Math.max(e.slowTimer, def.seconds);
          } else {
            world.enemySystem.applyStun(e, def.seconds);
            crackBrittleOnFreeze(world, e, def.seconds);
            world.enemySystem.applyMark(e, def.markVuln, def.seconds);
            e.frozenTimer = Math.max(e.frozenTimer, def.seconds);
          }
          world.events.emit('enemyFrozen', { enemyId: e.uid, x: e.x, z: e.z, seconds: def.seconds, slowOnly });
        }
        break;
      case 'galeBell': {
        for (const e of enemies) {
          if (!e.active || e.hp <= 0) continue;
          const maxPush = ENEMY_DEFS[e.type].isBoss ? ITEMS.galeBell.bossDistance : ITEMS.galeBell.distance;
          const distance = Math.max(0, Math.min(e.dist, maxPush));
          const fromX = e.x, fromZ = e.z;
          e.dist = Math.max(0, e.dist - distance);
          e.yaw = world.enemySystem.getPath(e.flying, e.lane).sample(e.dist, e);
          e.prevX = e.x; e.prevY = e.y; e.prevZ = e.z; e.prevYaw = e.yaw;
          world.events.emit('enemyPushed', { enemyId: e.uid, fromX, fromZ, x: e.x, z: e.z, distance });
        }
        const pool = world.enemyPool;
        world.spatialHash.clear();
        for (let i = 0; i < pool.getActiveCount(); i++) {
          const e = pool.items[pool.getActiveIndex(i)];
          if (e.hp > 0 && !e.burrowed) world.spatialHash.insert(e.poolIndex, e.x, e.z);
        }
        break;
      }
      case 'cloudguard':
        world.soldierSystem.spawnCloudguard(road, wave);
        break;
      case 'heartstone': {
        const heal = Math.min(ITEMS.heartstone.lives, repairLimit - world.lives);
        world.lives += heal;
        this.healed += heal;
        world.events.emit('economyChanged', { gold: world.gold, lives: world.lives });
        break;
      }
      case 'skyPurse': {
        const purse = ITEMS.skyPurse;
        world.gold += Math.round(world.level.startingGold * purse.startingGoldFraction + wave * purse.goldPerWave);
        world.events.emit('economyChanged', { gold: world.gold, lives: world.lives });
        break;
      }
    }
    return true;
  }
}
