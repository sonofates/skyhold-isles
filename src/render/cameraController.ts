import * as THREE from 'three';
import { BALANCE } from '../data/balance.ts';
import { parseTileChar } from '../data/levels/types.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import {
  computePlayableFit,
  pickFitProfile,
  projectExtents,
  type FitInsets,
} from './cameraFit.ts';
import { clampPlaneTarget, FLING_STOP_SPEED, stepFling, type PlaneExtents } from './panLimits.ts';
import {
  computeOcclusionFit,
  planeTargetToGround,
  projectPlanePoints,
  type PxRect,
} from './occlusionFit.ts';

/** Share (by weight) of playable tiles that must be visible and clear of the HUD at default zoom. */
const OCCLUSION_COVERAGE = 0.88;
/** Keep the occlusion search cheap: at most this many tile samples. */
const MAX_FIT_SAMPLES = 160;

/** Camera elevation above the horizon. Steeper than true isometric (35.26 deg) so tall towers cover
 *  fewer tiles behind them. `?pitch=NN` overrides it for A/B screenshots. */
export const CAMERA_PITCH_DEG = 50;
function resolvePitchRad(): number {
  let deg = CAMERA_PITCH_DEG;
  if (typeof location !== 'undefined') {
    const q = Number(new URLSearchParams(location.search).get('pitch'));
    if (q >= 30 && q <= 70) deg = q;
  }
  return (deg * Math.PI) / 180;
}
const ISO_TILT_RAD = resolvePitchRad();
const BASE_YAW_RAD = Math.PI / 4; // 45 deg
const CAMERA_DISTANCE = 54;

export class CameraController {
  readonly camera: THREE.OrthographicCamera;

  private viewportWidth = 1280;
  private viewportHeight = 720;

  private target = new THREE.Vector3(0, 0, 0);
  private desiredTarget = new THREE.Vector3(0, 0, 0);
  private minBoundX = -16;
  private maxBoundX = 16;
  private minBoundZ = -14;
  private maxBoundZ = 14;

  private zoom = 1;
  private desiredZoom = 1;

  private yawIndex = 0;
  private currentYaw = BASE_YAW_RAD;
  private rotStartYaw = BASE_YAW_RAD;
  private rotTargetYaw = BASE_YAW_RAD;
  private rotProgress = 1;
  private showcaseMode = false;

  private fitPoints: Float32Array | null = null;
  private fitPlayPoints: Float32Array | null = null;
  /** Playable tile centres (xyz triples) + weights for the HUD-occlusion fit. */
  private fitTileXyz: Float32Array | null = null;
  private fitTileWeight: Float32Array | null = null;
  private hudRects: PxRect[] = [];
  /** Auto-fit target in camera-plane coords: always reachable by panning (no snap-back). */
  private fitPlane = { r: 0, u: 0 };
  private planeExtYaw = NaN;
  private planeExt: PlaneExtents | null = null;
  private flingVx = 0;
  private flingVy = 0;
  private maxZoom = 3;
  private fitKind = '';
  private minZoom = 0.3;
  private userAdjusted = false;
  private safeInsets: FitInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  private keyPanX = 0;
  private keyPanZ = 0;

  private shakeIntensity = 0;
  private shakeCooldown = 0;
  private shakeSeed = 0;
  private shakeOffset = new THREE.Vector3();

  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndcVec = new THREE.Vector2();
  private readonly hitPoint = new THREE.Vector3();
  private readonly projectScratch = new THREE.Vector3();
  private readonly lastViewPos = new THREE.Vector3(NaN, NaN, NaN);
  private lastViewZoom = NaN;
  private viewVersion = 0;

