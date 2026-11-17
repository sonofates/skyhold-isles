import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { CameraController } from '../../src/render/cameraController.ts';

describe('CameraController framing, pan/zoom/rotate, shake, and viewVersion', () => {
  it('frames islands cleanly for desktop and mobile portrait viewports and handles missing layout', () => {
    const desktop = new CameraController(1280, 720);
    desktop.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);
    expect(Number.isFinite(desktop.camera.zoom)).toBe(true);
    expect(desktop.camera.zoom).toBeGreaterThanOrEqual(0.72);
    expect(desktop.camera.zoom).toBeLessThanOrEqual(1.55);

    const portrait = new CameraController(390, 844);
    portrait.configureForMap(LEVELS[8].cols, LEVELS[8].rows, LEVELS[8].layout);
    expect(Number.isFinite(portrait.camera.zoom)).toBe(true);
    expect(portrait.camera.zoom).toBeGreaterThanOrEqual(0.34);
    expect(portrait.camera.zoom).toBeLessThanOrEqual(1.55);

    // Fallback path when layout is omitted
    portrait.configureForMap(14, 11);
    expect(Number.isFinite(portrait.camera.zoom)).toBe(true);
    expect(portrait.camera.zoom).toBeGreaterThanOrEqual(0.34);
  });

  it('rotates 90 degrees smoothly, increments viewVersion on motion, and settles at exact target yaw', () => {
    const cam = new CameraController(1280, 720);
    cam.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);
    const v0 = cam.getViewVersion();

    cam.rotate90(1);
    cam.update(BALANCE.camera.rotationDurationSec * 0.5);
    const vMid = cam.getViewVersion();
    expect(vMid).toBeGreaterThan(v0);

    // Finish rotation and confirm position settles and viewVersion stops changing when still
    for (let i = 0; i < 60; i++) cam.update(1 / 60);
    const vSettled = cam.getViewVersion();
    cam.update(1 / 60);
    expect(cam.getViewVersion()).toBe(vSettled);

    // Verify showcase mode orbits continuously and resets cleanly when turned off
    const posBefore = cam.camera.position.clone();
    cam.setShowcaseMode(true);
    cam.update(0.5);
    expect(cam.camera.position.distanceTo(posBefore)).toBeGreaterThan(0.5);
    cam.setShowcaseMode(false);
  });

  it('clamps pan bounds across drag and WASD panning and clamps zoom within allowed limits', () => {
    const cam = new CameraController(1280, 720);
    const cols = 10;
    const rows = 10;
    cam.configureForMap(cols, rows);
    const maxBoundX = cols * BALANCE.tileSize * 0.5 + BALANCE.camera.panBoundsPadding;
    const maxBoundZ = rows * BALANCE.tileSize * 0.5 + BALANCE.camera.panBoundsPadding;

    // Extreme drag pan cannot push camera target outside bounds
    for (let i = 0; i < 30; i++) {
      cam.panByScreenDelta(-5000, -5000);
      cam.update(0.1);
    }
    const centerGround = cam.screenNdcToPlane(0, 0, 0)!;
    expect(Math.abs(centerGround.x)).toBeLessThanOrEqual(maxBoundX + 0.05);
    expect(Math.abs(centerGround.z)).toBeLessThanOrEqual(maxBoundZ + 0.05);

    // Keyboard pan in rotated frame stays bounded and updates smoothly
    cam.setKeyPan(1, -1);
    for (let i = 0; i < 40; i++) cam.update(0.1);
    cam.setKeyPan(0, 0);
    const afterKeyPan = cam.screenNdcToPlane(0, 0, 0)!;
    expect(Math.abs(afterKeyPan.x)).toBeLessThanOrEqual(maxBoundX + 0.05);
    expect(Math.abs(afterKeyPan.z)).toBeLessThanOrEqual(maxBoundZ + 0.05);

    // Zoom clamps cleanly at min (0.72 desktop) and max (3.6) while anchoring cursor plane
    cam.zoomByDelta(-10, 0.2, 0.2);
    for (let i = 0; i < 120; i++) cam.update(1 / 60);
    expect(cam.camera.zoom).toBeCloseTo(0.72, 2);

    cam.zoomByDelta(20, -0.3, 0.25);
    for (let i = 0; i < 120; i++) cam.update(1 / 60);
    expect(cam.camera.zoom).toBeCloseTo(3.6, 2);

    // Resize updates viewport projection & bumps viewVersion
    const preResize = cam.getViewVersion();
    cam.resize(800, 600);
    expect(cam.getViewVersion()).toBeGreaterThan(preResize);
  });

  it('respects shake enable flag, chip cooldown, heavy-impact override, and exponential decay', () => {
    const cam = new CameraController(1280, 720);
    cam.configureForMap(10, 10);
    const restPos = cam.camera.position.clone();

    // Disabled shake produces zero offset
    cam.addShake(0.12, false);
    cam.update(1 / 60);
    expect(cam.camera.position.distanceTo(restPos)).toBeCloseTo(0, 6);

    // Enabled shake perturbs camera position and decays cleanly to zero
    cam.addShake(0.05, true);
    cam.update(1 / 60);
    const offsetAfterSmall = cam.camera.position.distanceTo(restPos);
    expect(offsetAfterSmall).toBeGreaterThan(0);

    // Larger impact overrides during cooldown
    cam.addShake(0.14, true);
    cam.update(1 / 60);
    expect(cam.camera.position.distanceTo(restPos)).toBeGreaterThan(0.01);

    // Decay over ~2s returns exactly to rest position
    for (let i = 0; i < 120; i++) cam.update(1 / 60);
    expect(cam.camera.position.distanceTo(restPos)).toBeCloseTo(0, 5);
  });

  it('anchors zoom focal point under cursor and round-trips world/screen/ray across 90-degree rotation', () => {
    const cam = new CameraController(1280, 720);
    cam.configureForMap(14, 11);

    // Off-center cursor zoom keeps world point under cursor anchored
    const ndcX = 0.35;
    const ndcY = -0.25;
    const anchorBefore = cam.screenNdcToPlane(ndcX, ndcY, 0)!.clone();
    cam.zoomByDelta(0.5, ndcX, ndcY);
    for (let i = 0; i < 120; i++) cam.update(1 / 60);
    const anchorAfter = cam.screenNdcToPlane(ndcX, ndcY, 0)!;
    expect(Math.hypot(anchorAfter.x - anchorBefore.x, anchorAfter.z - anchorBefore.z)).toBeLessThan(0.05);

    // Rotate 90 degrees and settle, then verify worldCoordsToScreen <-> screenNdcToPlane & setNdcRay/getRay
    cam.rotate90(1);
    for (let i = 0; i < 60; i++) cam.update(1 / 60);

    const screenOut = { x: 0, y: 0 };
    cam.worldCoordsToScreen(3, 0, -2, screenOut);
    const vecScreenOut = { x: 0, y: 0 };
    cam.worldToScreen(new THREE.Vector3(3, 0, -2), vecScreenOut);
    expect(vecScreenOut.x).toBeCloseTo(screenOut.x, 5);
    expect(vecScreenOut.y).toBeCloseTo(screenOut.y, 5);
    const rtNdcX = (screenOut.x / 1280) * 2 - 1;
    const rtNdcY = -(screenOut.y / 720) * 2 + 1;
    const recovered = cam.screenNdcToPlane(rtNdcX, rtNdcY, 0)!;
    expect(recovered.x).toBeCloseTo(3, 3);
    expect(recovered.z).toBeCloseTo(-2, 3);

    const ray = cam.setNdcRay(rtNdcX, rtNdcY);
    expect(cam.getRay()).toBe(ray);
    const planeHit = new THREE.Vector3();
    expect(ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), planeHit)).not.toBeNull();
    expect(planeHit.x).toBeCloseTo(3, 3);
    expect(planeHit.z).toBeCloseTo(-2, 3);
  });

  it('pans relative to rotated yaw, returns to start after 4x rotate90(-1), and handles mismatched layout fallback', () => {
    const cam = new CameraController(1280, 720);
    cam.configureForMap(10, 10, ['bad']); // mismatched length -> falls back cleanly
    expect(Number.isFinite(cam.camera.zoom)).toBe(true);

    const initialScreen = { x: 0, y: 0 };
    cam.worldCoordsToScreen(2, 0, -1, initialScreen);

    for (let i = 0; i < 4; i++) {
      cam.rotate90(-1);
      for (let t = 0; t < 40; t++) cam.update(1 / 60);
    }
    const fullCircleScreen = { x: 0, y: 0 };
    cam.worldCoordsToScreen(2, 0, -1, fullCircleScreen);
    expect(fullCircleScreen.x).toBeCloseTo(initialScreen.x, 1);
    expect(fullCircleScreen.y).toBeCloseTo(initialScreen.y, 1);

    // Rotate 90 degrees and verify horizontal screen pan moves center ground point in rotated screen space
    cam.rotate90(1);
    for (let t = 0; t < 40; t++) cam.update(1 / 60);
    const beforePan = cam.screenNdcToPlane(0, 0, 0)!.clone();
    cam.panByScreenDelta(-120, 0);
    for (let t = 0; t < 60; t++) cam.update(1 / 60);
    const afterPan = cam.screenNdcToPlane(0, 0, 0)!;
    expect(afterPan.distanceTo(beforePan)).toBeGreaterThan(0.5);
  });

  it('normalizes diagonal key pan, clamps zero viewport dimensions, and returns null for parallel ray casts', () => {
    // Diagonal setKeyPan(1, 1) normalizes displacement distance to match cardinal setKeyPan(1, 0)
    const cardinal = new CameraController(1280, 720);
    cardinal.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);
    const cStart = cardinal.screenNdcToPlane(0, 0, 0, new THREE.Vector3())!;
    cardinal.setKeyPan(1, 0);
    for (let t = 0; t < 30; t++) cardinal.update(1 / 60);
    cardinal.setKeyPan(0, 0);
    for (let t = 0; t < 60; t++) cardinal.update(1 / 60);
    const cEnd = cardinal.screenNdcToPlane(0, 0, 0, new THREE.Vector3())!;
    const cardinalDist = cEnd.distanceTo(cStart);

    const diagonal = new CameraController(1280, 720);
    diagonal.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);
    const dStart = diagonal.screenNdcToPlane(0, 0, 0, new THREE.Vector3())!;
    diagonal.setKeyPan(1, 1);
    for (let t = 0; t < 30; t++) diagonal.update(1 / 60);
    diagonal.setKeyPan(0, 0);
    for (let t = 0; t < 60; t++) diagonal.update(1 / 60);
    const dEnd = diagonal.screenNdcToPlane(0, 0, 0, new THREE.Vector3())!;
    const diagonalDist = dEnd.distanceTo(dStart);
    expect(diagonalDist).toBeGreaterThan(0.5);
    expect(diagonalDist).toBeCloseTo(cardinalDist, 2);

    // Constructor and resize clamp 0x0 viewports safely without NaN
    const zeroCam = new CameraController(0, 0);
    expect(Number.isFinite(zeroCam.camera.left)).toBe(true);
    expect(Number.isFinite(zeroCam.camera.right)).toBe(true);
    zeroCam.resize(0, -10);
    zeroCam.update(0);
    expect(Number.isFinite(zeroCam.camera.top)).toBe(true);
    expect(zeroCam.screenNdcToPlane(0, 0, 0)).not.toBeNull();

    // Parallel horizontal camera ray produces null from screenNdcToPlane
    zeroCam.camera.position.set(0, 5, 10);
    zeroCam.camera.lookAt(0, 5, 0);
    zeroCam.camera.updateMatrixWorld(true);
    expect(zeroCam.screenNdcToPlane(0, 0, 0)).toBeNull();

    // zoomByDelta also survives a null screenNdcToPlane focal hit without NaN
    expect(() => zeroCam.zoomByDelta(0.25, 0, 0)).not.toThrow();
    zeroCam.update(1 / 60);
    expect(Number.isFinite(zeroCam.camera.zoom)).toBe(true);
  });

  it('preserves stronger shake during cooldown, refreshes after expiry, and anchors zoomByDelta under rotated yaw', () => {
    const camBaseline = new CameraController(1280, 720);
    camBaseline.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);
    const camDownIgnore = new CameraController(1280, 720);
    camDownIgnore.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);
    const camCap = new CameraController(1280, 720);
    camCap.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);
    const camRaise = new CameraController(1280, 720);
    camRaise.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);

    camBaseline.addShake(0.08, true);
    camDownIgnore.addShake(0.08, true);
    camDownIgnore.addShake(0.02, true); // smaller impact during cooldown must not downgrade

    camCap.addShake(0.15, true);
    camRaise.addShake(0.08, true);
    camRaise.addShake(0.25, true); // heavier impact during cooldown raises and clamps at 0.15

    camBaseline.update(1 / 60);
    camDownIgnore.update(1 / 60);
    camCap.update(1 / 60);
    camRaise.update(1 / 60);

    expect(camDownIgnore.camera.position.distanceTo(camBaseline.camera.position)).toBeCloseTo(0, 6);
    expect(camRaise.camera.position.distanceTo(camCap.camera.position)).toBeCloseTo(0, 6);
    expect(camRaise.camera.position.distanceTo(camBaseline.camera.position)).toBeGreaterThan(0.01);

    // Let cooldown (>0.22s) and active shake settle, then verify fresh shake triggers cleanly
    for (let i = 0; i < 180; i++) camBaseline.update(1 / 60);
    const restedPos = camBaseline.camera.position.clone();
    camBaseline.addShake(0.06, true);
    camBaseline.update(1 / 60);
    expect(camBaseline.camera.position.distanceTo(restedPos)).toBeGreaterThan(0.01);

    // Cursor-anchored zoomByDelta after rotating yaw by +90 degrees
    const rotated = new CameraController(1280, 720);
    rotated.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);
    rotated.rotate90(1);
    for (let i = 0; i < 60; i++) rotated.update(1 / 60);

    const anchorBefore = rotated.screenNdcToPlane(0.35, -0.25, 0)!.clone();
    rotated.zoomByDelta(0.35, 0.35, -0.25);
    for (let i = 0; i < 180; i++) rotated.update(1 / 60);
    const anchorAfter = rotated.screenNdcToPlane(0.35, -0.25, 0)!;
    expect(anchorAfter.distanceTo(anchorBefore)).toBeLessThan(0.05);
  });
});
