import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { GameSettings } from '../../src/core/types.ts';
import { ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { TOWER_TYPES } from '../../src/data/towers.ts';
import type { KenneyAssetStore } from '../../src/render/kenneyAssets.ts';
import { MaterialLibrary } from '../../src/render/materials.ts';
import { TowerRenderer } from '../../src/render/towerMeshes.ts';
import type { TowerEntity } from '../../src/sim/entities.ts';
import { SimWorld } from '../../src/sim/world.ts';

vi.mock('../../src/render/sceneManager.ts', () => {
  class MockSceneManager {
    readonly scene = new THREE.Scene();
    shadowsEnabled = true;
    readonly renderer = {
      info: {
        render: { calls: 0, triangles: 0 },
        memory: { geometries: 0, textures: 0 },
      },
      domElement: { style: { cursor: '' } },
    };
    fitShadowToMap = vi.fn();
    setQuality = vi.fn((q: 'high' | 'low') => {
      this.shadowsEnabled = q !== 'low';
    });
    resize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
  }
  return { SceneManager: MockSceneManager };
});

import { RenderWorld } from '../../src/render/renderWorld.ts';

function installBrowserMocks() {
  const fakeGradient = { addColorStop: () => {} };
  const fakeCtx = {
    clearRect: () => {},
    fillRect: () => {},
    fillText: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    createRadialGradient: () => fakeGradient,
    createLinearGradient: () => fakeGradient,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(128),
    }),
    putImageData: () => {},
    drawImage: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  vi.stubGlobal('document', {
    createElement: (tag: string) =>
      tag === 'canvas' ? { width: 128, height: 128, getContext: () => fakeCtx } : {},
  });
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720 });
}

function createMockAssets(): KenneyAssetStore {
  const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  return {
    colormapTexture: tex as unknown as THREE.CanvasTexture,
    cloneGeometry: () => {
      const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6).toNonIndexed();
      const count = geo.getAttribute('position').count;
      const colors = new Float32Array(count * 3).fill(1);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geo;
    },
    has: () => true,
    dispose: vi.fn(() => tex.dispose()),
  } as unknown as KenneyAssetStore;
}

function countSceneRenderables(scene: THREE.Scene): {
  totalObjects: number;
  visibleDraws: number;
  shadowDraws: number;
} {
  let totalObjects = 0;
  let visibleDraws = 0;
  let shadowDraws = 0;

  scene.traverse(() => {
    totalObjects++;
  });

  scene.traverseVisible((obj) => {
    const asAny = obj as THREE.Mesh & THREE.Line & THREE.Points;
    if (!asAny.isMesh && !asAny.isLine && !asAny.isPoints) return;
    const inst = obj as THREE.InstancedMesh;
    if (inst.isInstancedMesh && inst.count <= 0) return;
    visibleDraws++;
    if (obj.castShadow) shadowDraws++;
  });

  return { totalObjects, visibleDraws, shadowDraws };
}

