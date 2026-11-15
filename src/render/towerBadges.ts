import * as THREE from 'three';
import { getTowerTierStats } from '../data/towers.ts';
import type { TowerEntity } from '../sim/entities.ts';
import { getTowerPickHeight } from './towerPicking.ts';

const MAX_TOWERS = 96;
const ATLAS_WIDTH = 128;
const ATLAS_HEIGHT = 256; // 4 cells x 64px height: [I, II, III, UpArrow]

function createSlicedPlane(rowIndex: number, totalRows: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(1, 1);
  const uv = geo.attributes.uv;
  // In CanvasTexture (flipY = true by default): v=1 is top of canvas, v=0 is bottom.
  const vTop = 1 - rowIndex / totalRows;
  const vBottom = 1 - (rowIndex + 1) / totalRows;
  for (let i = 0; i < uv.count; i++) {
    const v = uv.getY(i);
    uv.setY(i, v > 0.5 ? vTop : vBottom);
  }
  uv.needsUpdate = true;
  return geo;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createBadgeAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH;
  canvas.height = ATLAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);

    // Rows 0, 1, 2: Tier pills I, II, III
    const labels: readonly string[] = ['I', 'II', 'III'];
    for (let row = 0; row < 3; row++) {
      const cellY = row * 64;
      const isMax = row === 2;
      drawRoundedRect(ctx, 8, cellY + 8, ATLAS_WIDTH - 16, 48, 18);
      ctx.fillStyle = isMax ? '#3a305b' : '#262442';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = isMax ? '#ffdf6b' : '#f8f4e8';
      ctx.stroke();

      ctx.fillStyle = isMax ? '#ffe275' : '#ffffff';
      ctx.font = '900 32px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[row], ATLAS_WIDTH * 0.5, cellY + 33);
    }

    // Row 3: Gold upward arrow icon with dark outline
    const arrowY = 3 * 64;
    const cx = ATLAS_WIDTH * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, arrowY + 4);
    ctx.lineTo(cx + 42, arrowY + 36);
    ctx.lineTo(cx + 18, arrowY + 36);
    ctx.lineTo(cx + 18, arrowY + 59);
    ctx.lineTo(cx - 18, arrowY + 59);
    ctx.lineTo(cx - 18, arrowY + 36);
    ctx.lineTo(cx - 42, arrowY + 36);
    ctx.closePath();

    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#1f1c36';
    ctx.stroke();

    const grad = ctx.createLinearGradient(0, arrowY + 4, 0, arrowY + 59);
    grad.addColorStop(0, '#fff08a');
    grad.addColorStop(0.55, '#f6bd41');
    grad.addColorStop(1, '#d88414');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const _dummy = new THREE.Object3D();

/**
 * Billboarded instanced indicators floating above placed towers:
 * - Tier badges (I / II / III) above every tower
 * - Bouncing gold up-arrow above towers whose next upgrade is currently affordable
 */
export class TowerBadgeRenderer {
  readonly group = new THREE.Group();
  private readonly atlas: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly tierMeshes: readonly [THREE.InstancedMesh, THREE.InstancedMesh, THREE.InstancedMesh];
  private readonly arrowMesh: THREE.InstancedMesh;
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor() {
    this.atlas = createBadgeAtlas();
    this.material = new THREE.MeshBasicMaterial({
      map: this.atlas,
      alphaTest: 0.45,
      transparent: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const createMesh = (rowIndex: number): THREE.InstancedMesh => {
      const geo = createSlicedPlane(rowIndex, 4);
      this.geometries.push(geo);
      const mesh = new THREE.InstancedMesh(geo, this.material, MAX_TOWERS);
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);
      return mesh;
    };

    this.tierMeshes = [createMesh(0), createMesh(1), createMesh(2)];
    this.arrowMesh = createMesh(3);
  }

  sync(
    towers: readonly TowerEntity[],
    gold: number,
    cameraQuaternion: THREE.Quaternion,
    elapsedTime: number,
  ): void {
    const tierCounts = [0, 0, 0];
    let arrowCount = 0;

    for (let i = 0; i < towers.length; i++) {
      const tower = towers[i];
      const topY = getTowerPickHeight(tower.type, tower.tier);
      const tierIdx = tower.tier - 1;
      const tierSlot = tierCounts[tierIdx];

      if (tierSlot < MAX_TOWERS) {
        _dummy.position.set(tower.x, topY + 0.30, tower.z);
        _dummy.quaternion.copy(cameraQuaternion);
        _dummy.scale.set(0.92, 0.46, 1);
        _dummy.updateMatrix();
        this.tierMeshes[tierIdx].setMatrixAt(tierSlot, _dummy.matrix);
        tierCounts[tierIdx] = tierSlot + 1;
      }

      if (tower.tier < 3 && arrowCount < MAX_TOWERS) {
        const nextTier = (tower.tier + 1) as 2 | 3;
        const upgradeCost = getTowerTierStats(tower.type, nextTier).upgradeCost;
        if (gold >= upgradeCost) {
          const bounce = Math.abs(Math.sin(elapsedTime * 4.2 + tower.id * 0.7)) * 0.18;
          _dummy.position.set(tower.x, topY + 0.80 + bounce, tower.z);
          _dummy.quaternion.copy(cameraQuaternion);
          _dummy.scale.set(0.68, 0.68, 1);
          _dummy.updateMatrix();
          this.arrowMesh.setMatrixAt(arrowCount, _dummy.matrix);
          arrowCount++;
        }
      }
    }

    for (let t = 0; t < 3; t++) {
      this.tierMeshes[t].count = tierCounts[t];
      this.tierMeshes[t].visible = tierCounts[t] > 0;
      if (tierCounts[t] > 0) {
        this.tierMeshes[t].instanceMatrix.needsUpdate = true;
      }
    }

    this.arrowMesh.count = arrowCount;
    this.arrowMesh.visible = arrowCount > 0;
    if (arrowCount > 0) {
      this.arrowMesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear(): void {
    for (let t = 0; t < 3; t++) {
      this.tierMeshes[t].count = 0;
      this.tierMeshes[t].visible = false;
    }
    this.arrowMesh.count = 0;
    this.arrowMesh.visible = false;
  }

  dispose(): void {
    for (const geo of this.geometries) {
      geo.dispose();
    }
    this.material.dispose();
    this.atlas.dispose();
  }
}
