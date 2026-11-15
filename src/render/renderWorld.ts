import type * as THREE from 'three';
import type { EventBus } from '../core/eventBus.ts';
import type { GameSettings, QualityLevel, TowerType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import type { SimWorld } from '../sim/world.ts';
import { CameraController } from './cameraController.ts';
import { DecorBuilder } from './decorBuilder.ts';
import { EffectsRenderer } from './effectsRenderer.ts';
import { EnemyRenderer } from './enemyMeshes.ts';
import { MapBuilder } from './mapBuilder.ts';
import { MaterialLibrary } from './materials.ts';
import { OverlayIndicators } from './overlayIndicators.ts';
import { ProjectileRenderer } from './projectileRenderer.ts';
import { SceneManager } from './sceneManager.ts';
import { TowerRenderer } from './towerMeshes.ts';

export interface RenderMetrics {
  drawCalls: number;
  drawsWithShadows: number;
  drawsNoShadows: number;
  triangles: number;
}

export class RenderWorld {
  readonly sceneManager: SceneManager;
  readonly cameraController: CameraController;
  readonly materials: MaterialLibrary;
  readonly mapBuilder: MapBuilder;
  readonly decorBuilder: DecorBuilder;
  readonly towerRenderer: TowerRenderer;
  readonly enemyRenderer: EnemyRenderer;
  readonly projectileRenderer: ProjectileRenderer;
  readonly effectsRenderer: EffectsRenderer;
  readonly overlayIndicators: OverlayIndicators;

  private eventUnsubs: Array<() => void> = [];
  private showAllRanges = false;

  constructor(canvas: HTMLCanvasElement) {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.sceneManager = new SceneManager(canvas);
    this.cameraController = new CameraController(width, height);
    this.materials = new MaterialLibrary();
    this.mapBuilder = new MapBuilder();
    this.decorBuilder = new DecorBuilder();
    this.towerRenderer = new TowerRenderer();
    this.enemyRenderer = new EnemyRenderer(this.materials);
    this.projectileRenderer = new ProjectileRenderer(this.materials);
    this.effectsRenderer = new EffectsRenderer();
    this.overlayIndicators = new OverlayIndicators(this.materials);

    const scene = this.sceneManager.scene;
    scene.add(this.mapBuilder.group);
    scene.add(this.decorBuilder.group);
    scene.add(this.towerRenderer.group);
    scene.add(this.enemyRenderer.group);
    scene.add(this.projectileRenderer.group);
    scene.add(this.effectsRenderer.group);
    scene.add(this.overlayIndicators.group);
  }

  loadLevel(level: LevelDef, events?: EventBus, getSettings?: () => GameSettings): void {
    this.clearEventSubs();
    this.towerRenderer.clearInstances();
    this.enemyRenderer.clear();
    this.projectileRenderer.clear();
    this.effectsRenderer.clearEffects();
    this.overlayIndicators.clear();

    this.mapBuilder.build(level, this.materials);
    this.decorBuilder.build(level, this.materials);
    this.overlayIndicators.setFlightPath(level);
    this.sceneManager.fitShadowToMap(level.cols, level.rows);
    this.cameraController.configureForMap(level.cols, level.rows);

    if (events) {
      this.bindEvents(events, getSettings);
    }
  }

  private bindEvents(events: EventBus, getSettings?: () => GameSettings): void {
    const shakeEnabled = (): boolean => (getSettings ? getSettings().cameraShake : true);

    this.eventUnsubs.push(
      events.on('towerBuilt', (e) => {
        this.effectsRenderer.spawnParticles(e.x, 0.2, e.z, PALETTE_HEX.cream, 10, 2.8, 4.0);
        this.effectsRenderer.spawnParticles(e.x, 0.15, e.z, PALETTE_HEX.sand, 6, 2.2, 4.0);
      }),
      events.on('towerUpgraded', (e) => {
        this.effectsRenderer.spawnParticles(e.x, 0.5, e.z, PALETTE_HEX.gold, 14, 3.2, 3.0);
      }),
      events.on('towerSold', (e) => {
        this.effectsRenderer.spawnParticles(e.x, 0.4, e.z, PALETTE_HEX.gold, 10, 2.6, 4.5);
      }),
      events.on('towerFired', (e) => {
        const color =
          e.type === 'frost'
            ? PALETTE_HEX.water
            : e.type === 'tesla'
              ? PALETTE_HEX.cream
              : e.type === 'archer'
                ? PALETTE_HEX.gold
                : PALETTE_HEX.coral;
        const muzzleX = e.x + Math.sin(e.yaw) * 0.45;
        const muzzleZ = e.z + Math.cos(e.yaw) * 0.45;
        this.effectsRenderer.spawnParticles(muzzleX, e.y, muzzleZ, color, 4, 1.8, 1.5);
      }),
      events.on('projectileImpact', (e) => {
        if (e.towerType === 'cannon' || e.towerType === 'mortar') {
          this.effectsRenderer.spawnPulseRing(
            e.x,
            0.06,
            e.z,
            e.radius,
            e.towerType === 'mortar' ? PALETTE_HEX.coral : PALETTE_HEX.gold,
          );
          this.effectsRenderer.spawnParticles(
            e.x,
            e.y,
            e.z,
            PALETTE_HEX.coral,
            e.towerType === 'mortar' ? 14 : 9,
            e.towerType === 'mortar' ? 4.4 : 3.2,
            7.0,
          );
          if (e.towerType === 'mortar') {
            this.cameraController.addShake(BALANCE.camera.mortarImpactShake, shakeEnabled());
          }
        } else if (e.towerType === 'frost') {
          this.effectsRenderer.spawnPulseRing(e.x, 0.06, e.z, e.radius, PALETTE_HEX.water);
          this.effectsRenderer.spawnParticles(e.x, e.y, e.z, PALETTE_HEX.cream, 7, 2.2, 2.5);
        } else {
          this.effectsRenderer.spawnParticles(e.x, e.y, e.z, PALETTE_HEX.gold, 3, 1.8, 3.0);
        }
        if (e.isBossHit) {
          this.cameraController.addShake(BALANCE.camera.bossHitShake, shakeEnabled());
        }
      }),
      events.on('lightningChain', (e) => {
        this.effectsRenderer.spawnLightningArc(e.points);
        for (let i = 1; i < e.points.length; i++) {
          const pt = e.points[i];
          this.effectsRenderer.spawnParticles(pt.x, pt.y, pt.z, PALETTE_HEX.water, 5, 2.6, 2.0);
        }
      }),
      events.on('enemyKilled', (e) => {
        this.effectsRenderer.spawnDeathShards(e.enemyType, e.x, e.y, e.z);
      }),
      events.on('healerPulse', (e) => {
        this.effectsRenderer.spawnPulseRing(e.x, e.y, e.z, e.radius, PALETTE_HEX.grass);
      }),
    );
  }

  setPlacementPreview(
    visible: boolean,
    towerType: TowerType | null,
    wx: number,
    wz: number,
    valid: boolean,
  ): void {
    this.overlayIndicators.setPlacementPreview(
      visible,
      towerType,
      wx,
      wz,
      valid,
      this.towerRenderer.geometryCache,
    );
  }

  setShowAllRanges(show: boolean): void {
    this.showAllRanges = show;
  }

  setFlightPathHighlight(visible: boolean): void {
    this.overlayIndicators.setFlightPathHighlight(visible);
  }

  setQuality(quality: QualityLevel): void {
    this.sceneManager.setQuality(quality);
    this.decorBuilder.setQuality(quality);
    this.enemyRenderer.setQuality(quality);
  }

  resize(width: number, height: number): void {
    this.sceneManager.resize(width, height);
    this.cameraController.resize(width, height);
  }

  render(
    simWorld: SimWorld | null,
    frameDt: number,
    alpha: number,
    elapsedVisualTime: number,
    fxDt?: number,
  ): void {
    this.cameraController.update(frameDt);
    this.mapBuilder.update(elapsedVisualTime);
    this.decorBuilder.update(elapsedVisualTime);
    this.overlayIndicators.update(elapsedVisualTime);
    const activeFxDt = fxDt ?? frameDt;
    this.effectsRenderer.update(activeFxDt);

    if (simWorld) {
      this.towerRenderer.syncTowers(simWorld.towers, this.materials, alpha, elapsedVisualTime);
      this.enemyRenderer.update(
        simWorld.enemyPool,
        alpha,
        elapsedVisualTime,
        this.cameraController.camera,
      );
      this.projectileRenderer.update(simWorld.projectilePool, alpha);

      if (activeFxDt > 0) {
        const pCount = simWorld.projectilePool.getActiveCount();
        const trailChance = Math.min(0.8, activeFxDt * 24);
        for (let i = 0; i < pCount; i++) {
          const proj = simWorld.projectilePool.items[simWorld.projectilePool.getActiveIndex(i)];
          if (Math.random() > trailChance) continue;
          const color =
            proj.towerType === 'frost'
              ? PALETTE_HEX.water
              : proj.towerType === 'mortar'
                ? PALETTE_HEX.coral
                : proj.towerType === 'cannon'
                  ? PALETTE_HEX.stone
                  : PALETTE_HEX.cream;
          const scale = proj.towerType === 'mortar' ? 0.62 : proj.towerType === 'cannon' ? 0.5 : 0.34;
          const ix = proj.prevX + (proj.x - proj.prevX) * alpha;
          const iy = proj.prevY + (proj.y - proj.prevY) * alpha;
          const iz = proj.prevZ + (proj.z - proj.prevZ) * alpha;
          this.effectsRenderer.spawnTrailParticle(ix, iy, iz, color, scale);
        }
      }

      this.overlayIndicators.syncDebugAllRanges(this.showAllRanges, simWorld.towers);
    }

    this.sceneManager.renderer.render(this.sceneManager.scene, this.cameraController.camera);
  }

  getRenderMetrics(): RenderMetrics {
    const info = this.sceneManager.renderer.info.render;
    let activeShadowDraws = 0;
    this.sceneManager.scene.traverseVisible((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.castShadow) return;
      const inst = obj as THREE.InstancedMesh;
      if (inst.isInstancedMesh && inst.count <= 0) return;
      activeShadowDraws++;
    });

    const shadowsOn = this.sceneManager.shadowsEnabled;
    const drawsWithShadows = shadowsOn ? info.calls : info.calls + activeShadowDraws;
    const drawsNoShadows = shadowsOn ? Math.max(0, info.calls - activeShadowDraws) : info.calls;
    return {
      drawCalls: info.calls,
      drawsWithShadows,
      drawsNoShadows,
      triangles: info.triangles,
    };
  }

  getMemoryStats(): { geometries: number; textures: number } {
    const mem = this.sceneManager.renderer.info.memory;
    return {
      geometries: mem.geometries,
      textures: mem.textures,
    };
  }

  private clearEventSubs(): void {
    for (let i = 0; i < this.eventUnsubs.length; i++) {
      this.eventUnsubs[i]();
    }
    this.eventUnsubs.length = 0;
  }

  dispose(): void {
    this.clearEventSubs();
    this.mapBuilder.dispose();
    this.decorBuilder.dispose();
    this.towerRenderer.dispose();
    this.enemyRenderer.dispose();
    this.projectileRenderer.dispose();
    this.effectsRenderer.dispose();
    this.overlayIndicators.dispose();
    this.materials.dispose();
    this.sceneManager.dispose();
  }
}
