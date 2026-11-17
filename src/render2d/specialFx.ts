import type { EventBus } from '../core/eventBus.ts';
import type { TowerType } from '../core/types.ts';
import type { TowerEntity } from '../sim/entities.ts';
import type { FxLayer } from './fxLayer.ts';
import { HEIGHT_TO_SCREEN } from './layers.ts';
import type { MapView } from './mapView.ts';
import { RateCap } from './slotPool.ts';

const GREEN = 0x8fe070;
const WARD = 0x9fdcff;
const ICE = 0xbfeaff;
const DIRT = 0xb08256;
const AQUA = 0x3fe0d0;
const HEX = 0xd45cff;
const PINK = 0xff7aa8;
const GOLD = 0xffd45a;
const CORAL = 0xe85d5d;
const INDIGO = 0x9a8cff;
const CREAM = 0xfff4dc;

/** Height (world units) of a tower's body centre / turret, for beams that end on a tower. */
const TOWER_BODY_H = 1.5;

export interface SpecialFxCtx {
  readonly fx: FxLayer;
  readonly map: MapView;
  readonly towerById: (id: number) => TowerEntity | undefined;
  readonly towers: () => readonly TowerEntity[];
}

/** Event counters (QA / tests): how many of each burst were drawn, and chatty events skipped. */
export interface SpecialFxStats {
  healerPulse: number;
  wardPulse: number;
  shieldAbsorb: number;
  shieldAbsorbSkipped: number;
  shieldBroken: number;
  burrow: number;
  blink: number;
  carrierDrop: number;
  split: number;
  armorCracked: number;
  hexCharge: number;
  towerHexed: number;
  bossPulse: number;
  bossSummon: number;
  bossPhase: number;
  impact: number;
  beaconPulse: number;
  groundZone: number;
}

export function createSpecialFxStats(): SpecialFxStats {
  return {
    healerPulse: 0,
    wardPulse: 0,
    shieldAbsorb: 0,
    shieldAbsorbSkipped: 0,
    shieldBroken: 0,
    burrow: 0,
    blink: 0,
    carrierDrop: 0,
    split: 0,
    armorCracked: 0,
    hexCharge: 0,
    towerHexed: 0,
    bossPulse: 0,
    bossSummon: 0,
    bossPhase: 0,
    impact: 0,
    beaconPulse: 0,
    groundZone: 0,
  };
}

/**
 * Binds the sim events for the enemy specials and the per-tower impacts to pooled FX bursts
 * (rings, shards, sparks, beams). Every burst is allocation-free (FxLayer pools); chatty events
 * (shield absorb) are rate-capped.
 */
