import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraController } from '../../src/render/cameraController.ts';
import { computeFit, pickFitProfile, projectExtents } from '../../src/render/cameraFit.ts';

const TILT = Math.asin(1 / Math.sqrt(3));
const YAW = Math.PI / 4;
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };

describe('cameraFit', () => {
  it('projectExtents matches the three.js camera projection', () => {
    const cam = new CameraController(800, 600);
    cam.camera.updateMatrixWorld(true);
    const pts = [3, 0.5, -2, -4, 1, 5, 0, -0.85, 0];
    const ext = projectExtents(pts, YAW, TILT)!;
    const hh = 13.5;
    const aspect = 800 / 600;
    const v = new THREE.Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).project(cam.camera);
      minX = Math.min(minX, v.x * hh * aspect);
      maxX = Math.max(maxX, v.x * hh * aspect);
    }
    expect(ext.minX).toBeCloseTo(minX, 4);
    expect(ext.maxX).toBeCloseTo(maxX, 4);
  });

  it('centres the extents in the free rect and fits inside it', () => {
    const pts = [-10, 0.5, -8, 10, 0.5, -8, -10, 0.5, 8, 10, 0.5, 8, -10, -0.85, 8];
    const ext = projectExtents(pts, YAW, TILT)!;
    const insets = { top: 76, bottom: 112, left: 6, right: 6 };
    const fit = computeFit(ext, {
      viewportW: 430,
      viewportH: 739,
      insets,
      halfHeight: 13.5,
      yaw: YAW,
      tilt: TILT,
      fill: 1,
      minZoom: 0.05,
      maxZoom: 5,
    });
    // Verify against a real orthographic camera placed at the computed target.
    const cam = new CameraController(430, 739);
    cam.camera.zoom = fit.zoom;
    cam.camera.updateProjectionMatrix();
    cam.camera.position.set(
      fit.targetX + Math.sin(YAW) * Math.cos(TILT) * 54,
      Math.sin(TILT) * 54,
      fit.targetZ + Math.cos(YAW) * Math.cos(TILT) * 54,
    );
    cam.camera.lookAt(fit.targetX, 0, fit.targetZ);
    cam.camera.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let minPx = Infinity;
    let maxPx = -Infinity;
    let minPy = Infinity;
    let maxPy = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).project(cam.camera);
      const px = (v.x * 0.5 + 0.5) * 430;
      const py = (-v.y * 0.5 + 0.5) * 739;
      minPx = Math.min(minPx, px);
      maxPx = Math.max(maxPx, px);
      minPy = Math.min(minPy, py);
      maxPy = Math.max(maxPy, py);
    }
    expect(minPx).toBeGreaterThanOrEqual(insets.left - 1);
    expect(maxPx).toBeLessThanOrEqual(430 - insets.right + 1);
    expect(minPy).toBeGreaterThanOrEqual(insets.top - 1);
    expect(maxPy).toBeLessThanOrEqual(739 - insets.bottom + 1);
    expect((minPy + maxPy) / 2).toBeCloseTo((insets.top + 739 - insets.bottom) / 2, 0);
    expect((minPx + maxPx) / 2).toBeCloseTo(215, 0);
  });

  it('clamps zoom to the allowed range', () => {
    const ext = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const fit = computeFit(ext, {
      viewportW: 1000,
      viewportH: 1000,
      insets: ZERO,
      halfHeight: 13.5,
      yaw: YAW,
      tilt: TILT,
      fill: 1,
      minZoom: 0.2,
      maxZoom: 1.5,
    });
    expect(fit.zoom).toBe(1.5);
  });

  it('picks profiles by viewport class and adds safe-area insets', () => {
    expect(pickFitProfile(430, 739, ZERO).kind).toBe('portrait');
    expect(pickFitProfile(932, 380, ZERO).kind).toBe('landscape-phone');
    expect(pickFitProfile(1440, 900, ZERO).kind).toBe('desktop');
    const p = pickFitProfile(430, 739, { top: 47, right: 0, bottom: 34, left: 0 });
    expect(p.insets.top).toBeGreaterThan(pickFitProfile(430, 739, ZERO).insets.top);
  });

  it('refits on resize but keeps a hand-adjusted camera in the same layout class', () => {
    const cam = new CameraController(430, 739);
    const layout = Array.from({ length: 10 }, () => 'G G G G G G G G G G G G');
    cam.configureForMap(12, 10, layout);
    const fitZoom = cam.camera.zoom;
    cam.resize(932, 380);
    expect(cam.camera.zoom).not.toBeCloseTo(fitZoom, 3);
    cam.configureForMap(12, 10, layout);
    cam.zoomByDelta(0.3, 0, 0);
    cam.update(1);
    const adjusted = cam.camera.zoom;
    cam.resize(900, 360);
    cam.update(0);
    expect(cam.camera.zoom).toBeCloseTo(adjusted, 3);
  });
});
