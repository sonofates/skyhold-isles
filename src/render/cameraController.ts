import * as THREE from 'three';
import { BALANCE } from '../data/balance.ts';

const ISO_TILT_RAD = Math.asin(1 / Math.sqrt(3)); // ~35.26439 deg true isometric elevation
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

  private keyPanX = 0;
  private keyPanZ = 0;

  private shakeIntensity = 0;
  private shakeSeed = 0;
  private shakeOffset = new THREE.Vector3();

  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndcVec = new THREE.Vector2();
  private readonly hitPoint = new THREE.Vector3();

  constructor(width: number, height: number) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    const aspect = this.viewportWidth / this.viewportHeight;
    const hh = BALANCE.camera.defaultFrustumHalfHeight;
    this.camera = new THREE.OrthographicCamera(-hh * aspect, hh * aspect, hh, -hh, 0.5, 200);
    this.updateCameraTransform();
  }

  configureForMap(cols: number, rows: number): void {
    const halfW = cols * BALANCE.tileSize * 0.5 + BALANCE.camera.panBoundsPadding;
    const halfH = rows * BALANCE.tileSize * 0.5 + BALANCE.camera.panBoundsPadding;
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

    // Fit initial zoom gracefully across desktop and portrait mobile screens
    const aspect = this.viewportWidth / this.viewportHeight;
    const mapSpan = Math.max(cols, rows) * BALANCE.tileSize * 1.15;
    const horizAvailable = BALANCE.camera.defaultFrustumHalfHeight * 2 * aspect;
    const fitZoom = Math.max(0.58, Math.min(1.0, horizAvailable / mapSpan));
    this.zoom = fitZoom;
    this.desiredZoom = fitZoom;
    this.camera.zoom = fitZoom;
    this.camera.updateProjectionMatrix();
    this.updateCameraTransform();
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
  }

  rotate90(dir: -1 | 1): void {
    this.yawIndex += dir;
    this.rotStartYaw = this.currentYaw;
    this.rotTargetYaw = BASE_YAW_RAD + this.yawIndex * (Math.PI * 0.5);
    this.rotProgress = 0;
  }

  setKeyPan(x: number, z: number): void {
    this.keyPanX = x;
    this.keyPanZ = z;
  }

  panByScreenDelta(dx: number, dy: number): void {
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
    const before = this.screenNdcToPlane(ndcX, ndcY, 0);
    const prevX = before ? before.x : this.desiredTarget.x;
    const prevZ = before ? before.z : this.desiredTarget.z;

    this.desiredZoom = Math.max(
      BALANCE.camera.minZoom,
      Math.min(BALANCE.camera.maxZoom, this.desiredZoom + delta * this.desiredZoom),
    );

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
    this.shakeIntensity = Math.min(0.45, this.shakeIntensity + amount);
  }

  update(dt: number): void {
    // Keyboard WASD / Arrow panning relative to current camera yaw
    if (this.keyPanX !== 0 || this.keyPanZ !== 0) {
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
  }

  screenNdcToPlane(ndcX: number, ndcY: number, planeY: number): THREE.Vector3 | null {
    this.ndcVec.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndcVec, this.camera);
    this.groundPlane.constant = -planeY;
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint);
    return hit;
  }

  worldToScreen(worldPos: THREE.Vector3, out: { x: number; y: number }): void {
    const projected = this.hitPoint.copy(worldPos).project(this.camera);
    out.x = (projected.x * 0.5 + 0.5) * this.viewportWidth;
    out.y = (-projected.y * 0.5 + 0.5) * this.viewportHeight;
  }

  worldCoordsToScreen(x: number, y: number, z: number, out: { x: number; y: number }): void {
    this.hitPoint.set(x, y, z).project(this.camera);
    out.x = (this.hitPoint.x * 0.5 + 0.5) * this.viewportWidth;
    out.y = (-this.hitPoint.y * 0.5 + 0.5) * this.viewportHeight;
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
