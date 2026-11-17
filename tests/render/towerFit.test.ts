import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManifestError, parseManifest, parseSheetJson } from '../../src/render2d/manifest.ts';
import { attackFrame, attackPlan, CATCH_UP, idleFrame, onShot, PREROLL_GRACE, prerollStart, projectileReveal, shotEta, shouldPreroll } from '../../src/render2d/towerAnim.ts';
import { drawnRing, fitOnRing, measureRing, plotRing, plotSpriteRect, ringMuzzle, type RingSpec } from '../../src/render2d/towerFit.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const RAW = JSON.parse(readFileSync(resolve(ROOT, 'public/art2d/manifest.json'), 'utf8')) as Record<string, unknown>;
const M = parseManifest(RAW);

/** RGBA buffer with opaque filled ellipses / rects (alpha only matters). */
function canvas(w: number, h: number): { data: Uint8ClampedArray; ellipse: (cx: number, cy: number, rx: number, ry: number) => void; rect: (x0: number, y0: number, x1: number, y1: number) => void } {
  const data = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < w && y < h) data[(y * w + x) * 4 + 3] = 255;
  };
  return {
    data,
    ellipse: (cx, cy, rx, ry) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) set(x, y);
    },
    rect: (x0, y0, x1, y1) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y);
    },
  };
}

describe('ring measurement (sprites whose top is wider than the ring)', () => {
  it('measures the ring, not the overall sprite width', () => {
    // 400 x 500: a 200 px ring at the bottom, a narrow body, and a 380 px wide crossbar on top
    // (ballista arms / mortar barrel / banner). Scaling by the sprite width would shrink it ~1.9x.
    const W = 400;
    const H = 500;
    const c = canvas(W, H);
    c.ellipse(210, 500 - 67, 100, 67); // ring: 200 wide, bottom at 500, centre x 210 (off-centre on purpose)
    c.rect(170, 120, 250, 440); // body
    c.rect(10, 120, 390, 150); // wide arms on top
    const ring = measureRing(c.data, W, H)!;
    expect(ring.ringWidthPx).toBeGreaterThanOrEqual(198);
    expect(ring.ringWidthPx).toBeLessThanOrEqual(201);
    expect(ring.ringBottomPx).toBe(500);
    expect(ring.ringCenterXPx).toBeCloseTo(210, 0);
    // Fitting it on a 96 px plot ring: the ring ends up 96 px wide, the arms overhang (as drawn).
    const fit = fitOnRing({ cx: 100, bottom: 200, width: 96 }, ring, W, H);
    expect(ring.ringWidthPx * fit.scale).toBeCloseTo(96, 6);
    expect(380 * fit.scale).toBeGreaterThan(96 * 1.8);
  });

  it('finds the full width of a tall (thick) ring the bottom 22 % alone would under-measure', () => {
    const W = 500;
    const H = 512;
    const c = canvas(W, H);
    c.ellipse(250, 512 - 160, 245, 160); // ring height 320 = 62 % of the sprite: equator above the bottom 22 %
    c.rect(200, 0, 300, 360);
    const ring = measureRing(c.data, W, H)!;
    expect(ring.ringWidthPx).toBeGreaterThanOrEqual(488);
  });

  it('returns null for an empty image', () => {
    expect(measureRing(new Uint8ClampedArray(16 * 16 * 4), 16, 16)).toBeNull();
  });
});

