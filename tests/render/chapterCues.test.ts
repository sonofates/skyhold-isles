import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { CHAPTER_ENEMY_DEFS } from '../../src/data/enemies.ts';
import type { EnemyArtRuntime } from '../../src/render2d/assets2d.ts';
import { createExtras, createSpecialAnim, EnemySpecials, type SpecialState } from '../../src/render2d/enemySpecials.ts';
import type { ProcTextures } from '../../src/render2d/procTextures.ts';

function scene(type: 'reedpiper' | 'draftwing') {
  const parents = { ground: new Container(), overlays: new Container(), actors: new Container(), bars: new Container() };
  const tex = { wring: Texture.WHITE, crown: Texture.WHITE, orb: Texture.WHITE } as ProcTextures;
  const specials = new EnemySpecials(parents, tex, null);
  const ex = createExtras();
  const anim = createSpecialAnim();
  const layout = { px: 100, py: 120, cy: 72, heightPx: 64, shadowR: 12, uiScale: 1, pxPerUnit: 45, facing: 1 };
  const state: SpecialState = { type, flying: type === 'draftwing', burrowed: false, hitFlashTimer: 0 };
  function draw(patch: Partial<SpecialState>) {
    const out = { tint: 0xffffff, bodyAlpha: 1, shadowAlpha: 1, bodyVisible: true, squashY: 1 };
    specials.apply(ex, anim, {} as EnemyArtRuntime, { ...state, ...patch }, layout, 0, out);
  }
  return { draw, ex, layout, parents, specials };
}

describe('chapter enemy cues', () => {
  it('marks the ground cleanse radius throughout a phrase and clears both cues on interruption', () => {
    const { draw, ex, layout, parents, specials } = scene('reedpiper');
    const { radius, channelSec } = CHAPTER_ENEMY_DEFS.reedpiper.ability;
    draw({ channelTimer: channelSec, elite: true });
    const radiusPx = radius * layout.pxPerUnit;
    const ring = ex.refrain!;
    const note = ex.note!;
    expect(ring.parent).toBe(parents.ground);
    expect(ring.position.x).toBe(layout.px);
    expect(ring.position.y).toBe(layout.py);
    expect(ring.scale.x * 100).toBeCloseTo(radiusPx);
    expect(ring.scale.y).toBe(ring.scale.x);
    expect(note.parent).toBe(parents.overlays);
    expect(ex.crown?.visible).toBe(true);
    const firstY = note.y;
    draw({ channelTimer: 0.1, elite: true });
    expect(note.y).toBeLessThan(firstY);
    expect(ring.scale.x * 100).toBeCloseTo(radiusPx);
    draw({ channelTimer: 0, elite: true });
    expect(note.visible).toBe(false);
    expect(ring.visible).toBe(false);
    expect(ex.crown?.visible).toBe(true);
    const count = specials.extrasCreated;
    layout.facing = -1;
    draw({ channelTimer: channelSec });
    expect(note.x).toBeLessThan(layout.px);
    expect(note.visible).toBe(true);
    expect(specials.extrasCreated).toBe(count);
  });

  it('keeps the wake behind a moth through turns and fades it during coasting', () => {
    const { draw, ex, layout, specials } = scene('draftwing');
    const { coastSec } = CHAPTER_ENEMY_DEFS.draftwing.ability;
    draw({ abilityTimer: 0 });
    expect(ex.wake).toBeNull();
    draw({ abilityTimer: coastSec, yaw: Math.PI / 2 });
    const wake = ex.wake!;
    const fullAlpha = wake.alpha;
    const fullLength = wake.scale.x;
    expect(wake.rotation).toBeCloseTo(0);
    expect(wake.zIndex).toBeLessThan(layout.py);
    draw({ abilityTimer: coastSec / 2, yaw: 0 });
    expect(wake.rotation).toBeCloseTo(Math.PI / 2);
    expect(wake.scale.x).toBeLessThan(fullLength);
    expect(wake.alpha).toBeCloseTo(fullAlpha * 0.5);
    draw({ abilityTimer: 0 });
    expect(wake.visible).toBe(false);
    draw({ abilityTimer: coastSec });
    expect(ex.wake).toBe(wake);
    specials.hideAll(ex);
    expect(wake.visible).toBe(false);
  });
});
