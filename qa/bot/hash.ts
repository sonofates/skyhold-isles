import type { SimWorld } from '../../src/sim/world.ts';

const _f64Buf = new ArrayBuffer(8);
const _f64View = new DataView(_f64Buf);
const _sortedEnemyIndices: number[] = [];

/**
 * Dual-lane 32-bit FNV-1a accumulator producing a 16-hex-character (64-bit) digest.
 * Hashes raw IEEE-754 float64 bit patterns so any 1-ULP numerical drift changes the hash.
 */
class StateHasher {
  private h1 = 0x811c9dc5;
  private h2 = 0x050c5d1f;

  u8(b: number): void {
    const v = b & 0xff;
    this.h1 = Math.imul(this.h1 ^ v, 0x01000193) >>> 0;
    this.h2 = Math.imul(this.h2 ^ ((v + 0x9e) & 0xff), 0x01000193) >>> 0;
  }

  i32(n: number): void {
    const v = n | 0;
    this.u8(v);
    this.u8(v >>> 8);
    this.u8(v >>> 16);
    this.u8(v >>> 24);
  }

  bool(b: boolean): void {
    this.u8(b ? 1 : 0);
  }

  f64(n: number): void {
    // Canonicalize -0 to +0 so 0 and -0 hash identically while NaNs/ULPs stay distinct.
    _f64View.setFloat64(0, n === 0 ? 0 : n, true);
    this.i32(_f64View.getInt32(0, true));
    this.i32(_f64View.getInt32(4, true));
  }

  str(s: string): void {
    this.i32(s.length);
    for (let i = 0; i < s.length; i++) {
      this.i32(s.charCodeAt(i));
    }
  }

  digest(): string {
    return this.h1.toString(16).padStart(8, '0') + this.h2.toString(16).padStart(8, '0');
  }
}

/**
 * Computes a deterministic 64-bit hash of every authoritative gameplay field in `SimWorld`.
 * Used by the QA bot to verify bit-exact replay determinism across seeds & inputs.
 */
