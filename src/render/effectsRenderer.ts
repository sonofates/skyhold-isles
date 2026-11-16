import * as THREE from 'three';
import type { EnemyType, Vec3 } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { LightningArcPool } from './lightningPool.ts';
import { applyAlphaPreserveBlend } from './materials.ts';

interface Shard {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  vrx: number;
  vry: number;
  scale: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  life: number;
  maxLife: number;
  gravity: number;
  color: THREE.Color;
}

interface PulseRing {
  active: boolean;
  x: number;
  y: number;
  z: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

interface MeteorOrbFx {
  active: boolean;
  mode: 'falling' | 'blast';
  x: number;
  y: number;
  z: number;
  startX: number;
  startY: number;
  startZ: number;
  scale: number;
  life: number;
  maxLife: number;
}

interface ScorchCraterFx {
  active: boolean;
  x: number;
  y: number;
  z: number;
  radius: number;
  life: number;
  maxLife: number;
}

interface TelegraphRingFx {
  active: boolean;
  x: number;
  y: number;
  z: number;
  radius: number;
  life: number;
  maxLife: number;
}

const MAX_METEOR_FX = 8;
const MAX_SCORCH_FX = 12;
const _dummy = new THREE.Object3D();
const _enemyShardColors: Record<EnemyType, number> = {
  grunt: PALETTE_HEX.coral,
  runner: PALETTE_HEX.gold,
  brute: PALETTE_HEX.stone,
  flyer: PALETTE_HEX.cream,
  healer: PALETTE_HEX.grass,
  splitter: 0xe84a7f,
  boss: PALETTE_HEX.indigo,
};

export class EffectsRenderer {
  readonly group = new THREE.Group();

  private readonly shardMesh: THREE.InstancedMesh;
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly pulseRingMesh: THREE.InstancedMesh;
  private readonly meteorOrbMesh: THREE.InstancedMesh;
  private readonly scorchDiscMesh: THREE.InstancedMesh;
  private readonly telegraphRingMesh: THREE.InstancedMesh;
  private readonly lightning = new LightningArcPool();

  private readonly shards: Shard[] = [];
  private readonly particles: Particle[] = [];
  private readonly pulseRings: PulseRing[] = [];
  private readonly meteorOrbs: MeteorOrbFx[] = [];
  private readonly scorchCraters: ScorchCraterFx[] = [];
  private readonly telegraphRings: TelegraphRingFx[] = [];

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly ownMaterials: THREE.Material[] = [];

