import * as THREE from 'three';
import type { TowerType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { parseLevelGrid, type LevelDef } from '../data/levels/index.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { getTowerTierStats } from '../data/towers.ts';
import type { TowerEntity } from '../sim/entities.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import { applyAlphaPreserveBlend, type MaterialLibrary } from './materials.ts';
import type { TowerGeometryCache } from './towerGeometries.ts';

const _ringDummy = new THREE.Object3D();

function buildFlatRibbonGeometry(
  points: ReadonlyArray<{ x: number; z: number }>,
  y: number,
  halfWidth: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertBase = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) continue;

    const nx = (-dz / len) * halfWidth;
    const nz = (dx / len) * halfWidth;

    positions.push(
      a.x + nx, y, a.z + nz,
      a.x - nx, y, a.z - nz,
      b.x + nx, y, b.z + nz,
      b.x - nx, y, b.z - nz,
    );
    indices.push(vertBase, vertBase + 1, vertBase + 3);
    indices.push(vertBase, vertBase + 3, vertBase + 2);
    vertBase += 4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

export class OverlayIndicators {
  readonly group = new THREE.Group();

  private readonly ghostGroup = new THREE.Group();
  private readonly ghostBaseMesh: THREE.Mesh;
  private readonly ghostTurretMesh: THREE.Mesh;
  private readonly tileHighlightMesh: THREE.Mesh;
  private readonly placementOuterRing: THREE.Mesh;
  private readonly placementInnerRing: THREE.Mesh;

  private readonly selectedOuterRing: THREE.Mesh;
  private readonly selectedInnerRing: THREE.Mesh;
  private readonly ringGeo: THREE.BufferGeometry;
  private readonly rangeMat: THREE.MeshBasicMaterial;
  private debugRingsMesh: THREE.InstancedMesh;
  private debugRingsCapacity = 128;

  private readonly flightPathGroup = new THREE.Group();
  private flightPathGeometries: THREE.BufferGeometry[] = [];
  private flightPathMaterials: THREE.Material[] = [];
  private flightPathGroundMat: THREE.MeshBasicMaterial | null = null;
  private flightPathSkyMat: THREE.MeshBasicMaterial | null = null;
  private flightPathArrowMat: THREE.MeshBasicMaterial | null = null;

  private readonly gridLineMat: THREE.LineBasicMaterial;
  private gridLinesMesh: THREE.LineSegments | null = null;
  private gridGeometry: THREE.BufferGeometry | null = null;
  private placementGridActive = false;
  private placementGridAlpha = 0;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly materials: MaterialLibrary;

  constructor(materials: MaterialLibrary) {
    this.materials = materials;

    this.gridLineMat = new THREE.LineBasicMaterial({
      color: 0xf6fae8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    applyAlphaPreserveBlend(this.gridLineMat);
    this.ownMaterials.push(this.gridLineMat);

    const tileGeo = new THREE.PlaneGeometry(BALANCE.tileSize * 0.94, BALANCE.tileSize * 0.94);
    tileGeo.rotateX(-Math.PI / 2);
    this.geometries.push(tileGeo);

    const tileMat = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.grass,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    applyAlphaPreserveBlend(tileMat);
    this.ownMaterials.push(tileMat);

    this.tileHighlightMesh = new THREE.Mesh(tileGeo, tileMat);
    this.tileHighlightMesh.position.y = 0.025;
    this.tileHighlightMesh.visible = false;
    this.group.add(this.tileHighlightMesh);

    const emptyGeo = new THREE.BufferGeometry();
    this.geometries.push(emptyGeo);
    this.ghostBaseMesh = new THREE.Mesh(emptyGeo, materials.ghostValidMaterial);
    this.ghostTurretMesh = new THREE.Mesh(emptyGeo, materials.ghostValidMaterial);
    this.ghostGroup.add(this.ghostBaseMesh, this.ghostTurretMesh);
    this.ghostGroup.visible = false;
    this.group.add(this.ghostGroup);

    this.ringGeo = new THREE.RingGeometry(0.965, 1.0, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.geometries.push(this.ringGeo);

    this.rangeMat = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.cream,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const deadzoneMat = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.coral,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    applyAlphaPreserveBlend(this.rangeMat);
    applyAlphaPreserveBlend(deadzoneMat);
    this.ownMaterials.push(this.rangeMat, deadzoneMat);

    this.placementOuterRing = new THREE.Mesh(this.ringGeo, this.rangeMat);
    this.placementOuterRing.position.y = 0.04;
    this.placementOuterRing.visible = false;
    this.group.add(this.placementOuterRing);

    this.placementInnerRing = new THREE.Mesh(this.ringGeo, deadzoneMat);
    this.placementInnerRing.position.y = 0.04;
    this.placementInnerRing.visible = false;
    this.group.add(this.placementInnerRing);

    this.selectedOuterRing = new THREE.Mesh(this.ringGeo, this.rangeMat);
    this.selectedOuterRing.position.y = 0.045;
    this.selectedOuterRing.visible = false;
    this.group.add(this.selectedOuterRing);

    this.selectedInnerRing = new THREE.Mesh(this.ringGeo, deadzoneMat);
    this.selectedInnerRing.position.y = 0.045;
    this.selectedInnerRing.visible = false;
    this.group.add(this.selectedInnerRing);

    this.debugRingsMesh = new THREE.InstancedMesh(this.ringGeo, this.rangeMat, this.debugRingsCapacity);
    this.debugRingsMesh.count = 0;
    this.debugRingsMesh.visible = false;
    this.debugRingsMesh.frustumCulled = false;
    this.group.add(this.debugRingsMesh);

    this.flightPathGroup.visible = false;
    this.group.add(this.flightPathGroup);
  }

  setFlightPath(level: LevelDef): void {
    this.clearFlightPath();
    if (level.flightPath.length < 2) return;

    const worldPts = level.flightPath.map((wp) => ({
      x: gridToWorldX(wp.col, level.cols),
      z: gridToWorldZ(wp.row, level.rows),
    }));

    const skyY = BALANCE.flyerHeight - 0.14;
    const groundY = 0.036;

    const groundRibbonGeo = buildFlatRibbonGeometry(worldPts, groundY, 0.17);
    const skyRibbonGeo = buildFlatRibbonGeometry(worldPts, skyY, 0.13);
    const arrowGeo = new THREE.ConeGeometry(0.21, 0.44, 4);
    arrowGeo.rotateX(Math.PI * 0.5);
    arrowGeo.scale(1.0, 0.24, 1.0);
    this.flightPathGeometries.push(groundRibbonGeo, skyRibbonGeo, arrowGeo);

    const groundMat = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.coral,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const skyMat = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.coral,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const arrowMat = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.coral,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    applyAlphaPreserveBlend(groundMat);
    applyAlphaPreserveBlend(skyMat);
    applyAlphaPreserveBlend(arrowMat);
    this.flightPathMaterials.push(groundMat, skyMat, arrowMat);
    this.flightPathGroundMat = groundMat;
    this.flightPathSkyMat = skyMat;
    this.flightPathArrowMat = arrowMat;

    const groundRibbon = new THREE.Mesh(groundRibbonGeo, groundMat);
    groundRibbon.castShadow = false;
    groundRibbon.receiveShadow = false;

    const skyRibbon = new THREE.Mesh(skyRibbonGeo, skyMat);
    skyRibbon.castShadow = false;
    skyRibbon.receiveShadow = false;

    const markerTransforms: Array<{ x: number; z: number; yaw: number }> = [];
    const spacing = 1.45;
    for (let i = 0; i < worldPts.length - 1; i++) {
      const a = worldPts[i];
      const b = worldPts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const yaw = Math.atan2(dx, dz);
      const steps = Math.max(1, Math.floor(len / spacing));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        markerTransforms.push({
          x: a.x + dx * t,
          z: a.z + dz * t,
          yaw,
        });
      }
    }

    const arrowsMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, Math.max(1, markerTransforms.length));
    for (let i = 0; i < markerTransforms.length; i++) {
      const m = markerTransforms[i];
      _ringDummy.position.set(m.x, skyY + 0.03, m.z);
      _ringDummy.rotation.set(0, m.yaw, 0);
      _ringDummy.scale.setScalar(1);
      _ringDummy.updateMatrix();
      arrowsMesh.setMatrixAt(i, _ringDummy.matrix);
    }
    arrowsMesh.count = markerTransforms.length;
    arrowsMesh.castShadow = false;
    arrowsMesh.receiveShadow = false;
    arrowsMesh.frustumCulled = false;

    this.flightPathGroup.add(groundRibbon, skyRibbon, arrowsMesh);
  }

  setBuildableGrid(level: LevelDef): void {
    this.clearBuildableGrid();
    const grid = parseLevelGrid(level);
    const ts = BALANCE.tileSize;
    const half = ts * 0.5;
    const y = 0.016;
    const seenEdges = new Set<string>();
    const positions: number[] = [];

    const addSeg = (ax: number, az: number, bx: number, bz: number): void => {
      const k1 = `${Math.round(ax * 100)},${Math.round(az * 100)}`;
      const k2 = `${Math.round(bx * 100)},${Math.round(bz * 100)}`;
      const edgeKey = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      if (seenEdges.has(edgeKey)) return;
      seenEdges.add(edgeKey);
      positions.push(ax, y, az, bx, y, bz);
    };

    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        if (grid[r][c] !== 'grass') continue;
        const wx = gridToWorldX(c, level.cols);
        const wz = gridToWorldZ(r, level.rows);
        addSeg(wx - half, wz - half, wx + half, wz - half);
        addSeg(wx + half, wz - half, wx + half, wz + half);
        addSeg(wx + half, wz + half, wx - half, wz + half);
        addSeg(wx - half, wz + half, wx - half, wz - half);
      }
    }

    if (positions.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.gridGeometry = geo;
    const lines = new THREE.LineSegments(geo, this.gridLineMat);
    lines.visible = false;
    lines.renderOrder = 3;
    lines.frustumCulled = false;
    this.gridLinesMesh = lines;
    this.group.add(lines);
  }

  setPlacementGridActive(active: boolean): void {
    this.placementGridActive = active;
  }

  private clearBuildableGrid(): void {
    if (this.gridLinesMesh) {
      this.group.remove(this.gridLinesMesh);
      this.gridLinesMesh = null;
    }
    if (this.gridGeometry) {
      this.gridGeometry.dispose();
      this.gridGeometry = null;
    }
  }

  setFlightPathHighlight(visible: boolean): void {
    this.flightPathGroup.visible = visible;
  }

  update(elapsedTime: number, frameDt = 0): void {
    const targetAlpha = this.placementGridActive ? 1 : 0;
    if (Math.abs(this.placementGridAlpha - targetAlpha) > 0.001) {
      const step = frameDt > 0 ? Math.min(1, frameDt * 7.0) : 1;
      this.placementGridAlpha += (targetAlpha - this.placementGridAlpha) * step;
      if (Math.abs(this.placementGridAlpha - targetAlpha) < 0.005) {
        this.placementGridAlpha = targetAlpha;
      }
      this.gridLineMat.opacity = this.placementGridAlpha * 0.3;
    }
    if (this.gridLinesMesh) {
      this.gridLinesMesh.visible = this.placementGridAlpha > 0.005;
    }

    if (!this.flightPathGroup.visible) return;
    const pulse = 0.5 + 0.5 * Math.sin(elapsedTime * 3.8);
    if (this.flightPathGroundMat) {
      this.flightPathGroundMat.opacity = 0.14 + pulse * 0.08;
    }
    if (this.flightPathSkyMat) {
      this.flightPathSkyMat.opacity = 0.24 + pulse * 0.12;
    }
    if (this.flightPathArrowMat) {
      this.flightPathArrowMat.opacity = 0.48 + pulse * 0.2;
    }
  }

  setPlacementPreview(
    visible: boolean,
    towerType: TowerType | null,
    wx: number,
    wz: number,
    valid: boolean,
    geometryCache: TowerGeometryCache | null,
  ): void {
    if (!visible || !towerType || !geometryCache) {
      this.ghostGroup.visible = false;
      this.tileHighlightMesh.visible = false;
      this.placementOuterRing.visible = false;
      this.placementInnerRing.visible = false;
      return;
    }

    const pair = geometryCache.get(towerType, 1);
    this.ghostBaseMesh.geometry = pair.base;
    this.ghostTurretMesh.geometry = pair.turret;
    this.ghostTurretMesh.position.y = pair.turretAnchorY;
    const mat = valid ? this.materials.ghostValidMaterial : this.materials.ghostInvalidMaterial;
    this.ghostBaseMesh.material = mat;
    this.ghostTurretMesh.material = mat;

    this.ghostGroup.position.set(wx, 0, wz);
    this.ghostGroup.visible = true;

    const tileMat = this.tileHighlightMesh.material as THREE.MeshBasicMaterial;
    tileMat.color.setHex(valid ? PALETTE_HEX.grass : PALETTE_HEX.coral);
    this.tileHighlightMesh.position.set(wx, 0.025, wz);
    this.tileHighlightMesh.visible = true;

    const stats = getTowerTierStats(towerType, 1);
    this.placementOuterRing.position.set(wx, 0.04, wz);
    this.placementOuterRing.scale.setScalar(stats.range);
    this.placementOuterRing.visible = true;

    if (stats.minRange > 0) {
      this.placementInnerRing.position.set(wx, 0.04, wz);
      this.placementInnerRing.scale.setScalar(stats.minRange);
      this.placementInnerRing.visible = true;
    } else {
      this.placementInnerRing.visible = false;
    }
  }

  setSelectedTowerRing(tower: TowerEntity | null): void {
    if (!tower) {
      this.selectedOuterRing.visible = false;
      this.selectedInnerRing.visible = false;
      return;
    }
    const stats = getTowerTierStats(tower.type, tower.tier);
    this.selectedOuterRing.position.set(tower.x, 0.045, tower.z);
    this.selectedOuterRing.scale.setScalar(stats.range);
    this.selectedOuterRing.visible = true;

    if (stats.minRange > 0) {
      this.selectedInnerRing.position.set(tower.x, 0.045, tower.z);
      this.selectedInnerRing.scale.setScalar(stats.minRange);
      this.selectedInnerRing.visible = true;
    } else {
      this.selectedInnerRing.visible = false;
    }
  }

  syncDebugAllRanges(show: boolean, towers: readonly TowerEntity[]): void {
    if (!show || towers.length === 0) {
      this.debugRingsMesh.count = 0;
      this.debugRingsMesh.visible = false;
      return;
    }

    if (towers.length > this.debugRingsCapacity) {
      this.group.remove(this.debugRingsMesh);
      this.debugRingsMesh.dispose();
      this.debugRingsCapacity = towers.length + 32;
      this.debugRingsMesh = new THREE.InstancedMesh(this.ringGeo, this.rangeMat, this.debugRingsCapacity);
      this.debugRingsMesh.frustumCulled = false;
      this.group.add(this.debugRingsMesh);
    }

    for (let i = 0; i < towers.length; i++) {
      const stats = getTowerTierStats(towers[i].type, towers[i].tier);
      _ringDummy.position.set(towers[i].x, 0.038, towers[i].z);
      _ringDummy.rotation.set(0, 0, 0);
      _ringDummy.scale.setScalar(stats.range);
      _ringDummy.updateMatrix();
      this.debugRingsMesh.setMatrixAt(i, _ringDummy.matrix);
    }
    this.debugRingsMesh.count = towers.length;
    this.debugRingsMesh.visible = true;
    this.debugRingsMesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.setPlacementPreview(false, null, 0, 0, false, null);
    this.setPlacementGridActive(false);
    this.placementGridAlpha = 0;
    this.gridLineMat.opacity = 0;
    if (this.gridLinesMesh) {
      this.gridLinesMesh.visible = false;
    }
    this.setSelectedTowerRing(null);
    this.syncDebugAllRanges(false, []);
    this.setFlightPathHighlight(false);
  }

  private clearFlightPath(): void {
    this.flightPathGroup.visible = false;
    this.flightPathGroup.clear();
    for (let i = 0; i < this.flightPathGeometries.length; i++) {
      this.flightPathGeometries[i].dispose();
    }
    this.flightPathGeometries.length = 0;
    for (let i = 0; i < this.flightPathMaterials.length; i++) {
      this.flightPathMaterials[i].dispose();
    }
    this.flightPathMaterials.length = 0;
    this.flightPathGroundMat = null;
    this.flightPathSkyMat = null;
    this.flightPathArrowMat = null;
  }

  dispose(): void {
    this.clearBuildableGrid();
    this.clearFlightPath();
    this.debugRingsMesh.dispose();
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