export function hashWorldState(world: SimWorld): string {
  const h = new StateHasher();

  h.i32(world.gold);
  h.i32(world.lives);
  h.i32(world.startingLives);
  h.i32(world.enemiesKilledTotal);
  h.str(world.outcome);

  const ws = world.waveSystem;
  h.str(ws.state);
  h.i32(ws.currentWaveIndex);
  h.f64(ws.interWaveTimer);
  h.f64(ws.getAutoShortenedBy());
  h.f64(ws.waveElapsed);
  h.i32(ws.pendingClearBonus);
  h.bool(ws.endlessMode);
  h.bool(ws.autoWave);

  h.f64(world.abilitySystem.getCooldown('meteor'));
  h.f64(world.abilitySystem.getCooldown('overcharge'));
  h.f64(world.abilitySystem.getOverchargeRemaining());
  const pendingMeteors = world.abilitySystem.getPendingMeteors();
  h.i32(pendingMeteors.length);
  for (let i = 0; i < pendingMeteors.length; i++) {
    const m = pendingMeteors[i];
    h.f64(m.x);
    h.f64(m.z);
    h.f64(m.remaining);
    h.f64(m.damage);
  }

  h.i32(world.towers.length);
  for (let i = 0; i < world.towers.length; i++) {
    const t = world.towers[i];
    h.i32(t.id);
    h.i32(t.col);
    h.i32(t.row);
    h.str(t.type);
    h.i32(t.tier);
    h.i32(t.totalInvested);
    h.str(t.targetingMode);
    h.f64(t.cooldownTimer);
    h.f64(t.stunTimer);
    h.f64(t.yaw);
    h.f64(t.totalDamageDealt);
    h.i32(t.kills);
    h.f64(t.auraRate);
    h.f64(t.auraRange);
    h.i32(t.shotCount);
    h.f64(t.heroRateBonus ?? 0);
    h.f64(t.heroRangeBonus ?? 0);
    h.f64(t.overhaulTimer ?? 0);
    h.f64(t.overhaulRateBonus ?? 0);
  }

  // Active enemies: hash active pool order AND sorted-by-uid entity fields.
  const ep = world.enemyPool;
  const eCount = ep.getActiveCount();
  h.i32(eCount);
  _sortedEnemyIndices.length = 0;
  for (let i = 0; i < eCount; i++) {
    const poolIdx = ep.getActiveIndex(i);
    h.i32(poolIdx);
    const uid = ep.items[poolIdx].uid;
    let pos = _sortedEnemyIndices.length;
    _sortedEnemyIndices.push(poolIdx);
    while (pos > 0 && ep.items[_sortedEnemyIndices[pos - 1]].uid > uid) {
      _sortedEnemyIndices[pos] = _sortedEnemyIndices[pos - 1];
      pos--;
    }
    _sortedEnemyIndices[pos] = poolIdx;
  }
  for (let i = 0; i < _sortedEnemyIndices.length; i++) {
    const idx = _sortedEnemyIndices[i];
    const e = ep.items[idx];
    h.i32(e.poolIndex);
    h.i32(e.uid);
    h.str(e.type);
    h.f64(e.hp);
    h.f64(e.maxHp);
    h.f64(e.speed);
    h.f64(e.armor);
    h.i32(e.reward);
    h.i32(e.livesCost);
    h.f64(e.dist);
    h.f64(e.totalDist);
    h.f64(e.x);
    h.f64(e.y);
    h.f64(e.z);
    h.f64(e.yaw);
    h.f64(e.slowTimer);
    h.f64(e.slowRatio);
    h.f64(e.shield);
    h.f64(e.shieldMax);
    h.bool(e.burrowed);
    h.f64(e.abilityTimer);
    h.f64(e.armorBreakTimer);
    h.f64(e.baseArmor);
    h.bool(e.elite);
    h.bool(e.isDropped);
    h.i32(e.lane);
    h.i32(e.bossPhase);
    h.f64(e.channelTimer);
    h.i32(e.hexTargetId);
    h.i32(e.blockers);
    h.f64(e.meleeTimer);
    h.f64(e.stunTimer);
    h.f64(e.markTimer);
    h.f64(e.markVuln);
    h.i32(e.heroBlockers);
    h.f64(e.heroDamageReduction);
    h.f64(e.heroMeleeTimer);
    h.f64(world.heroSystem.getEnemyBurnRemaining(idx, e.uid));
    h.f64(world.heroSystem.getEnemyBurnDps(idx, e.uid));
  }

  const pp = world.projectilePool;
  const pCount = pp.getActiveCount();
  h.i32(pCount);
  for (let i = 0; i < pCount; i++) {
    const p = pp.items[pp.getActiveIndex(i)];
    h.i32(p.poolIndex);
    h.str(p.towerType);
    h.i32(p.towerId);
    h.i32(p.targetUid);
    h.f64(p.damage);
    h.f64(p.x);
    h.f64(p.y);
    h.f64(p.z);
    h.f64(p.progress);
    h.f64(p.duration);
    h.bool(p.fromHero);
  }

  const burnZones = world.projectileSystem.getBurnZones();
  h.i32(world.projectileSystem.getActiveBurnZoneCount());
  for (let i = 0; i < burnZones.length; i++) {
    const z = burnZones[i];
    if (!z.active) continue;
    h.f64(z.x);
    h.f64(z.z);
    h.f64(z.timeLeft);
    h.f64(z.damage);
  }

  const barracks = world.soldierSystem.barracks;
  h.i32(barracks.length);
  for (let i = 0; i < barracks.length; i++) {
    const b = barracks[i];
    h.i32(b.towerId);
    h.f64(b.rallyX);
    h.f64(b.rallyZ);
  }

  const soldiers = world.soldierSystem.soldiers;
  h.i32(soldiers.length);
  for (let i = 0; i < soldiers.length; i++) {
    const s = soldiers[i];
    h.i32(s.id);
    h.i32(s.towerId);
    h.i32(s.slot);
    h.str(s.state);
    h.f64(s.x);
    h.f64(s.z);
    h.f64(s.hp);
    h.f64(s.maxHp);
    h.f64(s.respawnTimer);
    h.f64(s.attackTimer);
    h.i32(s.targetPoolIndex);
    h.i32(s.targetUid);
    h.f64(s.bonusArmor);
    h.f64(s.damageMul);
  }

  h.i32(world.heroSystem.rng.getState());
  const hero = world.hero;
  h.bool(hero !== null);
  if (hero) {
    h.str(hero.heroId);
    h.i32(hero.level);
    h.str(hero.state);
    h.f64(hero.x);
    h.f64(hero.z);
    h.f64(hero.yaw);
    h.f64(hero.postX);
    h.f64(hero.postZ);
    h.f64(hero.hp);
    h.f64(hero.maxHp);
    h.f64(hero.respawnTimer);
    h.f64(hero.attackTimer);
    h.f64(hero.sinceHurt);
    h.i32(hero.shotCount);
    h.f64(hero.skillCooldowns[0]);
    h.f64(hero.skillCooldowns[1]);
    h.f64(hero.rallyBannerTimer);
    h.i32(hero.targetPoolIndex);
    h.i32(hero.targetUid);
    h.f64(hero.totalDamageDealt);
    h.i32(hero.kills);
    h.i32(world.heroSystem.runXp);

    const gizmos = world.heroSystem.gizmos;
    h.i32(gizmos.length);
    for (let i = 0; i < gizmos.length; i++) {
      const g = gizmos[i];
      h.i32(g.id);
      h.f64(g.x);
      h.f64(g.z);
      h.f64(g.remainingSec);
      h.f64(g.cooldownTimer);
      h.f64(g.boostTimer);
    }

    const rings = world.heroSystem.fireRings;
    h.i32(rings.length);
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      h.f64(r.x);
      h.f64(r.z);
      h.f64(r.remainingSec);
      h.f64(r.dps);
    }

    const volleys = world.heroSystem.getPendingVolleys();
    h.i32(volleys.length);
    for (let i = 0; i < volleys.length; i++) {
      const pv = volleys[i];
      h.f64(pv.x);
      h.f64(pv.z);
      h.f64(pv.remainingSec);
      h.f64(pv.damage);
    }
  }

  return h.digest();
}
