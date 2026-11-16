import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraController } from '../../src/render/cameraController.ts';

describe('CameraController.screenNdcToPlane', () => {
  it('keeps ground and flyer-plane hits independent when an out vector is passed', () => {
    const cam = new CameraController(1280, 720);
    cam.camera.updateMatrixWorld(true);
    const ground = new THREE.Vector3();
    const flyer = new THREE.Vector3();
    const g = cam.screenNdcToPlane(0.2, -0.1, 0, ground);
    const f = cam.screenNdcToPlane(0.2, -0.1, 1.6, flyer);
    expect(g).toBe(ground);
    expect(f).toBe(flyer);
    expect(ground.y).toBeCloseTo(0, 5);
    expect(flyer.y).toBeCloseTo(1.6, 5);
    // Same screen point on a higher plane lands at a different XZ in an angled view.
    expect(Math.hypot(ground.x - flyer.x, ground.z - flyer.z)).toBeGreaterThan(0.1);
  });

  it('projecting to screen does not clobber a previous default-scratch plane hit', () => {
    const cam = new CameraController(1280, 720);
    cam.camera.updateMatrixWorld(true);
    const hit = cam.screenNdcToPlane(0, 0, 0);
    expect(hit).not.toBeNull();
    const before = hit!.clone();
    const out = { x: 0, y: 0 };
    cam.worldCoordsToScreen(5, 2, -3, out);
    cam.worldToScreen(new THREE.Vector3(1, 1, 1), out);
    expect(hit!.equals(before)).toBe(true);
  });
});