  constructor() {
    const shardGeo = new THREE.TetrahedronGeometry(0.22, 0);
    this.geometries.push(shardGeo);
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      flatShading: true,
      roughness: 0.8,
    });
    this.ownMaterials.push(shardMat);
    this.shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, BALANCE.pools.maxShards);
    this.shardMesh.count = 0;
    this.shardMesh.visible = false;
    this.shardMesh.castShadow = false;
    this.shardMesh.frustumCulled = false;
    this.group.add(this.shardMesh);

    for (let i = 0; i < BALANCE.pools.maxShards; i++) {
      this.shards.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        vrx: 0,
        vry: 0,
        scale: 1,
        life: 0,
        maxLife: 1,
        color: new THREE.Color(PALETTE_HEX.coral),
      });
    }

    const partGeo = new THREE.IcosahedronGeometry(0.14, 0);
    this.geometries.push(partGeo);
    const partMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.22, 1.22, 1.22) });
    this.ownMaterials.push(partMat);
    this.particleMesh = new THREE.InstancedMesh(partGeo, partMat, BALANCE.pools.maxParticles);
    this.particleMesh.count = 0;
    this.particleMesh.visible = false;
    this.particleMesh.frustumCulled = false;
    this.group.add(this.particleMesh);

    for (let i = 0; i < BALANCE.pools.maxParticles; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale: 1,
        life: 0,
        maxLife: 1,
        gravity: 0,
        color: new THREE.Color(PALETTE_HEX.cream),
      });
    }

    const pulseGeo = new THREE.RingGeometry(0.76, 1.0, 28);
    pulseGeo.rotateX(-Math.PI / 2);
    this.geometries.push(pulseGeo);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.28, 1.38, 1.5),
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    applyAlphaPreserveBlend(pulseMat);
    this.ownMaterials.push(pulseMat);
    this.pulseRingMesh = new THREE.InstancedMesh(pulseGeo, pulseMat, BALANCE.pools.maxPulseRings);
    this.pulseRingMesh.count = 0;
    this.pulseRingMesh.visible = false;
    this.pulseRingMesh.frustumCulled = false;
    this.group.add(this.pulseRingMesh);

    for (let i = 0; i < BALANCE.pools.maxPulseRings; i++) {
      this.pulseRings.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        maxRadius: 2,
        life: 0,
        maxLife: 0.35,
        color: new THREE.Color(PALETTE_HEX.gold),
      });
    }

    const meteorGeo = new THREE.IcosahedronGeometry(0.5, 1);
    this.geometries.push(meteorGeo);
    const meteorMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.55, 0.92, 0.42),
      toneMapped: false,
    });
    this.ownMaterials.push(meteorMat);
    this.meteorOrbMesh = new THREE.InstancedMesh(meteorGeo, meteorMat, MAX_METEOR_FX);
    this.meteorOrbMesh.count = 0;
    this.meteorOrbMesh.visible = false;
    this.meteorOrbMesh.frustumCulled = false;
    this.group.add(this.meteorOrbMesh);

    for (let i = 0; i < MAX_METEOR_FX; i++) {
      this.meteorOrbs.push({
        active: false,
        mode: 'falling',
        x: 0,
        y: 0,
        z: 0,
        startX: 0,
        startY: 0,
        startZ: 0,
        scale: 1,
        life: 0,
        maxLife: 0.32,
      });
    }

    const scorchGeo = new THREE.CircleGeometry(1, 24);
    scorchGeo.rotateX(-Math.PI / 2);
    this.geometries.push(scorchGeo);
    const scorchMat = new THREE.MeshBasicMaterial({
      color: 0x261624,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    applyAlphaPreserveBlend(scorchMat);
    this.ownMaterials.push(scorchMat);
    this.scorchDiscMesh = new THREE.InstancedMesh(scorchGeo, scorchMat, MAX_SCORCH_FX);
    this.scorchDiscMesh.count = 0;
    this.scorchDiscMesh.visible = false;
    this.scorchDiscMesh.renderOrder = 3;
    this.scorchDiscMesh.frustumCulled = false;
    this.group.add(this.scorchDiscMesh);

    for (let i = 0; i < MAX_SCORCH_FX; i++) {
      this.scorchCraters.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        radius: 1,
        life: 0,
        maxLife: 1.5,
      });
    }

    const telegraphGeo = new THREE.RingGeometry(0.9, 1.0, 32);
    telegraphGeo.rotateX(-Math.PI / 2);
    this.geometries.push(telegraphGeo);
    const telegraphMat = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.coral,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    applyAlphaPreserveBlend(telegraphMat);
    this.ownMaterials.push(telegraphMat);
    this.telegraphRingMesh = new THREE.InstancedMesh(telegraphGeo, telegraphMat, MAX_METEOR_FX);
    this.telegraphRingMesh.count = 0;
    this.telegraphRingMesh.visible = false;
    this.telegraphRingMesh.renderOrder = 4;
    this.telegraphRingMesh.frustumCulled = false;
    this.group.add(this.telegraphRingMesh);

    for (let i = 0; i < MAX_METEOR_FX; i++) {
      this.telegraphRings.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        radius: 1,
        life: 0,
        maxLife: 0.32,
      });
    }

    this.group.add(this.lightning.group);
  }

  spawnDeathShards(enemyType: EnemyType, x: number, y: number, z: number): void {
    const baseColor = _enemyShardColors[enemyType];
    const count = enemyType === 'boss' ? 16 : 7;
    let spawned = 0;
    for (let i = 0; i < this.shards.length && spawned < count; i++) {
      const s = this.shards[i];
      if (s.active) continue;
      s.active = true;
      s.x = x + (Math.random() - 0.5) * 0.35;
      s.y = Math.max(0.2, y);
      s.z = z + (Math.random() - 0.5) * 0.35;
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.6 + Math.random() * 2.6;
      s.vx = Math.cos(ang) * spd;
      s.vy = 2.6 + Math.random() * 2.8;
      s.vz = Math.sin(ang) * spd;
      s.rx = Math.random() * Math.PI;
      s.ry = Math.random() * Math.PI;
      s.vrx = (Math.random() - 0.5) * 10;
      s.vry = (Math.random() - 0.5) * 10;
      s.scale = enemyType === 'boss' ? 1.4 : 0.9 + Math.random() * 0.45;
      s.maxLife = 0.65 + Math.random() * 0.25;
      s.life = s.maxLife;
      s.color.setHex(spawned % 3 === 0 ? PALETTE_HEX.cream : baseColor);
      spawned++;
    }
  }

  spawnParticles(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count: number,
    speed: number,
    gravity = 5.5,
  ): void {
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < count; i++) {
      const p = this.particles[i];
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      const ang = Math.random() * Math.PI * 2;
      const horiz = (0.35 + Math.random() * 0.65) * speed;
      p.vx = Math.cos(ang) * horiz;
      p.vy = (0.25 + Math.random() * 0.75) * speed;
      p.vz = Math.sin(ang) * horiz;
      p.scale = 0.75 + Math.random() * 0.65;
      p.maxLife = 0.3 + Math.random() * 0.25;
      p.life = p.maxLife;
      p.gravity = gravity;
      p.color.setHex(colorHex);
      spawned++;
    }
  }

  /**
   * Extended particle emitter: directional bursts (`dirX/dirZ`, `spread` 0..1), custom lifetime and size.
   * Cheap (shares the pooled particle mesh); used for muzzle sparks, smoke puffs, coin pops.
   */
  spawnBurst(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count: number,
    opts: {
      speed: number;
      gravity?: number;
      life?: number;
      scale?: number;
      /** Unit horizontal direction the burst favours (muzzle sparks); omit for a radial burst. */
      dirX?: number;
      dirZ?: number;
      /** 0 = all particles along dir, 1 = fully radial. */
      spread?: number;
      /** Extra upward velocity fraction of speed. */
      lift?: number;
    },
  ): void {
    const gravity = opts.gravity ?? 5.5;
    const lifeBase = opts.life ?? 0.4;
    const scaleBase = opts.scale ?? 1;
    const hasDir = opts.dirX !== undefined && opts.dirZ !== undefined;
    const spread = opts.spread ?? 0.35;
    const lift = opts.lift ?? 0.4;
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < count; i++) {
      const p = this.particles[i];
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      const rnd = Math.random();
      const spd = opts.speed * (0.55 + Math.random() * 0.6);
      if (hasDir) {
        const ang = (rnd - 0.5) * Math.PI * 2 * spread;
        const cs = Math.cos(ang);
        const sn = Math.sin(ang);
        const dx = opts.dirX! * cs - opts.dirZ! * sn;
        const dz = opts.dirX! * sn + opts.dirZ! * cs;
        p.vx = dx * spd;
        p.vz = dz * spd;
      } else {
        const ang = rnd * Math.PI * 2;
        p.vx = Math.cos(ang) * spd;
        p.vz = Math.sin(ang) * spd;
      }
      p.vy = (0.2 + Math.random() * 0.8) * opts.speed * lift;
      p.scale = scaleBase * (0.75 + Math.random() * 0.5);
      p.maxLife = lifeBase * (0.75 + Math.random() * 0.5);
      p.life = p.maxLife;
      p.gravity = gravity;
      p.color.setHex(colorHex);
      spawned++;
    }
  }

  /** One short-lived oversized glow particle (muzzle flash / impact flash). */
  spawnFlash(x: number, y: number, z: number, colorHex: number, scale = 2.4, life = 0.09): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.scale = scale;
      p.maxLife = life;
      p.life = life;
      p.gravity = 0;
      p.color.setHex(colorHex);
      return;
    }
  }

  /** Tumbling debris shards (frost shatter, cannon rubble) using the shard pool. */
  spawnDebris(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count: number,
    speed = 2.6,
    scale = 0.6,
  ): void {
    let spawned = 0;
    for (let i = 0; i < this.shards.length && spawned < count; i++) {
      const s = this.shards[i];
      if (s.active) continue;
      s.active = true;
      s.x = x + (Math.random() - 0.5) * 0.25;
      s.y = Math.max(0.15, y);
      s.z = z + (Math.random() - 0.5) * 0.25;
      const ang = Math.random() * Math.PI * 2;
      const spd = speed * (0.5 + Math.random() * 0.7);
      s.vx = Math.cos(ang) * spd;
      s.vy = 1.6 + Math.random() * 2.2;
      s.vz = Math.sin(ang) * spd;
      s.rx = Math.random() * Math.PI;
      s.ry = Math.random() * Math.PI;
      s.vrx = (Math.random() - 0.5) * 12;
      s.vry = (Math.random() - 0.5) * 12;
      s.scale = scale * (0.7 + Math.random() * 0.6);
      s.maxLife = 0.45 + Math.random() * 0.2;
      s.life = s.maxLife;
      s.color.setHex(colorHex);
      spawned++;
    }
  }

  spawnTrailParticle(x: number, y: number, z: number, colorHex: number, scale = 0.46): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.active) continue;
      p.active = true;
      p.x = x + (Math.random() - 0.5) * 0.08;
      p.y = y + (Math.random() - 0.5) * 0.08;
      p.z = z + (Math.random() - 0.5) * 0.08;
      p.vx = (Math.random() - 0.5) * 0.28;
      p.vy = 0.15 + Math.random() * 0.25;
      p.vz = (Math.random() - 0.5) * 0.28;
      p.scale = scale;
      p.maxLife = 0.22;
      p.life = 0.22;
      p.gravity = 0.2;
      p.color.setHex(colorHex);
      return;
    }
  }

  spawnPulseRing(x: number, y: number, z: number, maxRadius: number, colorHex: number): void {
    for (let i = 0; i < this.pulseRings.length; i++) {
      const r = this.pulseRings[i];
      if (r.active) continue;
      r.active = true;
      r.x = x;
      r.y = y;
      r.z = z;
      r.maxRadius = maxRadius;
      r.maxLife = 0.34;
      r.life = r.maxLife;
      r.color.setHex(colorHex);
      return;
    }
  }

  spawnLightningArc(points: readonly Vec3[]): void {
    this.lightning.spawn(points);
  }

  spawnMeteorTelegraph(x: number, z: number, radius: number, delaySec = 0.32): void {
    const dur = Math.max(0.05, delaySec);
    for (let i = 0; i < this.telegraphRings.length; i++) {
      const tr = this.telegraphRings[i];
      if (tr.active) continue;
      tr.active = true;
      tr.x = x;
      tr.y = 0.08;
      tr.z = z;
      tr.radius = radius;
      tr.maxLife = dur;
      tr.life = dur;
      break;
    }

    for (let i = 0; i < this.meteorOrbs.length; i++) {
      const orb = this.meteorOrbs[i];
      if (orb.active) continue;
      orb.active = true;
      orb.mode = 'falling';
      orb.x = x;
      orb.y = 0.25;
      orb.z = z;
      orb.startX = x + 2.8;
      orb.startY = 12.5;
      orb.startZ = z + 2.2;
      orb.scale = 1.15;
      orb.maxLife = dur;
      orb.life = dur;
      break;
    }
  }

  spawnMeteorVisual(x: number, y: number, z: number, radius: number): void {
    let hadFallingOrb = false;
    for (let i = 0; i < this.meteorOrbs.length; i++) {
      const orb = this.meteorOrbs[i];
      if (orb.active && orb.mode === 'falling') {
        const dSq = (orb.x - x) * (orb.x - x) + (orb.z - z) * (orb.z - z);
        if (dSq <= 1.0) {
          orb.active = false;
          hadFallingOrb = true;
        }
      }
    }
    for (let i = 0; i < this.telegraphRings.length; i++) {
      const tr = this.telegraphRings[i];
      if (tr.active) {
        const dSq = (tr.x - x) * (tr.x - x) + (tr.z - z) * (tr.z - z);
        if (dSq <= 1.0) {
          tr.active = false;
        }
      }
    }

    // Blast core flash orb
    for (let i = 0; i < this.meteorOrbs.length; i++) {
      const orb = this.meteorOrbs[i];
      if (orb.active) continue;
      orb.active = true;
      orb.mode = 'blast';
      orb.x = x;
      orb.y = Math.max(0.25, y);
      orb.z = z;
      orb.startX = x;
      orb.startY = orb.y;
      orb.startZ = z;
      orb.scale = Math.max(1.2, radius * 0.52);
      orb.maxLife = 0.26;
      orb.life = 0.26;
      break;
    }

    // If meteorImpact occurred without an explicit telegraph call, also add a brief fiery sky streak
    if (!hadFallingOrb) {
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        this.spawnTrailParticle(
          x + t * 2.2,
          Math.max(0.3, y) + t * 6.5,
          z + t * 1.6,
          i % 2 === 0 ? PALETTE_HEX.gold : PALETTE_HEX.coral,
          0.95 - t * 0.35,
        );
      }
    }

    // Scorch crater decal
    for (let i = 0; i < this.scorchCraters.length; i++) {
      const c = this.scorchCraters[i];
      if (c.active) continue;
      c.active = true;
      c.x = x;
      c.y = 0.04;
      c.z = z;
      c.radius = radius * 0.72;
      c.maxLife = 1.55;
      c.life = 1.55;
      break;
    }

    // Shockwave rings + fiery scorch particles
    this.spawnPulseRing(x, 0.09, z, radius, PALETTE_HEX.coral);
    this.spawnPulseRing(x, 0.11, z, radius * 0.68, PALETTE_HEX.gold);
    this.spawnParticles(x, Math.max(0.25, y), z, PALETTE_HEX.gold, 12, 5.4, 7.5);
    this.spawnParticles(x, Math.max(0.25, y), z, PALETTE_HEX.coral, 12, 6.2, 8.0);
    this.spawnParticles(x, Math.max(0.2, y), z, 0x3b2232, 8, 3.8, 9.0);
  }

  spawnStunSparks(x: number, y: number, z: number, count = 8): void {
    const primaryCount = Math.ceil(count * 0.65);
    const secondaryCount = Math.max(0, count - primaryCount);
    this.spawnParticles(x, y, z, 0xd45cff, primaryCount, 2.8, 3.5);
    if (secondaryCount > 0) {
      this.spawnParticles(x, y, z, PALETTE_HEX.gold, secondaryCount, 2.3, 3.0);
    }
  }

  update(dt: number): void {
    let sCount = 0;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        continue;
      }
      s.vy -= 14 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.y < 0.08) {
        s.y = 0.08;
        s.vy = Math.abs(s.vy) * 0.42;
        s.vx *= 0.72;
        s.vz *= 0.72;
      }
      s.rx += s.vrx * dt;
      s.ry += s.vry * dt;

      const fade = Math.min(1, (s.life / s.maxLife) * 1.4);
      _dummy.position.set(s.x, s.y, s.z);
      _dummy.rotation.set(s.rx, s.ry, 0);
      _dummy.scale.setScalar(s.scale * fade);
      _dummy.updateMatrix();
      this.shardMesh.setMatrixAt(sCount, _dummy.matrix);
      this.shardMesh.setColorAt(sCount, s.color);
      sCount++;
    }
    this.shardMesh.count = sCount;
    this.shardMesh.visible = sCount > 0;
    if (sCount > 0) {
      this.shardMesh.instanceMatrix.needsUpdate = true;
      if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
    }

    let pCount = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.04, p.y + p.vy * dt);
      p.z += p.vz * dt;

      const fade = p.life / p.maxLife;
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(p.scale * fade);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(pCount, _dummy.matrix);
      this.particleMesh.setColorAt(pCount, p.color);
      pCount++;
    }
    this.particleMesh.count = pCount;
    this.particleMesh.visible = pCount > 0;
    if (pCount > 0) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    }

    let rCount = 0;
    for (let i = 0; i < this.pulseRings.length; i++) {
      const r = this.pulseRings[i];
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        continue;
      }
      const progress = 1 - r.life / r.maxLife;
      const radius = 0.25 + (r.maxRadius - 0.25) * (1 - Math.pow(1 - progress, 2));
      _dummy.position.set(r.x, r.y, r.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(radius);
      _dummy.updateMatrix();
      this.pulseRingMesh.setMatrixAt(rCount, _dummy.matrix);
      this.pulseRingMesh.setColorAt(rCount, r.color);
      rCount++;
    }
    this.pulseRingMesh.count = rCount;
    this.pulseRingMesh.visible = rCount > 0;
    if (rCount > 0) {
      this.pulseRingMesh.instanceMatrix.needsUpdate = true;
      if (this.pulseRingMesh.instanceColor) this.pulseRingMesh.instanceColor.needsUpdate = true;
    }

    let mCount = 0;
    for (let i = 0; i < this.meteorOrbs.length; i++) {
      const orb = this.meteorOrbs[i];
      if (!orb.active) continue;
      orb.life -= dt;
      if (orb.life <= 0) {
        orb.active = false;
        continue;
      }

      const progress = 1 - orb.life / orb.maxLife;
      if (orb.mode === 'falling') {
        const ease = progress * progress;
        const cx = orb.startX + (orb.x - orb.startX) * ease;
        const cy = orb.startY + (orb.y - orb.startY) * ease;
        const cz = orb.startZ + (orb.z - orb.startZ) * ease;
        _dummy.position.set(cx, cy, cz);
        _dummy.rotation.set(progress * 12, progress * 9, 0);
        _dummy.scale.setScalar(orb.scale * (0.85 + 0.35 * progress));
        _dummy.updateMatrix();
        this.meteorOrbMesh.setMatrixAt(mCount++, _dummy.matrix);
        if (dt > 0) {
          this.spawnTrailParticle(cx, cy, cz, PALETTE_HEX.gold, 0.78);
        }
      } else {
        const s = orb.scale * (1 - progress * progress);
        _dummy.position.set(orb.x, orb.y, orb.z);
        _dummy.rotation.set(0, progress * 4, 0);
        _dummy.scale.setScalar(Math.max(0.01, s));
        _dummy.updateMatrix();
        this.meteorOrbMesh.setMatrixAt(mCount++, _dummy.matrix);
      }
    }
    this.meteorOrbMesh.count = mCount;
    this.meteorOrbMesh.visible = mCount > 0;
    if (mCount > 0) {
      this.meteorOrbMesh.instanceMatrix.needsUpdate = true;
    }

    let scCount = 0;
    for (let i = 0; i < this.scorchCraters.length; i++) {
      const c = this.scorchCraters[i];
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        continue;
      }
      const norm = c.life / c.maxLife;
      const shrink = norm < 0.45 ? norm / 0.45 : 1;
      _dummy.position.set(c.x, c.y, c.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(c.radius * shrink);
      _dummy.updateMatrix();
      this.scorchDiscMesh.setMatrixAt(scCount++, _dummy.matrix);
    }
    this.scorchDiscMesh.count = scCount;
    this.scorchDiscMesh.visible = scCount > 0;
    if (scCount > 0) {
      this.scorchDiscMesh.instanceMatrix.needsUpdate = true;
    }

    let tCount = 0;
    for (let i = 0; i < this.telegraphRings.length; i++) {
      const tr = this.telegraphRings[i];
      if (!tr.active) continue;
      tr.life -= dt;
      if (tr.life <= 0) {
        tr.active = false;
        continue;
      }
      const progress = 1 - tr.life / tr.maxLife;
      const pulse = 0.92 + Math.sin(progress * Math.PI * 3) * 0.08;
      _dummy.position.set(tr.x, tr.y, tr.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(tr.radius * pulse);
      _dummy.updateMatrix();
      this.telegraphRingMesh.setMatrixAt(tCount++, _dummy.matrix);
    }
    this.telegraphRingMesh.count = tCount;
    this.telegraphRingMesh.visible = tCount > 0;
    if (tCount > 0) {
      this.telegraphRingMesh.instanceMatrix.needsUpdate = true;
    }

    this.lightning.update(dt);
  }

  getActiveFxCount(): number {
    return (
      this.shardMesh.count +
      this.particleMesh.count +
      this.pulseRingMesh.count +
      this.meteorOrbMesh.count +
      this.scorchDiscMesh.count +
      this.telegraphRingMesh.count
    );
  }

  clearEffects(): void {
    for (let i = 0; i < this.shards.length; i++) this.shards[i].active = false;
    for (let i = 0; i < this.particles.length; i++) this.particles[i].active = false;
    for (let i = 0; i < this.pulseRings.length; i++) this.pulseRings[i].active = false;
    for (let i = 0; i < this.meteorOrbs.length; i++) this.meteorOrbs[i].active = false;
    for (let i = 0; i < this.scorchCraters.length; i++) this.scorchCraters[i].active = false;
    for (let i = 0; i < this.telegraphRings.length; i++) this.telegraphRings[i].active = false;
    this.lightning.clear();
    this.shardMesh.count = 0;
    this.particleMesh.count = 0;
    this.pulseRingMesh.count = 0;
    this.meteorOrbMesh.count = 0;
    this.scorchDiscMesh.count = 0;
    this.telegraphRingMesh.count = 0;
    this.shardMesh.visible = false;
    this.particleMesh.visible = false;
    this.pulseRingMesh.visible = false;
    this.meteorOrbMesh.visible = false;
    this.scorchDiscMesh.visible = false;
    this.telegraphRingMesh.visible = false;
  }

  dispose(): void {
    this.lightning.dispose();
    this.shardMesh.dispose();
    this.particleMesh.dispose();
    this.pulseRingMesh.dispose();
    this.meteorOrbMesh.dispose();
    this.scorchDiscMesh.dispose();
    this.telegraphRingMesh.dispose();
    this.group.clear();
    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i].dispose();
    }
    this.geometries.length = 0;
    for (let i = 0; i < this.ownMaterials.length; i++) {
      this.ownMaterials[i].dispose();
    }
    this.ownMaterials.length = 0;
  }
}