export function bindSpecialFx(ev: EventBus, ctx: SpecialFxCtx, stats: SpecialFxStats): void {
  const { fx, map } = ctx;
  const ppu = map.layout.pxPerUnit;
  const X = (x: number): number => map.pxX(x);
  const Y = (z: number, y = 0): number => map.pxY(z) - y * HEIGHT_TO_SCREEN * ppu;
  const absorbCap = new RateCap(14, 6);

  ev.on('healerPulse', (e) => {
    stats.healerPulse++;
    const px = X(e.x);
    const py = Y(e.z);
    fx.spawn('wring', px, py, e.radius * ppu, 0, 0, 0.75, GREEN);
    fx.spawn('orb', px, Y(e.z, 0.7), 46, 0, 0, 0.45, GREEN);
    fx.burst('spark', px, py - 12, 9, 10, 48, 0.9, GREEN);
  });

  ev.on('wardPulse', (e) => {
    stats.wardPulse++;
    const px = X(e.x);
    const py = Y(e.z);
    fx.spawn('wring', px, py, e.radius * ppu, 0, 0, 0.7, WARD);
    fx.spawn('orb', px, Y(e.z, 0.8), 54, 0, 0, 0.4, WARD);
    fx.burst('spark', px, py - 20, 6, 8, 40, 0.8, CREAM);
  });

  ev.on('shieldAbsorb', (e) => {
    if (!absorbCap.tryTake(performance.now() / 1000)) {
      stats.shieldAbsorbSkipped++;
      return;
    }
    stats.shieldAbsorb++;
    fx.spawn('spark', X(e.x), Y(e.z, e.y), e.amount >= 20 ? 13 : 9, 0, 0, 0.2, WARD);
  });

  ev.on('shieldBroken', (e) => {
    stats.shieldBroken++;
    const px = X(e.x);
    const py = Y(e.z, e.y);
    fx.burst('shard', px, py, 8, 17, 110, 0.6, ICE, 280);
    fx.spawn('wring', px, Y(e.z), 34, 0, 0, 0.4, WARD);
    fx.spawn('flash', px, py, 34, 0, 0, 0.18, CREAM);
  });

  ev.on('enemyBurrow', (e) => {
    stats.burrow++;
    const px = X(e.x);
    const py = Y(e.z, e.y);
    const surface = !e.burrowed;
    fx.puffs(px, py, surface ? 10 : 7, surface ? 22 : 15, DIRT);
    fx.burst('shard', px, py - 4, surface ? 8 : 5, 12, 92, 0.55, DIRT, 320);
    fx.spawn('wring', px, py, surface ? 40 : 28, 0, 0, 0.45, DIRT);
    if (surface) fx.spawn('crater', px, py, 22, 0, 0, 0.9);
  });

  ev.on('enemyBlink', (e) => {
    stats.blink++;
    const fx0 = X(e.fromX);
    const fy0 = Y(e.fromZ, e.fromY + 0.6);
    const fx1 = X(e.toX);
    const fy1 = Y(e.toZ, e.toY + 0.6);
    fx.burst('spark', fx0, fy0, 9, 11, 72, 0.5, AQUA);
    fx.spawn('orb', fx0, fy0, 60, 0, 0, 0.3, AQUA);
    // Afterimage trail: a string of fading orbs from where it left to where it landed.
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      fx.spawn('orb', fx0 + (fx1 - fx0) * t, fy0 + (fy1 - fy0) * t, 36 - t * 10, 0, 0, 0.16 + 0.3 * t, AQUA);
    }
    fx.beam(fx0, fy0, fx1, fy1, AQUA, 4, 0.32);
    fx.spawn('wring', fx1, Y(e.toZ, e.toY), 40, 0, 0, 0.45, AQUA);
    fx.spawn('flash', fx1, fy1, 40, 0, 0, 0.2, CREAM);
    fx.burst('spark', fx1, fy1, 7, 9, 60, 0.45, CREAM);
  });

  ev.on('carrierDrop', (e) => {
    stats.carrierDrop++;
    fx.puffs(X(e.x), Y(e.z, e.y), 10, 24, 0xe6cfa3);
    fx.spawn('wring', X(e.groundX), Y(e.groundZ), 40, 0, 0, 0.6, CORAL);
    fx.burst('spark', X(e.x), Y(e.z, e.y), 7, 9, 60, 0.6, GOLD);
  });

  ev.on('enemySplit', (e) => {
    stats.split++;
    const px = X(e.x);
    const py = Y(e.z, e.y + 0.4);
    fx.spawn('wring', px, Y(e.z), 36, 0, 0, 0.45, PINK);
    fx.burst('spark', px, py, 11, 11, 105, 0.45, PINK);
    fx.burst('shard', px, py, 6, 13, 92, 0.5, PINK, 260);
    fx.spawn('flash', px, py, 40, 0, 0, 0.2, CREAM);
  });

  ev.on('armorCracked', (e) => {
    stats.armorCracked++;
    const px = X(e.x);
    const py = Y(e.z, e.y);
    fx.burst('shard', px, py, 9, 15, 104, 0.62, 0xe6f4ff, 290);
    fx.burst('spark', px, py, 6, 9, 70, 0.45, ICE);
    fx.spawn('wring', px, Y(e.z), 28, 0, 0, 0.4, ICE);
  });

  ev.on('brittleCrack', (e) => {
    const px = X(e.x);
    const py = Y(e.z, e.y);
    fx.burst('spark', px, py, 5, 8, 60, 0.4, ICE);
    fx.burst('shard', px, py, 3, 10, 70, 0.4, ICE, 240);
  });

  ev.on('hexCharge', (e) => {
    stats.hexCharge++;
    const lx = X(e.x);
    const ly = Y(e.z, e.y + 1.0);
    const tx = X(e.towerX);
    const ty = Y(e.towerZ, TOWER_BODY_H);
    fx.beam(lx, ly, tx, ty, HEX, 2.6, 0.7, true);
    fx.burst('spark', lx, ly, 6, 8, 48, 0.7, HEX);
    fx.spawn('orb', tx, ty, 38, 0, 0, 0.6, HEX);
  });

  ev.on('towerHexed', (e) => {
    stats.towerHexed++;
    const lx = X(e.x);
    const ly = Y(e.z, e.y + 1.0);
    const tx = X(e.towerX);
    const ty = Y(e.towerZ, TOWER_BODY_H);
    fx.beam(lx, ly, tx, ty, HEX, 4.2, 0.3);
    fx.spawn('wring', tx, Y(e.towerZ), 40, 0, 0, 0.5, HEX);
    fx.burst('spark', tx, ty, 9, 10, 70, 0.5, HEX);
    fx.spawn('flash', tx, ty, 44, 0, 0, 0.2, CREAM);
  });

  ev.on('bossPulse', (e) => {
    stats.bossPulse++;
    const px = X(e.x);
    fx.spawn('wring', px, Y(e.z), e.radius * ppu, 0, 0, 0.9, INDIGO);
    fx.spawn('orb', px, Y(e.z, e.y + 0.5), 80, 0, 0, 0.4, INDIGO);
    for (let i = 0; i < e.stunnedTowerIds.length; i++) {
      const t = ctx.towerById(e.stunnedTowerIds[i]);
      if (!t) continue;
      fx.burst('spark', X(t.x), Y(t.z, TOWER_BODY_H), 6, 9, 60, 0.5, HEX);
    }
  });

  ev.on('bossSummon', (e) => {
    stats.bossSummon++;
    const px = X(e.x);
    const py = Y(e.z, e.y);
    fx.spawn('wring', px, Y(e.z), 2.4 * ppu, 0, 0, 0.7, CORAL);
    fx.spawn('flash', px, py, 90, 0, 0, 0.3, GOLD);
    fx.burst('spark', px, py, 12, 12, 100, 0.65, GOLD);
  });

  ev.on('bossPhase', (e) => {
    stats.bossPhase++;
    const px = X(e.x);
    const py = Y(e.z, e.y + 1.4);
    if (e.phase === 1) {
      fx.spawn('wring', px, Y(e.z), e.radius * ppu, 0, 0, 0.9, WARD);
      fx.spawn('wring', px, Y(e.z), e.radius * ppu * 0.6, 0, 0, 0.7, CREAM);
      fx.burst('shard', px, py, 10, 18, 120, 0.7, ICE, 260);
      fx.spawn('flash', px, py, 110, 0, 0, 0.3, WARD);
    } else {
      fx.spawn('wring', px, Y(e.z), e.radius * ppu, 0, 0, 1.0, 0xff8a3a);
      fx.spawn('wring', px, Y(e.z), e.radius * ppu * 0.5, 0, 0, 0.7, GOLD);
      fx.burst('spark', px, py, 14, 13, 130, 0.7, GOLD);
      fx.spawn('flash', px, py, 130, 0, 0, 0.34, 0xffb070);
    }
  });

  ev.on('enemyKilled', (e) => {
    if (e.enemyType !== 'tempest' && e.enemyType !== 'boss') return;
    const px = X(e.x);
    const py = Y(e.z, e.y + 1.0);
    fx.burst('shard', px, py, 12, 20, 140, 0.8, 0xdfe7f2, 300);
    fx.spawn('wring', px, Y(e.z), 4 * ppu, 0, 0, 0.9, GOLD);
    fx.spawn('flash', px, py, 120, 0, 0, 0.35, CREAM);
    fx.puffs(px, py, 10, 36, 0xdfe7f2);
  });

  ev.on('groundZone', (e) => {
    stats.groundZone++;
    fx.zone(X(e.x), Y(e.z), e.radius * ppu, e.duration);
  });

  ev.on('beaconPulse', (e) => {
    stats.beaconPulse++;
    const bx = X(e.x);
    const by = Y(e.z, 2.4);
    fx.spawn('wring', bx, Y(e.z), e.radius * ppu, 0, 0, 1.0, GOLD);
    if (e.tier >= 3) fx.spawn('wring', bx, Y(e.z), e.radius * ppu * 0.7, 0, 0, 0.8, CREAM);
    fx.spawn('orb', bx, by, 56, 0, 0, 0.5, GOLD);
    const r2 = e.radius * e.radius;
    const towers = ctx.towers();
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (t.id === e.towerId || t.type === 'beacon') continue;
      const dx = t.x - e.x;
      const dz = t.z - e.z;
      if (dx * dx + dz * dz > r2) continue;
      const tx = X(t.x);
      const ty = Y(t.z, TOWER_BODY_H);
      fx.beam(bx, by, tx, ty, GOLD, 2.8, 0.6);
      fx.spawn('spark', tx, ty, 18, 0, -14, 0.55, GOLD);
    }
  });

  ev.on('projectileImpact', (e) => {
    stats.impact++;
    const px = X(e.x);
    const py = Y(e.z);
    switch (e.towerType as TowerType) {
      case 'cannon':
        fx.spawn('ring', px, py, Math.max(26, e.radius * ppu), 0, 0, 0.38);
        fx.puffs(px, py, 6, 14, 0xf2c27a);
        fx.spawn('flash', px, py - 6, 26, 0, 0, 0.16);
        break;
      case 'mortar': {
        const r = Math.max(30, e.radius * ppu);
        fx.spawn('crater', px, py, r * 0.9, 0, 0, 1.5);
        fx.spawn('ring', px, py, r, 0, 0, 0.46);
        fx.puffs(px, py, 9, r * 0.6, 0xc9a070);
        fx.burst('shard', px, py - 4, 5, 12, 100, 0.55, DIRT, 320);
        fx.spawn('flash', px, py - 8, 40, 0, 0, 0.2);
        break;
      }
      case 'frost': {
        const r = Math.max(24, e.radius * ppu);
        fx.spawn('wring', px, py, r, 0, 0, 0.55, ICE);
        fx.burst('shard', px, py - 8, 7, 14, 96, 0.5, ICE, 220);
        fx.burst('spark', px, py - 8, 6, 9, 66, 0.5, 0xdff6ff);
        fx.spawn('orb', px, py - 8, 34, 0, 0, 0.3, ICE);
        break;
      }
      case 'ballista':
        fx.spawn('spark', px, py - 0.6 * ppu, 12, 0, 0, 0.22, 0xffe9b0);
        if (e.pierce) {
          const ex = X(e.x + e.pierce.dx * e.pierce.length);
          const ey = Y(e.z + e.pierce.dz * e.pierce.length);
          fx.beam(px, py - 0.6 * ppu, ex, ey - 0.6 * ppu, 0xffe9b0, 3.4, 0.34);
          fx.spawn('spark', ex, ey - 0.6 * ppu, 12, 0, 0, 0.24, 0xffe9b0);
        }
        break;
      default:
        fx.spawn('spark', px, py - 0.6 * ppu, 9, 0, 0, 0.18);
    }
  });
}