describe('fit rule: towers stand exactly on their plot', () => {
  const plot = M.plot!;
  const PLOT_TEX: [number, number] = [512, 343];

  it('every tower ships an attack sheet or an aimable turret per tier, and each sheet JSON carries its ring', () => {
    for (const [type, art] of Object.entries(M.towers)) {
      art!.attack.forEach((p, i) => {
        if (art!.turret[i]) {
          // Directional towers aim a turret instead of playing a baked attack video.
          expect(p, `${type} T${i + 1}: turret towers carry no attack sheet`).toBeNull();
          return;
        }
        expect(p, `${type} T${i + 1}`).not.toBeNull();
        const raw = JSON.parse(readFileSync(resolve(ROOT, 'public/art2d', p!), 'utf8')) as Record<string, unknown>;
        const sheet = parseSheetJson(raw, 'x.png');
        expect(sheet.ringW, `${p} ringW`).toBeGreaterThan(60);
        expect(sheet.release).toBe(3);
        expect(sheet.anchor![1]).toBeLessThanOrEqual(1);
        expect(existsSync(resolve(ROOT, 'public/art2d', p!.replace(/[^/]+$/, sheet.image)))).toBe(true);
      });
    }
  });

  it('the manifest carries the plot sprite and its ring', () => {
    expect(plot.file).toBe('plot-base.webp');
    expect(plot.ring).not.toBeNull();
    expect(existsSync(resolve(ROOT, 'public/art2d', plot.file))).toBe(true);
  });

  it('plot sprite: 2 * plotRadiusPx wide, centred on the plot point, aspect kept', () => {
    const r = plotSpriteRect(500, 300, 48, ...PLOT_TEX);
    expect(r).toEqual({ x: 452, y: 300 - (96 * 343) / 512 / 2, w: 96, h: (96 * 343) / 512 });
    const ring = plotRing(r, ...PLOT_TEX, plot.ring);
    expect(ring.width).toBeCloseTo((96 * plot.ring!.ringWidthPx) / 512, 9);
    expect(ring.cx).toBeCloseTo(500, 6);
    expect(ring.bottom).toBeGreaterThan(300);
    expect(ring.bottom).toBeLessThanOrEqual(r.y + r.h);
  });

  it('every shipped ring-convention tier lands its ring on the plot ring (same width, same bottom-centre)', () => {
    const target = plotRing(plotSpriteRect(700, 400, 48, ...PLOT_TEX), ...PLOT_TEX, plot.ring);
    let checked = 0;
    for (const [type, art] of Object.entries(M.towers)) {
      art!.ring.forEach((ring, i) => {
        expect(ring, `${type} T${i + 1} has a ring measurement`).not.toBeNull();
        if (!ring || ring === 'auto') return;
        // Texture sizes do not change the fit (anchor is normalised, scale uses ring px).
        for (const [tw, th] of [[300, 512], [512, 512]] as const) {
          const fit = fitOnRing(target, ring, tw, th, art!.ringScale);
          const drawn = drawnRing(fit, ring);
          expect(Math.abs(drawn.cx - target.cx)).toBeLessThan(1e-9);
          expect(Math.abs(drawn.bottom - target.bottom)).toBeLessThan(1e-9);
          expect(Math.abs(drawn.width - target.width)).toBeLessThan(1e-9);
          // The anchor point (ring bottom-centre in texture px) maps onto the target.
          expect(fit.anchorX * tw).toBeCloseTo(ring.ringCenterXPx, 9);
          expect(fit.anchorY * th).toBeCloseTo(ring.ringBottomPx, 9);
        }
        checked++;
      });
    }
    expect(checked).toBe(24); // 8 towers x 3 tiers, all on the shared ring
  });

  it('per-tower ringScale tweaks the width only', () => {
    const ring: RingSpec = { ringWidthPx: 300, ringBottomPx: 500, ringCenterXPx: 150 };
    const a = fitOnRing({ cx: 10, bottom: 20, width: 90 }, ring, 300, 512, 1);
    const b = fitOnRing({ cx: 10, bottom: 20, width: 90 }, ring, 300, 512, 1.05);
    expect(b.scale / a.scale).toBeCloseTo(1.05, 9);
    expect([b.x, b.y, b.anchorX, b.anchorY]).toEqual([a.x, a.y, a.anchorX, a.anchorY]);
  });

  it('muzzle height grows with the drawn height and the muzzle fraction', () => {
    const ring: RingSpec = { ringWidthPx: 300, ringBottomPx: 500, ringCenterXPx: 150 };
    const fit = fitOnRing({ cx: 0, bottom: 31, width: 94 }, ring, 300, 512);
    const lo = ringMuzzle(fit, ring, 0, 0.5, 45);
    const hi = ringMuzzle(fit, ring, 0, 0.9, 45);
    expect(hi).toBeGreaterThan(lo);
    // 0.9 of a ~157 px tall tower, minus the 31 px the ring bottom sits below the plot centre.
    expect(hi).toBeCloseTo((500 * fit.scale * 0.9 - 31) / 45, 9);
  });
});

