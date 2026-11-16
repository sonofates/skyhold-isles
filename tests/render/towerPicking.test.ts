import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { TowerType } from '../../src/core/types.ts';
import type { TowerEntity } from '../../src/sim/entities.ts';
import { getTowerPickBounds, getTowerPickHeight, pickTowerByRay } from '../../src/render/towerPicking.ts';

function makeTower(id: number, type: TowerType, tier: 1 | 2 | 3, x: number, z: number): TowerEntity {
  return {
    id,
    col: 0,
    row: 0,
    x,
    z,
    type,
    tier,
    totalInvested: 60,
    targetingMode: 'first',
    cooldownTimer: 0,
    yaw: 0,
    prevYaw: 0,
    targetYaw: 0,
    recoil: 0,
    popAnimTimer: 0,
    stunTimer: 0,
    totalDamageDealt: 0,
    kills: 0,
  };
}

describe('towerPicking', () => {
  it('selects a tall T3 tower when clicking its upper spire from all 4 isometric rotations', () => {
    const t3Frost = makeTower(7, 'frost', 3, 2, -2);
    const height = getTowerPickHeight('frost', 3);
    expect(height).toBeGreaterThan(2.9);

    const upperTarget = new THREE.Vector3(t3Frost.x, height - 0.25, t3Frost.z);
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 100);

    // Camera yaw angles corresponding to Q/E 90-degree rotations around the island
    const yaws = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
    const radius = 18;
    const camY = 14;

    for (const yaw of yaws) {
      camera.position.set(
        upperTarget.x + Math.cos(yaw) * radius,
        camY,
        upperTarget.z + Math.sin(yaw) * radius,
      );
      camera.lookAt(upperTarget);
      camera.updateMatrixWorld();

      // Ground tile hit at this angle would be far behind t3Frost; ray picking must hit t3Frost directly.
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const picked = pickTowerByRay(raycaster.ray, [t3Frost]);
      expect(picked?.id).toBe(7);
    }
  });

  it('chooses the nearest tower along the ray when two towers overlap in view', () => {
    const front = makeTower(1, 'archer', 1, 2, 2);
    const back = makeTower(2, 'frost', 3, 0, 0);
    const towers = [back, front];

    const rayToFront = new THREE.Ray(
      new THREE.Vector3(6, 4, 6),
      new THREE.Vector3(-4, -3.5, -4).normalize(),
    );
    expect(pickTowerByRay(rayToFront, towers)?.id).toBe(1);

    // Ray aiming high over front's roof into back's tall T3 spire hits back
    const rayOverFrontToBackTop = new THREE.Ray(
      new THREE.Vector3(6, 4.4, 6),
      new THREE.Vector3(0 - 6, 2.5 - 4.4, 0 - 6).normalize(),
    );
    expect(pickTowerByRay(rayOverFrontToBackTop, towers)?.id).toBe(2);
  });

  it('returns null when clicking open ground outside the tower bounds', () => {
    const t1 = makeTower(3, 'cannon', 1, 0, 0);
    const bounds = getTowerPickBounds('cannon', 1);
    const missRay = new THREE.Ray(
      new THREE.Vector3(bounds.halfWidth + 0.5, 5, 0),
      new THREE.Vector3(0, -1, 0),
    );
    expect(pickTowerByRay(missRay, [t1])).toBeNull();
  });
});
