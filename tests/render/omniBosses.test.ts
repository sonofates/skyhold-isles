import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sheetClip } from '../../src/render2d/meleeAnim.ts';
import { parseManifest, parseSheetJson } from '../../src/render2d/manifest.ts';
import { ENEMY_MELEE } from '../../src/data/soldiers.ts';

/**
 * The two chapter bosses animate from Omni video sheets (tools/sprites/omni_bosses.py,
 * docs/handoff-omni-bosses.md) instead of the 6-frame painted strips.
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
// fill the frame like the painted strips did (their median fill) for the boss to keep its size.
const BOSSES = [
  { id: 'glacier_warden', height: 3.36, fill: { down: 0.804, up: 0.821 } },
  { id: 'eclipse_sovereign', height: 3.34, fill: { down: 0.875, up: 0.842 } },
] as const;

describe('Omni boss sheets', () => {
  it.each(BOSSES)('$id: manifest wires down/up walk, attack and death; no side strip; size kept', ({ id, height }) => {
    const art = M.enemies[id];
    expect(art.mode).toBe('sheet');
    expect(art.height).toBe(height);
    expect(art.sheet).toMatchObject({ down: `anim/${id}-walk-down.json`, up: `anim/${id}-walk-up.json`, facing: 'right', facingUp: 'right' });
    expect(art.sheet?.side).toBeUndefined();
    expect(art.sheet?.stride).toBeGreaterThan(1);
    expect(art.attack).toBe(`anim/${id}-attack.json`);
    expect(art.death).toBe(`anim/${id}-death.json`);
    expect(existsSync(resolve(ART, `anim/${id}-walk-side.json`))).toBe(false);
  });

  it.each(BOSSES)('$id: walk loops are video-smooth and fill the frame like the old strips', ({ id, fill }) => {
    for (const dir of ['down', 'up'] as const) {
      const { raw, parsed } = sheet(`anim/${id}-walk-${dir}.json`);
      expect(parsed.frames.length, dir).toBeGreaterThanOrEqual(14);
      expect(parsed.fps).toBe(12);
      expect(parsed.anchor![1]).toBeGreaterThan(0.95); // feet at the bottom of the frame
      expect((raw.figureH as number) / (raw.frameH as number), dir).toBeCloseTo(fill[dir], 1);
    }
  });

  it.each(BOSSES)('$id: attack has a contact frame and one swing fits the blow interval', ({ id }) => {
    const { parsed } = sheet(`anim/${id}-attack.json`);
    expect(parsed.frames.length).toBeGreaterThanOrEqual(12);
    expect(parsed.impact).not.toBeNull();
    const clip = sheetClip({ count: parsed.frames.length, fps: parsed.fps, impact: parsed.impact });
    expect(clip.lead).toBeGreaterThan(0.3);
    expect(clip.dur).toBeLessThanOrEqual(1 / ENEMY_MELEE[id].rate + 1e-9);
  });

  it.each(BOSSES)('$id: death is a one-shot at the walk sheet px scale', ({ id }) => {
    const { raw, parsed } = sheet(`anim/${id}-death.json`);
    const walk = JSON.parse(readFileSync(resolve(ART, `anim/${id}-walk-down.json`), 'utf8')) as Record<string, number>;
    expect(parsed.frames.length).toBeGreaterThanOrEqual(20);
    expect(parsed.anchor).not.toBeNull();
    // playDeath draws the clip with the walk sprite's scale: frame heights in the same px units.
    expect(raw.frameH as number).toBeLessThanOrEqual(walk.frameH * 1.1);
    expect(raw.frameH as number).toBeGreaterThanOrEqual(walk.frameH * 0.8);
  });
});
