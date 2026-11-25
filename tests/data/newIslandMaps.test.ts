import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { getLevelById } from '../../src/data/levels2d/index.ts';
import { hardShapes } from '../../src/render2d/fullBleed.ts';
import { hudDock } from '../../src/render2d/hudDock.ts';
import { primaryWaveEntrance, waveEntranceCounts } from '../../src/render2d/lanePath.ts';
import { firstSpawnPointPx, phoneCameraFit } from '../../src/render2d/phoneCamera.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS } from '../../src/render2d/uiLayout.ts';
import { getMapLifeConfig } from '../../src/render2d/mapLifeLayer.ts';
import manifest from '../../public/art2d/manifest.json';
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseLevel2D } from '../../src/data/levels2d/loader.ts';
import i25 from '../../src/data/levels2d/i25.json';
import i26 from '../../src/data/levels2d/i26.json';
import i27 from '../../src/data/levels2d/i27.json';
import i28 from '../../src/data/levels2d/i28.json';
import i29 from '../../src/data/levels2d/i29.json';
import i30 from '../../src/data/levels2d/i30.json';
import i31 from '../../src/data/levels2d/i31.json';
import i32 from '../../src/data/levels2d/i32.json';
import i33 from '../../src/data/levels2d/i33.json';

it.each([i25, i26, i27, i28, i29, i30, i31, i32, i33])('$id ships each map variant, both gate depths and protected life masks', level => {
  const layout = parseLevel2D(level);
  const maps: Record<string, string> = manifest.maps;
  const fronts: Record<string, string> = manifest.overlays;
  for (const suffix of ['', '@1x', '@1.5x', '@3x']) {
    expect(existsSync('public/art2d/' + maps[layout.image + suffix])).toBe(true);
  }
  expect(layout.entrances).toHaveLength(level.id === 'i32' ? 1 : 2);
  expect(layout.gates).toHaveLength(layout.entrances.length + 1);
  for (const gate of layout.gates ?? []) {
    for (const suffix of ['', '@3x']) expect(existsSync('public/art2d/' + fronts[gate.front!.art + suffix])).toBe(true);
  }
  const config = getMapLifeConfig(level.id)!;
  const masks = [config.wind?.mask, config.water?.mask, config.heatHaze?.mask].filter((m): m is string => !!m);
  expect(masks.length).toBeGreaterThan(0);
  const [iw, ih] = layout.imageSize;
  for (const mask of masks) {
    const fixture = 'tests/fixtures/' + mask.slice('life/'.length, -'.webp'.length) + '-mask';
    const digest = createHash('sha256').update(readFileSync('public/art2d/' + mask)).digest('hex');
    expect(digest).toBe(JSON.parse(readFileSync(fixture + '.json', 'utf8')).sha256);
    const raw = gunzipSync(readFileSync(fixture + '.gray.gz'));
    const header = raw.indexOf(10);
    const [w, h] = raw.subarray(0, header).toString().split(' ').map(Number);
    const pixels = raw.subarray(header + 1);
    expect(pixels.length).toBe(w * h);
    expect(pixels.some(v => v > 128)).toBe(true);
    for (const { x, z } of [...layout.paths.flat(), ...layout.plots]) {
      const px = Math.round((iw / 2 + x * layout.pxPerUnit) * w / iw);
      const py = Math.round((ih / 2 + z * layout.pxPerUnit) * h / ih);
      expect(pixels[py * w + px]).toBe(0);
    }
  }
});

it.each(['i31', 'i32', 'i33'])('%s keeps roads, gates, keep and plots clear of the landscape phone HUD', id => {
  const level = getLevelById(id)!;
  const layout = level.layout2d!;
  const entrances = waveEntranceCounts(level.waves[0].groups, layout.paths, layout.flightPath, t => ENEMY_DEFS[t].flying);
  const spawn = firstSpawnPointPx(layout, primaryWaveEntrance(entrances)?.path);
  const shapes = hardShapes(layout);
  for (const [w, h] of [[844, 390], [932, 430]]) {
    for (const items of [0, 3]) {
      const { fit } = phoneCameraFit(w, h, layout, mode => hudDock(w, h, NO_INSETS, {
        plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152,
        hero: true, items, itemMode: mode,
      }), shapes, spawn);
      expect(fit.clear, `${w}×${h} with ${items} items`).toBe(true);
    }
  }
});
