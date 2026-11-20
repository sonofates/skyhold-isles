import { Texture } from 'pixi.js';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { I19 } from '../../src/data/levels2d/i19.ts';
import type { EnemyArtRuntime, LoadedArt } from '../../src/render2d/assets2d.ts';
import { EnemyLayer } from '../../src/render2d/enemyLayer.ts';
import { WorldLayers } from '../../src/render2d/layers.ts';
import { parseManifest } from '../../src/render2d/manifest.ts';
import { MapView } from '../../src/render2d/mapView.ts';
import type { ProcTextures } from '../../src/render2d/procTextures.ts';
import { createEnemyEntity } from '../../src/sim/entities.ts';

it('keeps a dropped raider on its road through touchdown, pause and pool reuse', () => {
  const manifest = parseManifest(JSON.parse(readFileSync('public/art2d/manifest.json', 'utf8')));
  const key = manifest.enemyMap.grunt.art;
  const raider = {
    key, spec: manifest.enemies[key], mode: 'cheap', base: Texture.WHITE, frames: [Texture.WHITE],
    frameAnchors: [], back: null, tintMul: 0xffffff, scaleMul: 1,
  } as EnemyArtRuntime;
  const map = new MapView(Texture.WHITE, I19.layout2d);
  const layers = new WorldLayers(map.world);
  const art = { manifest, enemies: { [key]: raider } } as LoadedArt;
  const layer = new EnemyLayer(art, map, layers, { shadow: Texture.WHITE } as ProcTextures);
  const enemy = { ...createEnemyEntity(0), uid: 10, x: 3, prevX: 3, z: -2, prevZ: -2, isDropped: true };
  const draw = (dt: number) => layer.drawWalker(0, enemy, 1, dt, null);

  draw(1 / 60);
  const body = layers.actors.children[0];
  const shadow = layers.shadows.children[0];
  expect(body.x).toBeCloseTo(map.pxX(enemy.x));
  expect(body.y).toBeCloseTo(map.pxY(enemy.z));
  expect(shadow.position.equals(body.position)).toBe(true);
  const contact = body.scale.y;
  draw(0);
  expect(body.scale.y).toBe(contact);
  draw(0.12);
  const recovering = body.scale.y;
  expect(recovering).toBeGreaterThan(contact);
  expect(body.y).toBe(shadow.y);
  draw(0.12);
  const upright = body.scale.y;
  expect(upright).toBeGreaterThan(recovering);
  expect(body.y).toBe(shadow.y);

  enemy.uid++;
  draw(0);
  expect(body.scale.y).toBe(contact);
  enemy.uid++;
  enemy.isDropped = false;
  draw(0);
  expect(body.scale.y).toBe(upright);
});