  constructor(width: number, height: number) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    const aspect = this.viewportWidth / this.viewportHeight;
    const hh = BALANCE.camera.defaultFrustumHalfHeight;
    this.camera = new THREE.OrthographicCamera(-hh * aspect, hh * aspect, hh, -hh, 0.5, 200);
    this.updateCameraTransform();
  }

  /** Safe-area insets (CSS px) added to the HUD insets when framing the island. */
  setSafeInsets(insets: FitInsets): void {
    this.safeInsets = { ...insets };
  }

  /**
   * Measured HUD control rectangles (CSS px). When set, the default framing keeps the playable
   * tiles clear of them. Re-frames immediately unless the player has moved the camera.
   */
  setHudRects(rects: readonly PxRect[]): void {
    this.hudRects = rects.map((r) => ({ ...r }));
    if (this.fitPoints && !this.userAdjusted) this.applyFit(false);
  }

  configureForMap(cols: number, rows: number, layout?: readonly string[]): void {
    const halfW = cols * BALANCE.tileSize * 0.5 + 1.5;
    const halfH = rows * BALANCE.tileSize * 0.5 + 1.5;
    this.minBoundX = -halfW;
    this.maxBoundX = halfW;
    this.minBoundZ = -halfH;
    this.maxBoundZ = halfH;

    this.target.set(0, 0, 0);
    this.desiredTarget.set(0, 0, 0);
    this.yawIndex = 0;
    this.currentYaw = BASE_YAW_RAD;
    this.rotStartYaw = BASE_YAW_RAD;
    this.rotTargetYaw = BASE_YAW_RAD;
    this.rotProgress = 1;

    // World-space corner points (top + bottom of every land tile) used to frame the island.
    const pts: number[] = [];
    const playPts: number[] = [];
    const tileXyz: number[] = [];
    const tileWeight: number[] = [];
    const ts = BALANCE.tileSize;
    const halfTile = ts * 0.5;
    const addTile = (wx: number, wz: number, topY: number, playable = true): void => {
      const botY = -0.85;
      for (const sx of [-halfTile, halfTile]) {
        for (const sz of [-halfTile, halfTile]) {
          pts.push(wx + sx, topY, wz + sz, wx + sx, botY, wz + sz);
          // Playable footprint: tile tops only (cliff undersides do not need to fill the screen).
          if (playable) playPts.push(wx + sx, 0.5, wz + sz, wx + sx, 0.0, wz + sz);
        }
      }
    };
    if (layout && layout.length === rows) {
      for (let r = 0; r < rows; r++) {
        const tokens = (layout[r] ?? '').trim().split(/\s+/);
        for (let c = 0; c < cols; c++) {
          const tile = parseTileChar(tokens[c] ?? '~');
          if (tile === 'empty') continue;
          const topY = tile === 'spawn' || tile === 'goal' || tile === 'decor' ? 1.85 : 0.5;
          addTile(gridToWorldX(c, cols), gridToWorldZ(r, rows), topY, tile !== 'decor');
          if (tile !== 'decor') {
            tileXyz.push(gridToWorldX(c, cols), topY, gridToWorldZ(r, rows));
            tileWeight.push(tile === 'spawn' || tile === 'goal' ? 6 : tile === 'path' ? 0.7 : 1);
          }
        }
      }
    }
    if (pts.length === 0) {
      addTile(gridToWorldX(0, cols), gridToWorldZ(0, rows), 0.5);
      addTile(gridToWorldX(cols - 1, cols), gridToWorldZ(rows - 1, rows), 0.5);
      addTile(gridToWorldX(0, cols), gridToWorldZ(rows - 1, rows), 0.5);
      addTile(gridToWorldX(cols - 1, cols), gridToWorldZ(0, rows), 0.5);
    }
    if (playPts.length === 0) playPts.push(...pts);
    this.fitPoints = Float32Array.from(pts);
    this.fitPlayPoints = Float32Array.from(playPts);
    const stride = Math.max(1, Math.ceil(tileWeight.length / MAX_FIT_SAMPLES));
    const sx: number[] = [];
    const sw: number[] = [];
    for (let i = 0; i < tileWeight.length; i++) {
      // Always keep spawn / goal; thin out the rest on very large islands.
      if (i % stride !== 0 && tileWeight[i] < 6) continue;
      sx.push(tileXyz[i * 3], tileXyz[i * 3 + 1], tileXyz[i * 3 + 2]);
      sw.push(tileWeight[i]);
    }
    this.fitTileXyz = Float32Array.from(sx);
    this.fitTileWeight = Float32Array.from(sw);
    this.userAdjusted = false;
    this.applyFit(false);
  }

  /**
   * Re-frames the island for the current viewport (resize / orientation change). A camera the
   * player has moved by hand is left alone unless the layout class (portrait / landscape /
   * desktop) changed.
   */
  refit(): void {
    if (!this.fitPoints) return;
    const kind = pickFitProfile(this.viewportWidth, this.viewportHeight, this.safeInsets).kind;
    if (this.userAdjusted && kind === this.fitKind) return;
    this.userAdjusted = false;
    this.applyFit(false);
  }

  private applyFit(smooth: boolean): void {
    if (!this.fitPoints) return;
    const profile = pickFitProfile(this.viewportWidth, this.viewportHeight, this.safeInsets);
    const yaw = this.rotTargetYaw;
    const all = projectExtents(this.fitPoints, yaw, ISO_TILT_RAD);
    const play = projectExtents(this.fitPlayPoints ?? this.fitPoints, yaw, ISO_TILT_RAD);
    if (!all || !play) return;
    const fit = computePlayableFit(play, all, {
      viewportW: this.viewportWidth,
      viewportH: this.viewportHeight,
      insets: profile.insets,
      halfHeight: BALANCE.camera.defaultFrustumHalfHeight,
      yaw,
      tilt: ISO_TILT_RAD,
      kind: profile.kind,
      maxZoomFactor: 2.2,
    });
    let zoom = fit.zoom;
    let tx = fit.targetX;
    let tz = fit.targetZ;
    if (this.hudRects.length > 0 && this.fitTileXyz && this.fitTileWeight && !this.showcaseMode) {
      const st = Math.sin(ISO_TILT_RAD);
      const pts = projectPlanePoints(this.fitTileXyz, this.fitTileWeight, yaw, ISO_TILT_RAD);
      const occ = computeOcclusionFit(pts, {
        viewportW: this.viewportWidth,
        viewportH: this.viewportHeight,
        halfHeight: BALANCE.camera.defaultFrustumHalfHeight,
        tileWorld: BALANCE.tileSize,
        hudRects: this.hudRects,
        zoomCeil: fit.zoom,
        // May go a little below the whole-island zoom when a key tile would otherwise sit on the edge.
        zoomFloor: fit.minZoom * 0.8,
        coverage: OCCLUSION_COVERAGE,
        prefR: fit.targetX * Math.cos(yaw) - fit.targetZ * Math.sin(yaw),
        prefU: -(fit.targetX * Math.sin(yaw) + fit.targetZ * Math.cos(yaw)) * st,
      });
      const g = planeTargetToGround(occ.targetR, occ.targetU, yaw, ISO_TILT_RAD);
      zoom = occ.zoom;
      tx = g.x;
      tz = g.z;
    }
    this.fitPlane = {
      r: tx * Math.cos(yaw) - tz * Math.sin(yaw),
      u: -(tx * Math.sin(yaw) + tz * Math.cos(yaw)) * Math.sin(ISO_TILT_RAD),
    };
    this.planeExtYaw = NaN;
    this.cancelFling();
    this.fitKind = profile.kind;
    this.minZoom = Math.min(fit.minZoom, zoom);
    this.maxZoom = Math.max(fit.maxZoom, zoom * 2.2);
    this.desiredTarget.set(tx, 0, tz);
    this.desiredZoom = zoom;
    if (!smooth) {
      this.target.copy(this.desiredTarget);
      this.zoom = zoom;
      this.camera.zoom = zoom;
      this.camera.updateProjectionMatrix();
      this.updateCameraTransform();
    }
    this.viewVersion++;
  }

  setShowcaseMode(enabled: boolean): void {
    this.showcaseMode = enabled;
    if (!enabled) {
      this.yawIndex = 0;
      this.currentYaw = BASE_YAW_RAD;
      this.rotStartYaw = BASE_YAW_RAD;
      this.rotTargetYaw = BASE_YAW_RAD;
      this.rotProgress = 1;
      this.updateCameraTransform();
    }
  }

  resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    const aspect = this.viewportWidth / this.viewportHeight;
    const hh = BALANCE.camera.defaultFrustumHalfHeight;
    this.camera.left = -hh * aspect;
    this.camera.right = hh * aspect;
    this.camera.top = hh;
    this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();
    this.viewVersion++;
    this.refit();
  }

  rotate90(dir: -1 | 1): void {
    this.yawIndex += dir;
    this.rotStartYaw = this.currentYaw;
    this.rotTargetYaw = BASE_YAW_RAD + this.yawIndex * (Math.PI * 0.5);
    this.rotProgress = 0;
    if (!this.userAdjusted && this.fitKind !== 'desktop') this.applyFit(true);
  }

  setKeyPan(x: number, z: number): void {
    this.keyPanX = x;
    this.keyPanZ = z;
  }

  /** Pointer / finger driven pan: also stops any inertia. */
  panByScreenDelta(dx: number, dy: number): void {
    this.cancelFling();
    this.applyScreenPan(dx, dy);
  }

  /** Starts camera inertia from a release velocity in screen px/s (same direction as the drag). */
  fling(vx: number, vy: number): void {
    this.flingVx = vx;
    this.flingVy = vy;
  }

  cancelFling(): void {
    this.flingVx = 0;
    this.flingVy = 0;
  }

  /** Smoothly returns to the default framing (double-tap / C key). */
  recenter(): void {
    if (!this.fitPoints) return;
    this.cancelFling();
    this.userAdjusted = false;
    this.applyFit(true);
  }

  private applyScreenPan(dx: number, dy: number): void {
    this.userAdjusted = true;
    const worldHeight = (this.camera.top - this.camera.bottom) / this.camera.zoom;
    const worldWidth = (this.camera.right - this.camera.left) / this.camera.zoom;
    const pxToWorldX = worldWidth / this.viewportWidth;
    const pxToWorldY = worldHeight / (this.viewportHeight * Math.sin(ISO_TILT_RAD));

    const cosY = Math.cos(this.currentYaw);
    const sinY = Math.sin(this.currentYaw);

    // Camera right on XZ = (cosY, -sinY), forward on XZ = (-sinY, -cosY)
    const moveRight = -dx * pxToWorldX;
    const moveForward = dy * pxToWorldY;

    this.desiredTarget.x += cosY * moveRight - sinY * moveForward;
    this.desiredTarget.z += -sinY * moveRight - cosY * moveForward;
    this.clampDesiredTarget();
  }

  zoomByDelta(delta: number, ndcX: number, ndcY: number): void {
    this.userAdjusted = true;
    const before = this.screenNdcToPlane(ndcX, ndcY, 0);
    const prevX = before ? before.x : this.desiredTarget.x;
    const prevZ = before ? before.z : this.desiredTarget.z;

    const minAllowedZoom = this.minZoom;
    this.desiredZoom = Math.max(
      minAllowedZoom,
      Math.min(this.maxZoom, this.desiredZoom + delta * this.desiredZoom),
    );

    this.clampDesiredTarget();
    if (before) {
      // Shift target slightly toward zoom focal point for natural wheel-zoom feel
      const oldZoom = this.camera.zoom;
      this.camera.zoom = this.desiredZoom;
      this.camera.updateProjectionMatrix();
      const after = this.screenNdcToPlane(ndcX, ndcY, 0);
      if (after) {
        this.desiredTarget.x += prevX - after.x;
        this.desiredTarget.z += prevZ - after.z;
        this.clampDesiredTarget();
      }
      this.camera.zoom = oldZoom;
      this.camera.updateProjectionMatrix();
    }
  }

  addShake(amount: number, enabled: boolean): void {
    if (!enabled) return;
    if (this.shakeCooldown > 0) {
      // Allow heavier impacts (e.g. boss defeat) to raise amplitude without stacking rapid chip hits.
      this.shakeIntensity = Math.min(0.15, Math.max(this.shakeIntensity, amount));
      return;
    }
    this.shakeIntensity = Math.min(0.15, Math.max(this.shakeIntensity, amount));
    this.shakeCooldown = 0.22;
  }

  update(dt: number): void {
    // Keyboard WASD / Arrow panning relative to current camera yaw
    if (this.keyPanX !== 0 || this.keyPanZ !== 0) {
      this.userAdjusted = true;
      const len = Math.hypot(this.keyPanX, this.keyPanZ);
      const nx = this.keyPanX / len;
      const nz = this.keyPanZ / len;
      const speed = (BALANCE.camera.panSpeed / Math.max(0.6, this.zoom)) * dt;
      const cosY = Math.cos(this.currentYaw);
      const sinY = Math.sin(this.currentYaw);
      // nz < 0 (W/Up) moves forward (-sinY, -cosY); nx > 0 (D/Right) moves right (cosY, -sinY)
      this.desiredTarget.x += (cosY * nx + sinY * nz) * speed;
      this.desiredTarget.z += (-sinY * nx + cosY * nz) * speed;
      this.clampDesiredTarget();
    }

    if (this.flingVx !== 0 || this.flingVy !== 0) {
      const f = stepFling(this.flingVx, this.flingVy, dt);
      const bx = this.desiredTarget.x;
      const bz = this.desiredTarget.z;
      this.applyScreenPan(f.dx, f.dy);
      const moved = Math.hypot(this.desiredTarget.x - bx, this.desiredTarget.z - bz);
      // Hit a pan limit: bleed off the remaining momentum quickly.
      const k = moved < 1e-4 && Math.hypot(f.dx, f.dy) > 0.5 ? 0.6 : 1;
      this.flingVx = f.vx * k;
      this.flingVy = f.vy * k;
      if (Math.hypot(this.flingVx, this.flingVy) < FLING_STOP_SPEED) this.cancelFling();
    }

    // Eased 90deg camera rotation or slow menu diorama showcase orbit
    if (this.showcaseMode) {
      this.currentYaw += dt * 0.11;
    } else if (this.rotProgress < 1) {
      this.rotProgress = Math.min(1, this.rotProgress + dt / BALANCE.camera.rotationDurationSec);
      const t = this.rotProgress;
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.currentYaw = this.rotStartYaw + (this.rotTargetYaw - this.rotStartYaw) * eased;
    } else {
      this.currentYaw = this.rotTargetYaw;
    }

    // Smooth pan and zoom interpolation
    const panAlpha = 1 - Math.exp(-BALANCE.camera.panLerpSpeed * dt);
    this.target.lerp(this.desiredTarget, panAlpha);

    const zoomAlpha = 1 - Math.exp(-BALANCE.camera.zoomLerpSpeed * dt);
    this.zoom += (this.desiredZoom - this.zoom) * zoomAlpha;
    if (Math.abs(this.camera.zoom - this.zoom) > 0.0001) {
      this.camera.zoom = this.zoom;
      this.camera.updateProjectionMatrix();
    }

    if (this.shakeCooldown > 0) {
      this.shakeCooldown = Math.max(0, this.shakeCooldown - dt);
    }

    // Camera shake decay
    if (this.shakeIntensity > 0.001) {
      this.shakeSeed += dt * 42;
      const sx = Math.sin(this.shakeSeed * 1.7) * this.shakeIntensity;
      const sy = Math.cos(this.shakeSeed * 2.3) * this.shakeIntensity * 0.7;
      const sz = Math.sin(this.shakeSeed * 1.3 + 1.1) * this.shakeIntensity;
      this.shakeOffset.set(sx, sy, sz);
      this.shakeIntensity *= Math.exp(-BALANCE.camera.shakeDecay * dt);
    } else {
      this.shakeIntensity = 0;
      this.shakeOffset.set(0, 0, 0);
    }

    this.updateCameraTransform();
    this.bumpViewVersionIfMoved();
  }

  /**
   * Monotonic counter that increments whenever the rendered view (position, zoom, viewport)
   * changes. Lets callers skip per-frame raycasts while the camera is still.
   */
  getViewVersion(): number {
    return this.viewVersion;
  }

  private bumpViewVersionIfMoved(): void {
    const pos = this.camera.position;
    if (!pos.equals(this.lastViewPos) || this.camera.zoom !== this.lastViewZoom) {
      this.lastViewPos.copy(pos);
      this.lastViewZoom = this.camera.zoom;
      this.viewVersion++;
    }
  }

  /**
   * Intersects the pointer ray with the horizontal plane `y = planeY`.
   * Without `out` the result lives in a shared scratch vector that the next call overwrites —
   * pass your own `out` when you need to keep more than one hit alive at the same time.
   */
  screenNdcToPlane(
    ndcX: number,
    ndcY: number,
    planeY: number,
    out: THREE.Vector3 = this.hitPoint,
  ): THREE.Vector3 | null {
    this.ndcVec.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndcVec, this.camera);
    this.groundPlane.constant = -planeY;
    return this.raycaster.ray.intersectPlane(this.groundPlane, out);
  }

  worldToScreen(worldPos: THREE.Vector3, out: { x: number; y: number }): void {
    const projected = this.projectScratch.copy(worldPos).project(this.camera);
    out.x = (projected.x * 0.5 + 0.5) * this.viewportWidth;
    out.y = (-projected.y * 0.5 + 0.5) * this.viewportHeight;
  }

  worldCoordsToScreen(x: number, y: number, z: number, out: { x: number; y: number }): void {
    const projected = this.projectScratch.set(x, y, z).project(this.camera);
    out.x = (projected.x * 0.5 + 0.5) * this.viewportWidth;
    out.y = (-projected.y * 0.5 + 0.5) * this.viewportHeight;
  }

  getRay(): THREE.Ray {
    return this.raycaster.ray;
  }

  setNdcRay(ndcX: number, ndcY: number): THREE.Ray {
    this.ndcVec.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndcVec, this.camera);
    return this.raycaster.ray;
  }

  private clampDesiredTarget(): void {
    this.desiredTarget.x = Math.max(this.minBoundX, Math.min(this.maxBoundX, this.desiredTarget.x));
    this.desiredTarget.z = Math.max(this.minBoundZ, Math.min(this.maxBoundZ, this.desiredTarget.z));
    if (this.showcaseMode || !this.fitPlayPoints) return;
    const yaw = this.currentYaw;
    if (this.planeExt === null || Math.abs(yaw - this.planeExtYaw) > 1e-3) {
      const e = projectExtents(this.fitPlayPoints, yaw, ISO_TILT_RAD);
      if (!e) return;
      const pad = BALANCE.tileSize * 0.8;
      this.planeExt = { rMin: e.minX - pad, rMax: e.maxX + pad, uMin: e.minY - pad, uMax: e.maxY + pad };
      this.planeExtYaw = yaw;
    }
    const st = Math.sin(ISO_TILT_RAD);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const zoom = Math.max(0.01, this.desiredZoom);
    const halfR = (this.camera.right - this.camera.left) / 2 / zoom;
    const halfU = (this.camera.top - this.camera.bottom) / 2 / zoom;
    const tr = this.desiredTarget.x * cy - this.desiredTarget.z * sy;
    const tu = -(this.desiredTarget.x * sy + this.desiredTarget.z * cy) * st;
    const c = clampPlaneTarget(tr, tu, this.planeExt, halfR, halfU, 0.35, this.fitPlane);
    if (c.r === tr && c.u === tu) return;
    const g = planeTargetToGround(c.r, c.u, yaw, ISO_TILT_RAD);
    this.desiredTarget.x = g.x;
    this.desiredTarget.z = g.z;
  }

  private updateCameraTransform(): void {
    const cosTilt = Math.cos(ISO_TILT_RAD);
    const sinTilt = Math.sin(ISO_TILT_RAD);
    const dx = Math.sin(this.currentYaw) * cosTilt * CAMERA_DISTANCE;
    const dy = sinTilt * CAMERA_DISTANCE;
    const dz = Math.cos(this.currentYaw) * cosTilt * CAMERA_DISTANCE;

    const tx = this.target.x + this.shakeOffset.x;
    const ty = this.target.y + this.shakeOffset.y;
    const tz = this.target.z + this.shakeOffset.z;

    this.camera.position.set(tx + dx, ty + dy, tz + dz);
    this.camera.lookAt(tx, ty, tz);
  }
}
