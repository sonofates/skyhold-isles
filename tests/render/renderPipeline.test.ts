import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { SeededRng } from '../../src/core/rng.ts';
import type { TowerType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { PALETTE_HEX, type PaletteKey } from '../../src/data/palette.ts';
import { TOWER_TYPES, getTowerTierStats } from '../../src/data/towers.ts';
import { AmbientDiorama } from '../../src/render/ambientDiorama.ts';
import { DecorBuilder } from '../../src/render/decorBuilder.ts';
import { EffectsRenderer } from '../../src/render/effectsRenderer.ts';
import { EnemyRenderer } from '../../src/render/enemyMeshes.ts';
import { GroundDetails } from '../../src/render/groundDetails.ts';
import type { KenneyAssetStore } from '../../src/render/kenneyAssets.ts';
import { createHarmonizedColormapTexture } from '../../src/render/kenneyPalette.ts';
import { MapBuilder } from '../../src/render/mapBuilder.ts';
import { MaterialLibrary } from '../../src/render/materials.ts';
import { OverlayIndicators } from '../../src/render/overlayIndicators.ts';
import { ProjectileRenderer } from '../../src/render/projectileRenderer.ts';
import { TowerBadgeRenderer } from '../../src/render/towerBadges.ts';
import { TowerRenderer } from '../../src/render/towerMeshes.ts';
import type { TowerEntity } from '../../src/sim/entities.ts';
import { SimWorld } from '../../src/sim/world.ts';

function installCanvasMock() {
  const fillRectCalls: Array<[number, number, number, number]> = [];
  const fakeGradient = { addColorStop: () => {} };
  const fakeCtx = {
    clearRect: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => fillRectCalls.push([x, y, w, h]),
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
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return { width: 128, height: 128, getContext: () => fakeCtx };
      }
      return {};
    },
  });

  return { fillRectCalls };
}

function createFakeAssetStore(): KenneyAssetStore {
  return {
    cloneGeometry: () => {
      const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6).toNonIndexed();
      const count = geo.getAttribute('position').count;
      const colors = new Float32Array(count * 3).fill(1);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geo;
    },
    has: () => true,
    dispose: () => {},
  } as unknown as KenneyAssetStore;
}

function makeTower(
  id: number,
  type: TowerType,
  tier: 1 | 2 | 3,
  x: number,
  z: number,
  col = 0,
  row = 0,
): TowerEntity {
  return {
    id,
    col,
    row,
    x,
    z,
    type,
    tier,
    totalInvested: getTowerTierStats(type, 1).upgradeCost,
    targetingMode: 'first',
    cooldownTimer: 0,
    stunTimer: 0,
    yaw: 0,
    prevYaw: 0,
    targetYaw: 0,
    recoil: 0,
    popAnimTimer: 0,
    totalDamageDealt: 0,
    kills: 0,
  };
}

