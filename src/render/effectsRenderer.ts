import * as THREE from 'three';
import type { EnemyType, Vec3 } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { LightningArcPool } from './lightningPool.ts';

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

const _dummy = new THREE.Object3D();
const _enemyShardColors: Record<EnemyType, number> = {
  grunt: PALETTE_HEX.coral,
  runner: PALETTE_HEX.gold,
  brute: PALETTE_HEX.stone,
  flyer: PALETTE_HEX.cream,
  healer: PALETTE_HEX.grass,
  boss: PALETTE_HEX.indigo,
};

export class EffectsRenderer {
  readonly group = new THREE.Group();

  private readonly shardMesh: THREE.InstancedMesh;
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly pulseRingMesh: THREE.InstancedMesh;
  private readonly lightning = new LightningArcPool();

  private readonly shards: Shard[] = [];
  private readonly particles: Particle[] = [];
  private readonly pulseRings: PulseRing[] = [];

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
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
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
      color: 0xffffff,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
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

    this.lightning.update(dt);
  }

  getActiveFxCount(): number {
    return this.shardMesh.count + this.particleMesh.count + this.pulseRingMesh.count;
  }

  clearEffects(): void {
    for (let i = 0; i < this.shards.length; i++) this.shards[i].active = false;
    for (let i = 0; i < this.particles.length; i++) this.particles[i].active = false;
    for (let i = 0; i < this.pulseRings.length; i++) this.pulseRings[i].active = false;
    this.lightning.clear();
    this.shardMesh.count = 0;
    this.particleMesh.count = 0;
    this.pulseRingMesh.count = 0;
    this.shardMesh.visible = false;
    this.particleMesh.visible = false;
    this.pulseRingMesh.visible = false;
  }

  dispose(): void {
    this.lightning.dispose();
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
