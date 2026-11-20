import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { CHAPTER_ENEMY_DEFS } from '../../src/data/enemies.ts';
import { I15 } from '../../src/data/levels2d/i15.ts';
import type { EnemyArtRuntime } from '../../src/render2d/assets2d.ts';
import { createExtras, createSpecialAnim, EnemySpecials, KilnbackShell, type SpecialState } from '../../src/render2d/enemySpecials.ts';
import type { ProcTextures } from '../../src/render2d/procTextures.ts';
import { SimWorld } from '../../src/sim/world.ts';

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
    expect(firstY).toBeLessThan(layout.cy - layout.heightPx * 0.5 - 6);
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

  it('keeps each shell’s damage on its own painted plate through turns and armor recovery', () => {
    const shell = new KilnbackShell();
    const body = new Sprite(Texture.WHITE);
    shell.addChild(body);
    shell.sortChildren();
    const mark = shell.children[1];
    expect(mark).toBeInstanceOf(Graphics);
    if (!(mark instanceof Graphics)) throw new Error('missing Kilnback fissures');
    body.anchor.set(0.5, 0.95);
    body.position.set(80, 90);
    shell.pose(body, 8, 11, false);
    expect(mark.visible).toBe(true);
    const chip = mark.context;
    const frontPivot = mark.pivot.y;
    body.scale.set(-0.7, 0.8);
    body.rotation = 0.12;
    body.alpha = 0.4;
    shell.pose(body, 2, 11, true);
    const split = mark.context;
    expect(split).not.toBe(chip);
    expect(mark.pivot.y).toBeLessThan(frontPivot);
    expect(mark.position.equals(body.position)).toBe(true);
    expect(mark.scale.equals(body.scale)).toBe(true);
    expect(mark.rotation).toBe(body.rotation);
    expect(mark.alpha).toBe(body.alpha);
    shell.pose(body, 0, 11, true);
    expect(mark.context).not.toBe(split);
    shell.pose(body, 11, 11, true);
    expect(mark.visible).toBe(false);
    shell.pose(body, 11, 14, false);
    expect(mark.visible).toBe(true);
    expect(mark.context).toBe(chip);
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

  it('shows the remaining draft bonus through a leader change and the entire coast under frost', () => {
    const { draw, ex } = scene('draftwing');
    const sim = new SimWorld(I15, new EventBus()).enemySystem;
    const { coastSec, speedBonus } = CHAPTER_ENEMY_DEFS.draftwing.ability;
    const dt = BALANCE.fixedDt;
    const step = () => sim.update(dt, () => {}, () => {});
    const rear = sim.spawnEnemy('draftwing')!;
    const middle = sim.spawnEnemy('draftwing')!;
    const front = sim.spawnEnemy('draftwing')!;
    middle.dist = 1.2;
    front.dist = 2.4;
    sim.applySlow(rear, 0.4, coastSec + 1);
    step();
    draw(rear);
    const wake = ex.wake!;
    expect(wake.visible).toBe(true);
    const fullAlpha = wake.alpha;
    expect(fullAlpha).toBeGreaterThan(0);

    sim.applyDamage(front, front.hp, true);
    step();
    draw(rear);
    expect(rear.abilityTimer).toBe(coastSec);
    expect(wake.alpha).toBe(fullAlpha);
    sim.applyDamage(middle, middle.hp, true);

    const coastTicks = Math.round(coastSec / dt);
    const cruise = rear.speed * (1 - rear.slowRatio);
    for (let i = 1; i <= coastTicks; i++) {
      const shownBonus = speedBonus * wake.alpha / fullAlpha;
      const start = rear.dist;
      step();
      expect((rear.dist - start) / dt).toBeCloseTo(cruise * (1 + shownBonus), 8);
      draw(rear);
      expect(wake.visible).toBe(i < coastTicks);
      if (wake.visible) expect(wake.alpha / fullAlpha).toBeCloseTo(1 - i / coastTicks, 8);
    }
    const start = rear.dist;
    step();
    expect((rear.dist - start) / dt).toBeCloseTo(cruise, 8);
  });
});