describe('manifest: rings, attack / idle sheets', () => {
  it('parses per-tier rings, attack and idle paths (string = every tier)', () => {
    const raw = JSON.parse(JSON.stringify(RAW)) as { towers: Record<string, Record<string, unknown>> };
    raw.towers.archer.attack = ['anim/tower-archer-t1-attack.json', null, 'anim/tower-archer-t3-attack.json'];
    raw.towers.archer.idle = 'anim/tower-archer-idle.json';
    raw.towers.cannon.ring = ['auto', null];
    delete raw.towers.frost.attack;
    const m = parseManifest(raw);
    expect(m.towers.archer?.attack).toEqual(['anim/tower-archer-t1-attack.json', null, 'anim/tower-archer-t3-attack.json']);
    expect(m.towers.archer?.idle).toEqual(Array(3).fill('anim/tower-archer-idle.json'));
    expect(m.towers.cannon?.ring).toEqual(['auto', null, null]);
    expect(m.towers.frost?.attack).toEqual([null, null, null]);
  });

  it('rejects a broken ring', () => {
    const raw = JSON.parse(JSON.stringify(RAW)) as { towers: Record<string, Record<string, unknown>> };
    raw.towers.archer.ring = [{ ringWidthPx: 0, ringBottomPx: 1, ringCenterXPx: 1 }];
    expect(() => parseManifest(raw)).toThrow(ManifestError);
  });

  it('parses tower sheet extras: release frame (clamped) and ring width', () => {
    const s = parseSheetJson({ frameW: 256, frameH: 320, count: 12, cols: 4, fps: 12, anchor: [128, 312], ringW: 180, release: 5, image: 'a.png' });
    expect(s.release).toBe(5);
    expect(s.ringW).toBe(180);
    expect(s.anchor![1]).toBeCloseTo(312 / 320, 9);
    expect(parseSheetJson({ frameW: 8, frameH: 8, count: 4, fps: 12, release: 99 }, 'b.png').release).toBe(3);
    expect(parseSheetJson({ frameW: 8, frameH: 8, count: 4, fps: 12 }, 'b.png').release).toBeNull();
  });
});

