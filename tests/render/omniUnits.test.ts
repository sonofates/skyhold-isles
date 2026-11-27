import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sheetClip } from '../../src/render2d/meleeAnim.ts';
import { parseManifest, parseSheetJson } from '../../src/render2d/manifest.ts';
import { ENEMY_MELEE } from '../../src/data/soldiers.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';

/**
 * The five chapter-4/5 regular foes animate from Omni video sheets (tools/sprites/omni_units.py,
 * docs/handoff-omni-units.md) instead of the 6-frame painted strips, like the bosses
 * (omniBosses.test.ts) and the first 15 foes.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const ART = resolve(ROOT, 'public/art2d');
const M = parseManifest(JSON.parse(readFileSync(resolve(ART, 'manifest.json'), 'utf8')) as Record<string, unknown>);

/** Canvas size of a WebP file (VP8X extended header, which every alpha WebP has). */
function webpSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  expect(b.toString('ascii', 0, 4)).toBe('RIFF');
  expect(b.toString('ascii', 8, 12)).toBe('WEBP');
  expect(b.toString('ascii', 12, 16)).toBe('VP8X');
  const u24 = (o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  return { w: u24(24) + 1, h: u24(27) + 1 };
}

function sheet(p: string): { raw: Record<string, unknown>; parsed: ReturnType<typeof parseSheetJson> } {
  const raw = JSON.parse(readFileSync(resolve(ART, p), 'utf8')) as Record<string, unknown>;
  const parsed = parseSheetJson(raw, p.split('/').pop()!.replace('.json', '.webp'));
  // The grid fits the image exactly.
  const { w, h } = webpSize(resolve(ART, 'anim', parsed.image));
  const cols = raw.cols as number;
  expect(w, p).toBe(cols * (raw.frameW as number));
  expect(h, p).toBe(Math.ceil((raw.count as number) / cols) * (raw.frameH as number));
  return { raw, parsed };
}

// In-game size: the renderer maps walk frameH × 0.94 to the manifest height, so the figure must
// fill the frame like the painted strips did (their median fill) for the foe to keep its size.
const UNITS = [
  { id: 'rimebeetle', height: 1.45, fill: { down: 0.848, up: 0.837 } },
  { id: 'sledguard', height: 1.42, fill: { down: 0.88, up: 0.832 } },
  { id: 'duskhound', height: 1.57, fill: { down: 0.853, up: 0.902 } },
  { id: 'veilcaster', height: 1.45, fill: { down: 0.837, up: 0.842 } },
  { id: 'eclipse_shade', height: 2.13, fill: { down: 0.848, up: 0.821 } },
] as const;

describe('Omni sheets of the chapter-4/5 regular foes', () => {
  it.each(UNITS)('$id: manifest wires down/up walk, attack and death; no side strip; size kept', ({ id, height }) => {
    const art = M.enemies[id];
    expect(art.mode).toBe('sheet');
    expect(art.height).toBe(height);
    expect(art.anchor).toEqual([0.5, 0.9565]);
    expect(art.sheet).toMatchObject({ down: `anim/${id}-walk-down.json`, up: `anim/${id}-walk-up.json`, facing: 'right', facingUp: 'right' });
    expect(art.sheet?.side).toBeUndefined();
    expect(art.attack).toBe(`anim/${id}-attack.json`);
    expect(art.death).toBe(`anim/${id}-death.json`);
    expect(existsSync(resolve(ART, `anim/${id}-walk-side.json`))).toBe(false);
    expect(existsSync(resolve(ART, `anim/${id}-walk-side.webp`))).toBe(false);
  });

  it.each(UNITS)('$id: walk loops are video-smooth and fill the frame like the old strips', ({ id, fill }) => {
    for (const dir of ['down', 'up'] as const) {
      const { raw, parsed } = sheet(`anim/${id}-walk-${dir}.json`);
      expect(parsed.frames.length, dir).toBeGreaterThanOrEqual(10);
      expect(parsed.fps).toBe(12);
      expect(parsed.anchor![1]).toBeGreaterThan(0.95); // feet at the bottom of the frame
      expect(Math.abs((raw.figureH as number) / (raw.frameH as number) - fill[dir]), dir).toBeLessThanOrEqual(0.05);
    }
  });

  it.each(UNITS)('$id: stride plants the feet (the loop plays at about its filmed rate at sim speed)', ({ id }) => {
    const stride = M.enemies[id].sheet!.stride!;
    const speed = ENEMY_DEFS[id].speed;
    for (const dir of ['down', 'up'] as const) {
      const { parsed } = sheet(`anim/${id}-walk-${dir}.json`);
      const filmed = parsed.frames.length / parsed.fps; // seconds per loop
      const played = stride / speed;
      expect(played / filmed, dir).toBeGreaterThan(0.8);
      expect(played / filmed, dir).toBeLessThan(1.25);
    }
  });

  it.each(UNITS)('$id: attack has a contact frame and one blow fits the blow interval', ({ id }) => {
    const { parsed } = sheet(`anim/${id}-attack.json`);
    expect(parsed.frames.length).toBeGreaterThanOrEqual(10);
    expect(parsed.impact).not.toBeNull();
    const clip = sheetClip({ count: parsed.frames.length, fps: parsed.fps, impact: parsed.impact });
    expect(clip.lead).toBeGreaterThan(0.3);
    expect(clip.dur).toBeLessThanOrEqual(1 / ENEMY_MELEE[id].rate + 1e-9);
  });

  it.each(UNITS)('$id: death is a one-shot at the walk sheet px scale', ({ id }) => {
    const { raw, parsed } = sheet(`anim/${id}-death.json`);
    const walk = JSON.parse(readFileSync(resolve(ART, `anim/${id}-walk-down.json`), 'utf8')) as Record<string, number>;
    expect(parsed.frames.length).toBeGreaterThanOrEqual(14);
    expect(parsed.frames.length / parsed.fps).toBeLessThanOrEqual(2);
    expect(parsed.anchor).not.toBeNull();
    // playDeath draws the clip with the walk sprite's scale: frame heights in the same px units
    // (the hound's howl flares its tail fire above the head, hence 1.2 rather than 1.1).
    expect(raw.frameH as number).toBeLessThanOrEqual(walk.frameH * 1.2);
    expect(raw.frameH as number).toBeGreaterThanOrEqual(walk.frameH * 0.7);
  });
});