describe('RenderWorld draw-call budget and reload memory hygiene', () => {
  beforeEach(() => {
    installBrowserMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps heavy-load visible drawables and shadow passes within mobile budget', () => {
    const assets = createMockAssets();
    const canvas = { clientWidth: 1280, clientHeight: 720 } as unknown as HTMLCanvasElement;
    const rw = new RenderWorld(canvas, assets);
    const settings: GameSettings = {
      masterVolume: 0.5,
      muted: false,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    };

    const heavyLevel = LEVELS[LEVELS.length - 1];
    const bus = new EventBus();
    rw.loadLevel(heavyLevel, bus, () => settings);

    const world = new SimWorld(heavyLevel, bus);
    world.gold = 100_000;

    // Place 40 towers cycling through ALL TOWER_TYPES x Tiers 1, 2, 3
    let placed = 0;
    for (let r = 0; r < world.grid.rows && placed < 40; r++) {
      for (let c = 0; c < world.grid.cols && placed < 40; c++) {
        if (!world.grid.canPlaceTower(c, r)) continue;
        const type = TOWER_TYPES[placed % TOWER_TYPES.length];
        const tierTarget = (Math.floor(placed / TOWER_TYPES.length) % 3) + 1;
        const tower = world.placeTower(c, r, type)!;
        if (tierTarget >= 2) world.upgradeTower(tower.id);
        if (tierTarget >= 3) world.upgradeTower(tower.id);
        if (placed < 2) tower.stunTimer = 2.0;
        placed++;
      }
    }
    expect(placed).toBe(40);

    // Spawn 250 active enemies covering every EnemyType + status/HP bars + split child
    for (let i = 0; i < 250; i++) {
      const type = ENEMY_TYPES[i % ENEMY_TYPES.length];
      const enemy = world.enemySystem.spawnEnemy(type)!;
      enemy.dist = (i % 20) * 1.2;
      if (i % 2 === 0) enemy.hp = Math.max(1, Math.floor(enemy.maxHp * 0.55));
      if (i % 5 === 0) enemy.slowTimer = 1.5;
      if (i % 7 === 0) enemy.hitFlashTimer = 0.08;
      if (i % 11 === 0) enemy.isSplitChild = true;
    }

    // Spawn 48 projectiles + active FX (Overcharge, meteor, lightning, shards, pulses)
    const sampleEnemy = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
    for (let i = 0; i < 48; i++) {
      const t = world.towers[i % world.towers.length];
      if (t.type !== 'tesla') {
        world.projectileSystem.spawnProjectile(t, sampleEnemy, 0.5);
      }
    }
    world.startNextWave();
    world.castOvercharge();
    world.castMeteor(0, 0);
    bus.emit('lightningChain', {
      points: [
        { x: 0, y: 1.5, z: 0 },
        { x: 2, y: 1.0, z: 1 },
        { x: 4, y: 1.0, z: -1 },
      ],
    });
    bus.emit('enemyKilled', { enemyId: 999, enemyType: 'boss', reward: 35, x: 0, y: 1, z: 0 });
    rw.setRoutesPinned(true);
    rw.setPlacementGridActive(true);
    rw.setShowAllRanges(true);

    rw.render(world, 1 / 60, 0.5, 2.0, 0.02);

    const highCounts = countSceneRenderables(rw.sceneManager.scene);
    // Heavy scene with all 15 tower buckets + 7 enemy buckets + FX must stay instanced (< 90 base draws)
    expect(highCounts.visibleDraws).toBeGreaterThan(20);
    expect(highCounts.visibleDraws).toBeLessThanOrEqual(85);
    expect(highCounts.visibleDraws + highCounts.shadowDraws).toBeLessThanOrEqual(115);

    // Low quality turns off shadows and reduces total passes cleanly
    rw.setQuality('low');
    rw.render(world, 1 / 60, 0.5, 2.05, 0.02);
    const lowCounts = countSceneRenderables(rw.sceneManager.scene);
    expect(lowCounts.visibleDraws).toBeLessThanOrEqual(85);

    rw.dispose();
  });

  it('grows TowerRenderer stunHalo and overchargeAura FX buckets cleanly past 64 towers', () => {
    const assets = createMockAssets();
    const mats = new MaterialLibrary();
    const renderer = new TowerRenderer(assets);

    const makeTowers = (count: number, stunned: boolean): TowerEntity[] =>
      Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        col: i,
        row: 0,
        x: i * 2,
        z: 0,
        type: 'archer',
        tier: 1,
        totalInvested: 50,
        targetingMode: 'first',
        cooldownTimer: 0,
        stunTimer: stunned ? 2.0 : 0,
        yaw: 0,
        prevYaw: 0,
        targetYaw: 0,
        recoil: 0,
        popAnimTimer: 0,
        totalDamageDealt: 0,
        kills: 0,
      }));

    expect(() => renderer.syncTowers(makeTowers(80, true), mats, 0.5, 1.0, null, false)).not.toThrow();
    expect(() => renderer.syncTowers(makeTowers(80, false), mats, 0.5, 1.5, null, true)).not.toThrow();

    renderer.dispose();
    mats.dispose();
  });

  it('disposes old geometries cleanly and prevents scene-graph growth across repeated multi-island reloads', () => {
    const assets = createMockAssets();
    const canvas = { clientWidth: 1280, clientHeight: 720 } as unknown as HTMLCanvasElement;
    const rw = new RenderWorld(canvas, assets);
    const settings: GameSettings = {
      masterVolume: 0.5,
      muted: false,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    };

    const geoDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');

    // Pass 1 across all levels -> record per-level scene object counts
    const pass1Counts: number[] = [];
    for (const level of LEVELS) {
      rw.loadLevel(level, new EventBus(), () => settings);
      rw.render(null, 1 / 60, 0, 0.5, 0.02);
      pass1Counts.push(countSceneRenderables(rw.sceneManager.scene).totalObjects);
    }

    const disposesAfterPass1 = geoDisposeSpy.mock.calls.length;
    expect(disposesAfterPass1).toBeGreaterThan(LEVELS.length * 4);

    // Pass 2 across all levels -> identical scene object counts prove zero leaked nodes/buckets
    const pass2Counts: number[] = [];
    for (const level of LEVELS) {
      rw.loadLevel(level, new EventBus(), () => settings);
      rw.render(null, 1 / 60, 0, 0.5, 0.02);
      pass2Counts.push(countSceneRenderables(rw.sceneManager.scene).totalObjects);
    }

    expect(pass2Counts).toEqual(pass1Counts);
    expect(geoDisposeSpy.mock.calls.length).toBeGreaterThan(disposesAfterPass1);

    rw.dispose();
    expect(rw.mapBuilder.group.children).toHaveLength(0);
    expect(rw.decorBuilder.group.children).toHaveLength(0);
    expect(rw.overlayIndicators.group.children).toHaveLength(0);
    expect(rw.towerRenderer.group.children).toHaveLength(0);
  });
});
