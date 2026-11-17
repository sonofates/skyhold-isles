import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { EnemyRenderer } from '../../src/render/enemyMeshes.ts';
import type { MaterialLibrary } from '../../src/render/materials.ts';
import { SimWorld } from '../../src/sim/world.ts';

function stubMaterials(): MaterialLibrary {
  return {
    enemyInstancedMaterial: new THREE.MeshStandardMaterial(),
    hpBarMaterial: new THREE.MeshBasicMaterial(),
    shadowDecalMaterial: new THREE.MeshBasicMaterial(),
  } as unknown as MaterialLibrary;
}

function meshesByCount(renderer: EnemyRenderer): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  renderer.group.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
}

describe('EnemyRenderer with the new archetypes', () => {
  it('draws mounds for burrowed enemies, bubbles for shields, rings for elites (no body for burrowed)', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    const sys = world.enemySystem;
    const burrower = sys.spawnEnemy('burrower')!;
    const shielded = sys.spawnEnemy('grunt')!;
    sys.spawnEnemy('golem', 1, true);
    sys.spawnEnemy('carrier', 1, true);
    const blinker = sys.spawnEnemy('blinker')!;
    sys.spawnEnemy('tempest');
    sys.spawnEnemy('mite');
    sys.spawnEnemy('warden');
    const hexer = sys.spawnEnemy('hexer')!;
    hexer.hexTargetId = 3; // channelling a hex (magenta throb)
    burrower.burrowed = true;
    burrower.abilityTimer = 0.1; // inside the resurfacing telegraph window
    shielded.shield = 20;
    shielded.shieldMax = 30;
    shielded.hp = shielded.maxHp - 5; // HP bar visible
    blinker.abilityTimer = 0.2; // flicker telegraph

    const renderer = new EnemyRenderer(stubMaterials());
    const camera = new THREE.OrthographicCamera();
    renderer.update(world.enemyPool, 0.5, 1.25, camera);

    const all = meshesByCount(renderer);
    const visibleCounts = all.filter((m) => m.visible).map((m) => m.count);
    // 8 body layers (burrower hidden) + mound + bubble + ring + hp bar + shadows
    expect(all.length).toBeGreaterThanOrEqual(15 + 5);
    const total = visibleCounts.reduce((a, b) => a + b, 0);
    // bodies 8, mound 1, bubble 1, rings 2, hp bar 1, shadows 8
    expect(total).toBe(8 + 1 + 1 + 2 + 1 + 8);
    // The channelling hexer is tinted toward the hex glow (more red+blue than green).
    const layers = (renderer as unknown as { layers: Map<string, { mesh: THREE.InstancedMesh }> }).layers;
    const hexMesh = layers.get('hexer')!.mesh;
    expect(hexMesh.count).toBe(1);
    const c = new THREE.Color();
    hexMesh.getColorAt(0, c);
    expect(c.r).toBeGreaterThan(c.g + 0.15);
    expect(c.b).toBeGreaterThan(c.g + 0.15);
    for (const m of all) {
      for (let i = 0; i < m.count; i++) {
        const mat = new THREE.Matrix4();
        m.getMatrixAt(i, mat);
        expect(mat.elements.every((v) => Number.isFinite(v))).toBe(true);
      }
    }

    renderer.clear();
    expect(meshesByCount(renderer).every((m) => !m.visible && m.count === 0)).toBe(true);
    renderer.dispose();
  });
});