describe('attack animation timing (render-only)', () => {
  it('no release frame: plays from frame 0, shot shows at once', () => {
    const t = { count: 10, fps: 12, release: null };
    const p = attackPlan(t);
    expect(p).toEqual({ startFrame: 0, releaseDelay: 0, duration: 10 / 12 });
    expect(attackFrame(p, t, 0)).toBe(0);
    expect(attackFrame(p, t, 0.5)).toBe(6);
    expect(attackFrame(p, t, 10 / 12)).toBeNull();
    expect(projectileReveal(0, p.releaseDelay)).toBe(1);
  });

  it('an early release keeps the whole wind-up', () => {
    const t = { count: 12, fps: 12, release: 1 };
    const p = attackPlan(t);
    expect(p.startFrame).toBe(0);
    expect(p.releaseDelay).toBeCloseTo(1 / 12, 9);
  });

  it('plays from frame 0 by default (shipped sheets: release frame 3 at 12 fps = 0.25 s)', () => {
    const t = { count: 27, fps: 12, release: 3 };
    const p = attackPlan(t);
    expect(p.startFrame).toBe(0);
    expect(p.releaseDelay).toBeCloseTo(0.25, 9);
    expect(attackFrame(p, t, p.releaseDelay)).toBe(3);
    expect(attackFrame(p, t, p.duration - 1e-6)).toBe(26);
  });

  it('an optional lead cap clips the wind-up', () => {
    const t = { count: 16, fps: 12, release: 9 };
    const p = attackPlan(t, 0.15);
    expect(p.releaseDelay).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(p.startFrame).toBe(9 - Math.floor(0.15 * 12));
    expect(attackFrame(p, t, p.releaseDelay)).toBe(9);
  });

  it('pre-roll: starts when the coming shot is within the release delay, once per shot', () => {
    const base = { hasTarget: true, releaseDelay: 0.25, armed: false };
    expect(shouldPreroll({ ...base, eta: 0.3 })).toBe(false);
    expect(shouldPreroll({ ...base, eta: 0.25 })).toBe(true);
    expect(shouldPreroll({ ...base, eta: 0.1, armed: true })).toBe(false);
    expect(shouldPreroll({ ...base, eta: 0.1, hasTarget: false })).toBe(false);
    expect(shouldPreroll({ ...base, eta: 0, releaseDelay: 0 })).toBe(false);
    // Cooldown drains at the observed rate (beacon buffs, global modifiers).
    expect(shotEta(0.5, 2)).toBeCloseTo(0.25, 9);
    expect(shotEta(0, 1)).toBe(0);
    expect(shotEta(0.5, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('pre-roll start is never negative (a negative time would freeze the sheet until the shot)', () => {
    // First qualifying frame: eta just under the release delay, less than one frame of lead.
    expect(prerollStart(0.25, 0.24, 1 / 60)).toBe(0);
    expect(prerollStart(0.25, 0.1, 1 / 60)).toBeCloseTo(0.15 - 1 / 60, 9);
    expect(prerollStart(0.25, 0, 1 / 60)).toBeCloseTo(0.25 - 1 / 60, 9);
    // After the same-frame advance the release lands on the shot (or at most one frame early).
    const dt = 1 / 60;
    for (const eta of [0.249, 0.2, 0.12, 0.05, 0.001]) {
      const atShot = prerollStart(0.25, eta, dt) + dt + eta;
      expect(atShot).toBeGreaterThanOrEqual(0.25 - 1e-9);
      expect(atShot).toBeLessThanOrEqual(0.25 + dt + 1e-9);
    }
  });

  it('shot: a pre-rolled sheet keeps playing (release on the shot); otherwise it restarts from frame 0', () => {
    expect(onShot(true, 0.25, 0.25)).toEqual({ elapsed: 0.25, shotDelay: 0 });
    expect(onShot(true, 0.2, 0.25).shotDelay).toBeCloseTo(0.05, 9);
    expect(onShot(false, 0.6, 0.25)).toEqual({ elapsed: 0, shotDelay: 0.25 });
    // A stale pre-roll (shot never came) does not count.
    expect(onShot(true, 0.25 + PREROLL_GRACE + 0.01, 0.25)).toEqual({ elapsed: 0, shotDelay: 0.25 });
  });

  it('projectile: hidden until the release, then catches up with the sim', () => {
    expect(projectileReveal(0.05, 0.1)).toBe(-1);
    expect(projectileReveal(0.1, 0.1)).toBe(0);
    expect(projectileReveal(0.1 + CATCH_UP / 2, 0.1)).toBeCloseTo(0.5, 9);
    expect(projectileReveal(0.1 + CATCH_UP * 3, 0.1)).toBe(1);
  });

  it('idle loops', () => {
    expect(idleFrame(8, 10, 0)).toBe(0);
    expect(idleFrame(8, 10, 0.95)).toBe(1);
    expect(idleFrame(8, 10, 1.25)).toBe(4);
  });
});
