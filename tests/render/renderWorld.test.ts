import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { GameSettings } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { TOWER_TYPES } from '../../src/data/towers.ts';
import type { KenneyAssetStore } from '../../src/render/kenneyAssets.ts';
import { SimWorld } from '../../src/sim/world.ts';

const sceneMgrState = vi.hoisted(() => ({
  latest: null as {
    scene: THREE.Scene;
    shadowsEnabled: boolean;
    renderer: {
      info: {
        render: { calls: number; triangles: number };
        memory: { geometries: number; textures: number };
      };
      domElement: { style: { cursor: string } };
    };
    fitShadowToMap: ReturnType<typeof vi.fn>;
    setQuality: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  } | null,
}));

vi.mock('../../src/render/sceneManager.ts', () => {
  class MockSceneManager {
    readonly scene = new THREE.Scene();
    shadowsEnabled = true;
    readonly renderer = {
      info: {
        render: { calls: 42, triangles: 1200 },
        memory: { geometries: 18, textures: 3 },
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

    constructor() {
      sceneMgrState.latest = this;
    }
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

describe('RenderWorld integration, event FX wiring, metrics, and disposal', () => {
  beforeEach(() => {
    installBrowserMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('wires all EventBus events cleanly, clears old subscriptions on reload, and drives full render frames', () => {
    const assets = createMockAssets();
    const canvas = { clientWidth: 1280, clientHeight: 720 } as unknown as HTMLCanvasElement;
    const rw = new RenderWorld(canvas, assets);
    const mgr = sceneMgrState.latest!;

    const settings: GameSettings = {
      masterVolume: 0.5,
      muted: false,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    };

    const bus1 = new EventBus();
    rw.loadLevel(LEVELS[0], bus1, () => settings);
    expect(mgr.fitShadowToMap).toHaveBeenCalledWith(LEVELS[0].cols, LEVELS[0].rows);

    // Trigger every EventBus FX handler on bus1
    for (const type of TOWER_TYPES) {
      bus1.emit('towerFired', { towerId: 1, type, tier: 1, x: 0, y: 1, z: 0, yaw: 0.4 });
    }
    bus1.emit('towerBuilt', { towerId: 1, type: 'archer', tier: 1, x: 1, z: 1 });
    bus1.emit('towerUpgraded', { towerId: 1, type: 'archer', tier: 2, x: 1, z: 1 });
    bus1.emit('towerSold', { towerId: 1, type: 'archer', refund: 35, x: 1, z: 1 });
    bus1.emit('projectileImpact', { towerType: 'mortar', x: 0, y: 0, z: 0, radius: 2.2, isBossHit: false });
    bus1.emit('projectileImpact', { towerType: 'cannon', x: 1, y: 0, z: 1, radius: 1.9, isBossHit: false });
    bus1.emit('projectileImpact', { towerType: 'frost', x: 2, y: 0, z: 1, radius: 1.6, isBossHit: false });
    bus1.emit('projectileImpact', { towerType: 'archer', x: 3, y: 0, z: 1, radius: 0, isBossHit: false });
    bus1.emit('lightningChain', { points: [{ x: 0, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }] });
    bus1.emit('enemyKilled', { enemyId: 1, enemyType: 'boss', reward: 30, x: 0, y: 0.5, z: 0 });
    bus1.emit('healerPulse', { x: 0, y: 0, z: 0, radius: 3.8 });
    bus1.emit('enemySplit', { parentUid: 2, x: 0, y: 0, z: 0, count: 2 });
    bus1.emit('bossPulse', { x: 0, y: 0, z: 0, radius: 7.6, stunnedTowerIds: [1] });
    bus1.emit('bossSummon', { x: 0, y: 0, z: 0, count: 2 });
    bus1.emit('abilityTargeted', { abilityId: 'meteor', x: 0, z: 0, radius: 3.4 });
    bus1.emit('meteorImpact', { x: 0, y: 0.25, z: 0, radius: 3.4 });

    rw.render(null, 1 / 60, 0, 0.1, 0.02);
    expect(rw.effectsRenderer.getActiveFxCount()).toBeGreaterThan(0);

    // Reloading a second level must unsubscribe all bus1 listeners
    const bus2 = new EventBus();
    rw.loadLevel(LEVELS[1], bus2, () => settings);
    rw.render(null, 1 / 60, 0, 0.2, 0.02);
    expect(rw.effectsRenderer.getActiveFxCount()).toBe(0);
    bus1.emit('towerBuilt', { towerId: 9, type: 'archer', tier: 1, x: 0, z: 0 });
    rw.render(null, 1 / 60, 0, 0.22, 0.02);
    expect(rw.effectsRenderer.getActiveFxCount()).toBe(0);

    // Run a live SimWorld render frame with towers, enemies, projectiles, trails, and picking
    const world = new SimWorld(LEVELS[1], bus2);
    world.gold = 3000;
    const archer = world.placeTower(2, 3, 'archer')!;
    const frost = world.placeTower(4, 5, 'frost')!;
    const mortar = world.placeTower(5, 6, 'mortar')!;
    const cannon = world.placeTower(2, 5, 'cannon')!;
    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    grunt.x = archer.x + 2;
    grunt.z = archer.z;

    for (const t of [archer, frost, mortar, cannon]) {
      world.projectileSystem.spawnProjectile(t, grunt, 0.5);
    }

    // Force trail spawning deterministically (Math.random() <= trailChance)
    vi.spyOn(Math, 'random').mockReturnValue(0);
    rw.setShowAllRanges(true);
    rw.setHoveredTowerId(archer.id);
    rw.setPlacementGridActive(true);
    rw.setRoutesPinned(true);
    rw.setFlightPathHighlight(true, true);
    rw.setPlacementPreview(true, 'archer', archer.x, archer.z, true);
    rw.setMeteorTargetPreview(true, 0, 0, 3.4);
    rw.setCanvasCursor('crosshair');
    expect(mgr.renderer.domElement.style.cursor).toBe('crosshair');

    rw.render(world, 1 / 60, 0.5, 1.0, 0.05);
    expect(mgr.render).toHaveBeenCalledTimes(4);

    // Paused frame (fxDt = 0) uploads existing build + trail FX without spawning more
    rw.render(world, 1 / 60, 0.5, 1.02, 0);
    const fxCountPaused = rw.effectsRenderer.getActiveFxCount();
    expect(fxCountPaused).toBeGreaterThan(60); // 4 towerBuilt bursts (64) + 4 trail particles
    rw.render(world, 1 / 60, 0.5, 1.04, 0);
    expect(rw.effectsRenderer.getActiveFxCount()).toBe(fxCountPaused);

    // Picking a placed tower via projected NDC returns the exact tower
    const proj = new THREE.Vector3(archer.x, 0.5, archer.z).project(rw.cameraController.camera);
    expect(rw.pickTowerAtNdc(proj.x, proj.y, world.towers)?.id).toBe(archer.id);

    // Verify render metrics math with shadows on vs off
    const mHigh = rw.getRenderMetrics();
    expect(mHigh.drawCalls).toBe(42);
    expect(mHigh.drawsWithShadows).toBe(42);
    expect(mHigh.drawsNoShadows).toBeLessThan(42);
    expect(mHigh.triangles).toBe(1200);
    expect(rw.getMemoryStats()).toEqual({ geometries: 18, textures: 3 });

    rw.setQuality('low');
    expect(rw.materials.outlineAlphaUniform.value).toBe(0);
    const mLow = rw.getRenderMetrics();
    expect(mLow.drawsNoShadows).toBe(42);
    expect(mLow.drawsWithShadows).toBeGreaterThan(42);

    rw.resize(800, 600);
    expect(mgr.resize).toHaveBeenCalledWith(800, 600);

    rw.dispose();
    expect(mgr.dispose).toHaveBeenCalledTimes(1);
    expect((assets.dispose as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(BALANCE.fixedDt).toBeCloseTo(1 / 60, 8);
  });
});