describe('RenderWorld subsystems headless verification', () => {
  beforeEach(() => {
    installCanvasMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates MaterialLibrary and harmonized Kenney colormap texture cleanly', () => {
    const mockSource = { width: 64, height: 32 } as HTMLCanvasElement;
    const colormap = createHarmonizedColormapTexture(mockSource);
    expect(colormap.flipY).toBe(false);
    expect(colormap.generateMipmaps).toBe(false);
    expect(colormap.minFilter).toBe(THREE.LinearFilter);
    expect(colormap.magFilter).toBe(THREE.LinearFilter);

    const mats = new MaterialLibrary(colormap);
    for (const key of Object.keys(PALETTE_HEX) as PaletteKey[]) {
      expect(mats.getSolid(key).color.getHex()).toBe(PALETTE_HEX[key]);
    }
    expect(mats.outlineAlphaUniform.value).toBe(1);
    mats.setOutlineAlphaEnabled(false);
    expect(mats.outlineAlphaUniform.value).toBe(0);

    // Verify every onBeforeCompile shader hook cleanly patches Three.js ShaderLib templates
    const compileCheck = (
      mat: THREE.Material,
      baseLib: { vertexShader: string; fragmentShader: string },
    ) => {
      const params = {
        uniforms: {},
        vertexShader: baseLib.vertexShader,
        fragmentShader: baseLib.fragmentShader,
      } as unknown as THREE.WebGLProgramParametersWithUniforms;
      mat.onBeforeCompile(params, {} as THREE.WebGLRenderer);
      return params;
    };

    const towerShader = compileCheck(mats.kenneyTower, THREE.ShaderLib.standard);
    expect(mats.kenneyTower.customProgramCacheKey()).toContain('kenney-tower');
    expect(towerShader.vertexShader).toContain('attribute float aHighlight;');
    expect(towerShader.fragmentShader).toContain('uniform float uOutlineAlpha;');
    expect(towerShader.uniforms.uOutlineAlpha).toBe(mats.outlineAlphaUniform);

    const waterShader = compileCheck(mats.waterMaterial, THREE.ShaderLib.standard);
    expect(mats.waterMaterial.customProgramCacheKey()).toContain('water-vertex-waves');
    expect(waterShader.vertexShader).toContain('uniform float uWaterTime;');
    expect(waterShader.fragmentShader).toContain('varying float vWaterRNorm;');
    expect(waterShader.uniforms.uWaterTime).toBe(mats.waterUniforms.uWaterTime);

    const enemyShader = compileCheck(mats.enemyInstancedMaterial, THREE.ShaderLib.standard);
    expect(mats.enemyInstancedMaterial.customProgramCacheKey()).toContain('enemy-instanced-flash');
    expect(enemyShader.vertexShader).toContain('attribute float aFlash;');
    expect(enemyShader.fragmentShader).toContain('totalEmissiveRadiance += vec3(0.62, 0.52, 0.42) * vFlash;');

    const hpShader = compileCheck(mats.hpBarMaterial, THREE.ShaderLib.basic);
    expect(mats.hpBarMaterial.customProgramCacheKey()).toContain('enemy-hp-bar');
    expect(hpShader.vertexShader).toContain('attribute float aHpRatio;');
    expect(hpShader.fragmentShader).toContain('uniform vec3 uHpBgColor;');

    mats.dispose();
    colormap.dispose();

    // MaterialLibrary and TowerBadgeRenderer survive null 2D canvas context gracefully
    vi.stubGlobal('document', {
      createElement: () => ({ width: 64, height: 64, getContext: () => null }),
    });
    const nullCtxMats = new MaterialLibrary();
    const nullCtxBadges = new TowerBadgeRenderer();
    nullCtxBadges.sync([makeTower(1, 'archer', 1, 0, 0)], 100, new THREE.Quaternion(), 0.5, 1);
    nullCtxBadges.dispose();
    nullCtxMats.dispose();
  });

  it('EffectsRenderer spawns, caps pools, animates, expires, and clears every FX type', () => {
    const fx = new EffectsRenderer();
    expect(fx.getActiveFxCount()).toBe(0);

    // Every registered EnemyType must produce non-black death shards cleanly
    const shardMesh = fx.group.children[0] as THREE.InstancedMesh;
    const shardCol = new THREE.Color();
    for (const enemyType of ENEMY_TYPES) {
      fx.clearEffects();
      fx.spawnDeathShards(enemyType, 1, 0.5, -2);
      fx.update(0.01);
      expect(shardMesh.count).toBeGreaterThanOrEqual(7);
      // Slot 1 uses the type-specific shard color (slot 0 uses PALETTE_HEX.cream)
      shardMesh.getColorAt(1, shardCol);
      expect(shardCol.r + shardCol.g + shardCol.b).toBeGreaterThan(0.05);
    }

    // Overflow shard, particle, pulse, meteor, and scorch pools safely without throwing
    for (let i = 0; i < BALANCE.pools.maxShards + 20; i++) {
      fx.spawnDeathShards('boss', 0, 0.5, 0);
    }
    for (let i = 0; i < BALANCE.pools.maxParticles + 50; i++) {
      fx.spawnTrailParticle(i * 0.1, 0.4, 0, PALETTE_HEX.gold);
    }
    for (let i = 0; i < BALANCE.pools.maxPulseRings + 10; i++) {
      fx.spawnPulseRing(0, 0.1, 0, 2.5, PALETTE_HEX.coral);
    }

    // Meteor telegraph followed by dt=0 (paused) advances zero trail particles, then active dt spawns trail particles;
    // Two staggered telegraphs >1 unit apart resolve independently
    fx.clearEffects();
    fx.spawnMeteorTelegraph(3, -4, 3.4, 0.32);
    fx.spawnMeteorTelegraph(-6, 5, 3.4, 0.32);
    fx.update(0);
    fx.update(0);
    const particleMesh = fx.group.children[1] as THREE.InstancedMesh;
    expect(particleMesh.count).toBe(0);
    fx.update(0.05);
    fx.update(0.01);
    expect(particleMesh.count).toBeGreaterThan(0);
    expect(fx.getActiveFxCount()).toBeGreaterThan(0);
    fx.spawnMeteorVisual(3, 0.25, -4, 3.4);
    const telegraphMesh = fx.group.children[5] as THREE.InstancedMesh;
    fx.update(0.01);
    expect(telegraphMesh.count).toBe(1); // (-6, 5) telegraph still active while (3, -4) resolved

    // Impact without telegraph triggers sky streak fallback; overflow meteor/scorch pools & 0/1 stun sparks safely
    fx.spawnMeteorVisual(-3, 0.25, 4, 3.4);
    fx.spawnStunSparks(0, 1, 0, 0);
    fx.spawnStunSparks(0, 1, 0, 1);
    fx.spawnStunSparks(0, 1, 0, 10);
    fx.spawnLightningArc([
      { x: 0, y: 1, z: 0 },
      { x: 2, y: 1, z: 1 },
    ]);

    for (let i = 0; i < 14; i++) {
      fx.spawnMeteorTelegraph(i * 3, 10, 3.4, 0.32);
      fx.spawnMeteorVisual(i * 3, 0.25, 10, 3.4);
    }
    fx.update(0.05);
    const scorchDiscMesh = fx.group.children[4] as THREE.InstancedMesh;
    expect(scorchDiscMesh.count).toBe(12);
    expect(fx.getActiveFxCount()).toBeGreaterThan(0);

    // Advance beyond longest FX lifetime (scorch crater ~1.55s) -> all FX expire
    for (let i = 0; i < 40; i++) {
      fx.update(0.06);
    }
    expect(fx.getActiveFxCount()).toBe(0);

    fx.spawnParticles(0, 1, 0, PALETTE_HEX.cream, 10, 2.5);
    fx.update(0.02);
    expect(fx.getActiveFxCount()).toBeGreaterThan(0);
    fx.clearEffects();
    expect(fx.getActiveFxCount()).toBe(0);

    fx.dispose();
  });

  it('EnemyRenderer builds every EnemyType geometry, updates HP bars/shadows/tints/yaw, and disposes', () => {
    const mats = new MaterialLibrary();
    const renderer = new EnemyRenderer(mats);
    const world = new SimWorld(LEVELS[0], new EventBus());
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);

    const spawnedByType = ENEMY_TYPES.map((type, idx) => {
      const e = world.enemySystem.spawnEnemy(type)!;
      e.x = idx * 2;
      e.prevX = e.x - 0.5;
      e.z = 1;
      e.prevZ = 1;
      e.prevYaw = Math.PI - 0.1;
      e.yaw = -Math.PI + 0.1;
      return e;
    });

    // Mark some wounded (HP bar visible), one dead (no HP bar), one slowed, one split child
    spawnedByType[0].hp = Math.floor(spawnedByType[0].maxHp * 0.65); // green
    spawnedByType[1].hp = Math.floor(spawnedByType[1].maxHp * 0.4); // gold
    spawnedByType[2].hp = Math.max(1, Math.floor(spawnedByType[2].maxHp * 0.15)); // coral
    spawnedByType[3].slowTimer = 1.5;
    spawnedByType[3].slowRatio = 0.35;
    spawnedByType[4].hitFlashTimer = 0.06;
    spawnedByType[4].isSplitChild = true;
    spawnedByType[5].hp = 0; // dead -> excluded from HP bar

    renderer.update(world.enemyPool, 0.5, 1.25, camera);

    const hpBarMesh = renderer.group.children[ENEMY_TYPES.length] as THREE.InstancedMesh;
    const shadowMesh = renderer.group.children[ENEMY_TYPES.length + 1] as THREE.InstancedMesh;
    expect(hpBarMesh.count).toBe(3);
    expect(hpBarMesh.visible).toBe(true);
    expect(shadowMesh.count).toBe(ENEMY_TYPES.length);
    expect(shadowMesh.visible).toBe(true);

    // Every EnemyType layer has count === 1, valid bounding box, and accurate aFlash/interpolation
    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let i = 0; i < ENEMY_TYPES.length; i++) {
      const layerMesh = renderer.group.children[i] as THREE.InstancedMesh;
      expect(layerMesh.count).toBe(1);
      expect(layerMesh.visible).toBe(true);
      expect(layerMesh.geometry.boundingBox).not.toBeNull();
      expect(layerMesh.geometry.hasAttribute('aFlash')).toBe(true);
    }

    const gruntLayer = renderer.group.children[0] as THREE.InstancedMesh;
    gruntLayer.getMatrixAt(0, mat);
    pos.setFromMatrixPosition(mat);
    // spawnedByType[0] has prevX = -0.5, x = 0, alpha = 0.5 -> interpolated x = -0.25
    expect(pos.x).toBeCloseTo(-0.25, 4);

    // aFlash is > 0 only on hit-flashing enemy (index 4)
    const flashHit = (renderer.group.children[4] as THREE.InstancedMesh).geometry.getAttribute(
      'aFlash',
    ) as THREE.InstancedBufferAttribute;
    const flashCalm = gruntLayer.geometry.getAttribute('aFlash') as THREE.InstancedBufferAttribute;
    expect(flashHit.getX(0)).toBeGreaterThan(0);
    expect(flashCalm.getX(0)).toBe(0);

    // Alpha = 0 renders exact prevX; alpha = 1 renders exact x
    renderer.update(world.enemyPool, 0, 1.25, camera);
    gruntLayer.getMatrixAt(0, mat);
    expect(pos.setFromMatrixPosition(mat).x).toBeCloseTo(-0.5, 4);
    renderer.update(world.enemyPool, 1, 1.25, camera);
    gruntLayer.getMatrixAt(0, mat);
    expect(pos.setFromMatrixPosition(mat).x).toBeCloseTo(0, 4);

    // Reverse yaw wrap (-PI+0.1 -> PI-0.1) & flyer shadow decal altitude (y = 0.024)
    spawnedByType[0].prevYaw = -Math.PI + 0.1;
    spawnedByType[0].yaw = Math.PI - 0.1;
    renderer.update(world.enemyPool, 0.5, 1.25, camera);
    gruntLayer.getMatrixAt(0, mat);
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(mat);
    expect(forward.z).toBeLessThan(-0.9); // Facing -Z (~±PI), not +Z (~0)
    const flyerIdx = ENEMY_TYPES.indexOf('flyer');
    shadowMesh.getMatrixAt(flyerIdx, mat);
    expect(pos.setFromMatrixPosition(mat).y).toBeCloseTo(0.024, 4);

    renderer.clear();
    expect(hpBarMesh.count).toBe(0);
    expect(hpBarMesh.visible).toBe(false);
    expect(shadowMesh.count).toBe(0);

    renderer.dispose();
    mats.dispose();
  });

  it('TowerRenderer and ProjectileRenderer handle all types/tiers, stun/overcharge FX, bucket growth, and disposal', () => {
    const assets = createFakeAssetStore();
    const mats = new MaterialLibrary();
    const towerRenderer = new TowerRenderer(assets);
    const projRenderer = new ProjectileRenderer(mats, assets);

    // Verify TowerGeometryCache builds every registered TowerType across tiers 1..3
    for (const type of TOWER_TYPES) {
      for (const tier of [1, 2, 3] as const) {
        const pair = towerRenderer.geometryCache.get(type, tier);
        expect(pair.base.getAttribute('position').count).toBeGreaterThan(0);
        expect(pair.turret.getAttribute('position').count).toBeGreaterThan(0);
        expect(pair.turretAnchorY).toBeGreaterThan(0);
      }
    }

    // Build > 64 archer T1 towers to exercise bucket capacity growth, plus one of each type, stun, pop, hover
    const towers: TowerEntity[] = [];
    for (let i = 0; i < 70; i++) {
      const t = makeTower(i + 1, 'archer', 1, i * 2, 0, i, 0);
      if (i === 0) t.stunTimer = 1.5;
      if (i === 1) t.popAnimTimer = 0.16;
      if (i === 2) t.recoil = 0.8;
      towers.push(t);
    }
    towers.push(makeTower(101, 'cannon', 2, 0, 2));
    towers.push(makeTower(102, 'frost', 3, 2, 2));
    towers.push(makeTower(103, 'tesla', 3, 4, 2));
    towers.push(makeTower(104, 'mortar', 3, 6, 2));

    expect(() =>
      towerRenderer.syncTowers(towers, mats, 0.5, 2.0, 2, true),
    ).not.toThrow();
    const archerT1Meshes = towerRenderer.group.children.filter(
      (c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh && c.count === 70,
    );
    expect(archerT1Meshes).toHaveLength(2); // base + turret bucket both grew past 64 and hold all 70

    // Verify ProjectileRenderer updates linear + parabolic projectiles, yaw wrap across +-PI, and pitch tilt
    const world = new SimWorld(LEVELS[0], new EventBus());
    world.gold = 2000;
    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    grunt.x = 4;
    grunt.z = 0;
    const spawnedProjs = (['archer', 'cannon', 'frost', 'mortar'] as const).map((type) => {
      const t = makeTower(200, type, 1, 0, 0);
      return world.projectileSystem.spawnProjectile(t, grunt, 0.5)!;
    });
    spawnedProjs[0].prevYaw = Math.PI - 0.1;
    spawnedProjs[0].yaw = -Math.PI + 0.1;
    spawnedProjs[3].progress = 0.2;
    projRenderer.update(world.projectilePool, 0.5);
    let visibleProjMeshes = 0;
    for (const child of projRenderer.group.children) {
      const m = child as THREE.InstancedMesh;
      if (m.isInstancedMesh && m.visible) visibleProjMeshes += m.count;
    }
    expect(visibleProjMeshes).toBe(4);
    const arrowMat = new THREE.Matrix4();
    (projRenderer.group.children[0] as THREE.InstancedMesh).getMatrixAt(0, arrowMat);
    const arrowFwd = new THREE.Vector3(0, 0, 1).transformDirection(arrowMat);
    expect(arrowFwd.z).toBeLessThan(-0.9); // interpolated across +-PI to ~-PI, not 0

    projRenderer.clear();
    towerRenderer.clearInstances();

    // Verify incremental bucket growth from an existing capacity-64 bucket preserves matrices & aHighlight
    const smallBatch = Array.from({ length: 5 }, (_, i) => makeTower(i + 1, 'archer', 1, i * 2, 0, i, 0));
    towerRenderer.syncTowers(smallBatch, mats, 0.5, 2.2, 2, false);
    const grownBatch = Array.from({ length: 75 }, (_, i) => makeTower(i + 1, 'archer', 1, i * 2, 0, i, 0));
    towerRenderer.syncTowers(grownBatch, mats, 0.5, 2.5, 2, false);
    const grownMeshes = towerRenderer.group.children.filter(
      (c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh && c.count === 75,
    );
    expect(grownMeshes).toHaveLength(2);
    const grownHighlight = grownMeshes[0].geometry.getAttribute('aHighlight') as THREE.InstancedBufferAttribute;
    expect(grownHighlight.getX(1)).toBe(1);
    expect(grownHighlight.getX(0)).toBe(0);

    projRenderer.dispose();
    towerRenderer.dispose();
    mats.dispose();
  });

  it('OverlayIndicators, TowerBadgeRenderer, GroundDetails, and AmbientDiorama work across levels and edge cases', () => {
    const assets = createFakeAssetStore();
    const mats = new MaterialLibrary();
    const towerRenderer = new TowerRenderer(assets);
    const overlays = new OverlayIndicators(mats);
    const badges = new TowerBadgeRenderer();
    const groundDetails = new GroundDetails();
    const diorama = new AmbientDiorama();

    // Verify OverlayIndicators handles every island cleanly + 0/1-point degenerate path fallback
    for (const lvl of LEVELS) {
      overlays.setFlightPath(lvl);
      overlays.setBuildableGrid(lvl);
    }
    expect(() => {
      overlays.setFlightPath({
        ...LEVELS[0],
        pathWaypoints: [],
        flightPath: [{ col: 0, row: 0 }],
      });
      overlays.setFlightPath({
        ...LEVELS[0],
        pathWaypoints: [
          { col: 1, row: 1 },
          { col: 1, row: 1 },
          { col: 3, row: 1 },
        ],
        flightPath: [
          { col: 0, row: 0 },
          { col: 0, row: 0 },
          { col: 2, row: 0 },
        ],
      });
      overlays.setBuildableGrid({
        ...LEVELS[0],
        cols: 2,
        rows: 1,
        layout: ['S G'],
      });
      overlays.setPlacementGridActive(true);
      overlays.update(0.5, 0.05);
      overlays.setPlacementGridActive(false);
      overlays.update(0.5, 1.0);
    }).not.toThrow();
    overlays.setFlightPath(LEVELS[0]);
    overlays.setBuildableGrid(LEVELS[0]);

    overlays.setRoutesPinned(true);
    overlays.setFlightPathHighlight(true, true);
    overlays.setPlacementGridActive(true);
    overlays.update(0.5, 0.05);
    const overlayGroups = overlays.group.children.filter((c): c is THREE.Group => c instanceof THREE.Group);
    const flightPathGroup = overlayGroups[1];
    const groundPathGroup = overlayGroups[2];
    const flightSkyMesh = flightPathGroup.children.find(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.renderOrder === 5,
    )!;
    const flightSkyMat = flightSkyMesh.material as THREE.MeshBasicMaterial;
    const pinnedSubtleOpacity = flightSkyMat.opacity;

    const gridLines = overlays.group.children.find((c) => (c as THREE.LineSegments).isLineSegments) as THREE.LineSegments;
    expect(gridLines.visible).toBe(true);
    const gridMat = gridLines.material as THREE.LineBasicMaterial;
    expect(gridMat.opacity).toBeGreaterThan(0);
    expect(gridMat.opacity).toBeLessThan(0.3);

    overlays.update(1.5, 0.5);
    expect(gridMat.opacity).toBeCloseTo(0.3, 5);

    // Unpinning routes hides ground path while flightPathHighlight keeps flight group visible,
    // subtle unpinned flight opacity scales by 0.58 vs bright/pinned, and placement grid fades to hidden
    overlays.setRoutesPinned(false);
    overlays.update(0.5, 0);
    const unpinnedSubtleOpacity = flightSkyMat.opacity;
    expect(unpinnedSubtleOpacity).toBeCloseTo(pinnedSubtleOpacity * 0.58, 5);
    overlays.setFlightPathHighlight(true, false);
    overlays.update(0.5, 0);
    expect(flightSkyMat.opacity).toBeCloseTo(pinnedSubtleOpacity, 5);

    expect(groundPathGroup.visible).toBe(false);
    expect(flightPathGroup.visible).toBe(true);

    overlays.setPlacementGridActive(false);
    for (let i = 0; i < 20; i++) overlays.update(2.0 + i * 0.1, 0.1);
    expect(gridMat.opacity).toBe(0);
    expect(gridLines.visible).toBe(false);

    // TowerGeometryCache memoizes identical instances across repeat .get() calls
    expect(towerRenderer.geometryCache.get('archer', 1)).toBe(
      towerRenderer.geometryCache.get('archer', 1),
    );

    const mortar = makeTower(1, 'mortar', 1, 2, 2);
    const archer = makeTower(2, 'archer', 2, -2, -2);
    overlays.setPlacementPreview(true, 'mortar', 2, 2, true, towerRenderer.geometryCache);
    // Ghost group + tile highlight + placement inner/outer rings reflect mortar deadzone and valid material
    const tileHighlight = overlays.group.children[0] as THREE.Mesh;
    const ghostGroup = overlays.group.children[1] as THREE.Group;
    const placementOuterRing = overlays.group.children[2] as THREE.Mesh;
    const placementInnerRing = overlays.group.children[3] as THREE.Mesh;
    expect(tileHighlight.visible).toBe(true);
    expect(placementOuterRing.visible).toBe(true);
    expect(placementInnerRing.visible).toBe(true);
    expect((ghostGroup.children[0] as THREE.Mesh).material).toBe(mats.ghostValidMaterial);

    overlays.setPlacementPreview(true, 'archer', 2, 2, false, towerRenderer.geometryCache);
    expect(placementInnerRing.visible).toBe(false);
    expect((ghostGroup.children[0] as THREE.Mesh).material).toBe(mats.ghostInvalidMaterial);

    overlays.setPlacementPreview(false, null, 0, 0, false, null);
    expect(ghostGroup.visible).toBe(false);
    expect(tileHighlight.visible).toBe(false);
    expect(placementOuterRing.visible).toBe(false);
    expect(placementInnerRing.visible).toBe(false);

    const selectedOuterRing = overlays.group.children[4] as THREE.Mesh;
    const selectedInnerRing = overlays.group.children[5] as THREE.Mesh;
    overlays.setSelectedTowerRing(mortar);
    expect(selectedOuterRing.visible).toBe(true);
    expect(selectedInnerRing.visible).toBe(true);
    overlays.setSelectedTowerRing(archer);
    expect(selectedOuterRing.visible).toBe(true);
    expect(selectedInnerRing.visible).toBe(false);
    overlays.setSelectedTowerRing(null);
    expect(selectedOuterRing.visible).toBe(false);
    expect(selectedInnerRing.visible).toBe(false);

    const meteorOuterRing = overlays.group.children[6] as THREE.Mesh;
    const meteorFillMesh = overlays.group.children[7] as THREE.Mesh;
    overlays.setMeteorTargetPreview(true, 0, 0, 3.4);
    expect(meteorOuterRing.visible).toBe(true);
    expect(meteorFillMesh.visible).toBe(true);
    overlays.setMeteorTargetPreview(false, 0, 0, 1);
    expect(meteorOuterRing.visible).toBe(false);
    expect(meteorFillMesh.visible).toBe(false);

    // Grow debugRingsMesh past initial 128 capacity
    const manyTowers = Array.from({ length: 140 }, (_, i) =>
      makeTower(i + 1, 'archer', 1, i, 0),
    );
    overlays.syncDebugAllRanges(true, manyTowers);
    overlays.clear();

    // TowerBadgeRenderer: exact tier pills + affordable upgrade arrows + extreme zoom clamping + >96 cap safety
    const camQuat = new THREE.Quaternion();
    const badgeTowers = [
      makeTower(1, 'archer', 1, 0, 0), // upgrade cost 55 -> affordable at 100g
      makeTower(2, 'cannon', 2, 2, 0), // upgrade cost 140 -> unaffordable at 100g
      makeTower(3, 'frost', 3, 4, 0), // max tier -> no arrow
    ];
    const badgeTierMeshes = [0, 1, 2].map((idx) => badges.group.children[idx] as THREE.InstancedMesh);
    const badgeArrowMesh = badges.group.children[3] as THREE.InstancedMesh;

    badges.sync(badgeTowers, 0, camQuat, 1.0, 0.01);
    expect(badgeTierMeshes.map((m) => m.count)).toEqual([1, 1, 1]);
    expect(badgeArrowMesh.count).toBe(0);

    badges.sync(badgeTowers, 100, camQuat, 1.0, 0.01);
    expect(badgeArrowMesh.count).toBe(1);

    badges.sync(badgeTowers, 200, camQuat, 2.0, 20.0);
    expect(badgeArrowMesh.count).toBe(2);

    const overCapTowers = [
      ...Array.from({ length: 98 }, (_, i) => makeTower(i + 1, 'archer', 1, i, 0)),
      makeTower(201, 'cannon', 2, 0, 2),
      makeTower(202, 'cannon', 2, 2, 2),
      makeTower(203, 'frost', 3, 4, 2),
      makeTower(204, 'frost', 3, 6, 2),
    ];
    expect(() => badges.sync(overCapTowers, 500, camQuat, 3.0, 1.0)).not.toThrow();
    expect(badgeTierMeshes.map((m) => m.count)).toEqual([96, 2, 2]);
    expect(badgeArrowMesh.count).toBe(96);
    badges.clear();
    expect(badgeTierMeshes.every((m) => m.count === 0 && !m.visible)).toBe(true);
    expect(badgeArrowMesh.count).toBe(0);

    // GroundDetails: empty-grass level yields zero meshes and safely no-ops syncOccupiedTiles
    const voidLevel = {
      ...LEVELS[0],
      cols: 3,
      rows: 2,
      layout: ['~ ~ ~', 'S P G'],
    };
    groundDetails.build(voidLevel, mats);
    expect(groundDetails.group.children).toHaveLength(0);
    expect(() => groundDetails.syncOccupiedTiles([makeTower(1, 'archer', 1, 0, 0)])).not.toThrow();

    // GroundDetails hides under occupied grass tiles and restores exact matrices when sold
    const level0 = LEVELS[0];
    groundDetails.build(level0, mats);
    const snapshotMatrices = (): number[][] => {
      const out: number[][] = [];
      const m = new THREE.Matrix4();
      for (const child of groundDetails.group.children) {
        const inst = child as THREE.InstancedMesh;
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, m);
          out.push([...m.elements]);
        }
      }
      return out;
    };
    const initialMats = snapshotMatrices();
    expect(initialMats.length).toBeGreaterThan(0);

    const coverAllGrass: TowerEntity[] = [];
    for (let r = 0; r < level0.rows; r++) {
      const rowCells = level0.layout[r].trim().split(/\s+/);
      for (let c = 0; c < level0.cols; c++) {
        if (rowCells[c] === '.') {
          coverAllGrass.push(makeTower(coverAllGrass.length + 1, 'archer', 1, 0, 0, c, r));
        }
      }
    }
    groundDetails.syncOccupiedTiles(coverAllGrass);
    const hiddenMats = snapshotMatrices();
    const zeroScaledCount = hiddenMats.filter(
      (el) => el[0] === 0 && el[5] === 0 && el[10] === 0,
    ).length;
    expect(zeroScaledCount).toBeGreaterThan(0);

    // Repeating same tower set or replacing a tower at identical coordinates hits fast-path without altering matrices
    groundDetails.syncOccupiedTiles(coverAllGrass);
    expect(snapshotMatrices()).toEqual(hiddenMats);
    const replacedIds = coverAllGrass.map((t, i) => ({ ...t, id: t.id + (i === 0 ? 1000 : 0) }));
    groundDetails.syncOccupiedTiles(replacedIds);
    expect(snapshotMatrices()).toEqual(hiddenMats);

    groundDetails.syncOccupiedTiles([]);
    expect(snapshotMatrices()).toEqual(initialMats);

    // AmbientDiorama build & animate
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitCone = new THREE.ConeGeometry(1, 1, 5);
    const unitIco = new THREE.IcosahedronGeometry(1, 0);
    diorama.build(16, new SeededRng(42), mats, unitBox, unitCone, unitIco);
    diorama.update(1.5);

    unitBox.dispose();
    unitCone.dispose();
    unitIco.dispose();
    diorama.dispose();
    groundDetails.dispose();
    badges.dispose();
    overlays.dispose();
    towerRenderer.dispose();
    mats.dispose();
  });

  it('MapBuilder and DecorBuilder build, animate, toggle quality, and dispose cleanly across all islands', { timeout: 15_000 }, () => {
    const assets = createFakeAssetStore();
    const mats = new MaterialLibrary();
    const mapBuilder = new MapBuilder();
    const decorBuilder = new DecorBuilder();

    for (const lvl of LEVELS) {
      mapBuilder.build(lvl, mats, assets);
      expect(mapBuilder.group.children.length).toBeGreaterThan(0);
      mapBuilder.update(0.75);
      expect(mats.waterUniforms.uWaterTime.value).toBeCloseTo(0.75, 6);
      mapBuilder.syncOccupiedTiles([makeTower(1, 'archer', 1, 0, 0, 4, 2)]);

      decorBuilder.build(lvl, mats, assets);
      const highCounts = decorBuilder.group.children.map((c) => (c as THREE.InstancedMesh).count);
      decorBuilder.setQuality('low');
      const lowCounts = decorBuilder.group.children.map((c) => (c as THREE.InstancedMesh).count);
      for (let i = 0; i < highCounts.length; i++) {
        expect(lowCounts[i]).toBeLessThanOrEqual(highCounts[i]);
      }
      // Sway update in low quality must not alter instance matrices
      const firstLayer = decorBuilder.group.children[0] as THREE.InstancedMesh | undefined;
      const beforeMat = new THREE.Matrix4();
      const afterMat = new THREE.Matrix4();
      if (firstLayer && firstLayer.count > 0) {
        firstLayer.getMatrixAt(0, beforeMat);
        decorBuilder.update(0.5);
        firstLayer.getMatrixAt(0, afterMat);
        expect(afterMat.equals(beforeMat)).toBe(true);
      }
      decorBuilder.setQuality('high');
      decorBuilder.update(1.0);
    }

    // Custom level with crossing (4-way) and split (3-way) path intersections builds cleanly
    const junctionLevel = {
      ...LEVELS[0],
      cols: 5,
      rows: 5,
      layout: [
        '~ ~ S ~ ~',
        '~ . P . ~',
        '. P P P G',
        '~ . P . ~',
        '~ ~ ~ ~ ~',
      ],
      pathWaypoints: [
        { col: 2, row: 0 },
        { col: 2, row: 3 },
        { col: 2, row: 2 },
        { col: 0, row: 2 },
        { col: 4, row: 2 },
      ],
      flightPath: [
        { col: 2, row: 0 },
        { col: 4, row: 2 },
      ],
    };
    expect(() => mapBuilder.build(junctionLevel, mats, assets)).not.toThrow();

    // MapBuilder.update rotates & bobs goalCrystalMesh, and handles levels without a goal tile safely
    mapBuilder.build(LEVELS[0], mats, assets);
    const crystalMesh = mapBuilder.group.children.find(
      (c): c is THREE.Mesh =>
        c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh) && c.material === mats.goalCrystal,
    )!;
    expect(crystalMesh).toBeDefined();
    mapBuilder.update(0);
    const baseCrystalY = crystalMesh.position.y;
    mapBuilder.update(0.7);
    expect(crystalMesh.rotation.y).toBeCloseTo(0.7 * 1.1, 5);
    expect(crystalMesh.position.y).toBeCloseTo(baseCrystalY + Math.sin(0.7 * 2.2) * 0.14, 5);

    const noGoalLevel = {
      ...junctionLevel,
      layout: ['~ ~ S ~ ~', '~ . P . ~', '. P P P .', '~ . P . ~', '~ ~ ~ ~ ~'],
    };
    expect(() => {
      mapBuilder.build(noGoalLevel, mats, assets);
      mapBuilder.update(1.2);
    }).not.toThrow();

    // DecorBuilder handles a zero-decor level safely through build/update/dispose
    expect(() => {
      decorBuilder.build(noGoalLevel, mats, assets);
      decorBuilder.update(1.2);
      decorBuilder.dispose();
    }).not.toThrow();

    // Fresh/disposed MapBuilder and GroundDetails safely no-op on update/syncOccupiedTiles,
    // and MapBuilder covers N-S open-water bridges plus all 4 cardinal spawn/goal & corner orientations
    const freshMap = new MapBuilder();
    const freshGround = new GroundDetails();
    expect(() => {
      freshMap.update(0.5);
      freshGround.syncOccupiedTiles([]);
    }).not.toThrow();

    const orientationLevel = {
      ...LEVELS[0],
      cols: 5,
      rows: 5,
      layout: [
        'S P P . .',
        '~ ~ P ~ ~',
        '. . P P P',
        'P P P . P',
        'G . P P P',
      ],
      // Traverses N-S vertical open-water bridge at (2,1), S(DIR_E), G(DIR_N),
      // and all 4 corner rounds: S|W (2,0), N|E (2,2), W|N (4,4), E|S (0,3)
      pathWaypoints: [
        { col: 0, row: 0 },
        { col: 2, row: 0 },
        { col: 2, row: 2 },
        { col: 4, row: 2 },
        { col: 4, row: 4 },
        { col: 2, row: 4 },
        { col: 2, row: 3 },
        { col: 0, row: 3 },
        { col: 0, row: 4 },
      ],
      flightPath: [
        { col: 0, row: 0 },
        { col: 0, row: 4 },
      ],
    };
    expect(() => {
      freshMap.build(orientationLevel, mats, assets);
      freshMap.update(0.75);
      freshMap.dispose();
      freshMap.update(1.0);
    }).not.toThrow();

    // Also test North/South-opening and Westward-opening spawn/goal orientations
    const northSouthLevel = {
      ...LEVELS[0],
      cols: 3,
      rows: 5,
      layout: [
        '. S .',
        '. P .',
        '~ P ~',
        '. P .',
        '. G .',
      ],
      pathWaypoints: [
        { col: 1, row: 0 },
        { col: 1, row: 4 },
      ],
      flightPath: [
        { col: 1, row: 0 },
        { col: 1, row: 4 },
      ],
    };
    const westwardLevel = {
      ...LEVELS[0],
      cols: 3,
      rows: 3,
      layout: ['. . .', 'G P S', '. . .'],
      pathWaypoints: [
        { col: 2, row: 1 },
        { col: 0, row: 1 },
      ],
      flightPath: [
        { col: 2, row: 1 },
        { col: 0, row: 1 },
      ],
    };
    expect(() => {
      freshMap.build(northSouthLevel, mats, assets);
      freshMap.dispose();
      freshMap.build(westwardLevel, mats, assets);
      freshMap.dispose();
    }).not.toThrow();

    mapBuilder.dispose();
    decorBuilder.dispose();
    expect(mapBuilder.group.children).toHaveLength(0);
    expect(decorBuilder.group.children).toHaveLength(0);
    mats.dispose();
  });
});
