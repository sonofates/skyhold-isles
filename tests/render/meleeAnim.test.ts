import { describe, expect, it } from 'vitest';
import {
  advanceSwing,
  assignSides,
  announceSwing,
  cancelSwing,
  createSwing,
  createSwingPose,
  faceToward,
  fightGap,
  gangSlots,
  impactSwing,
  knockCurve,
  MAX_WINDUP_SPEED,
  PROC_CLIP,
  sheetClip,
  swingFrame,
  swingPose,
  type SwingState,
} from '../../src/render2d/meleeAnim.ts';

const DT = 1 / 60;

/** Advance until `sec` sim seconds have passed; returns the sheet time then. */
function run(s: SwingState, sec: number): number {
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) advanceSwing(s, DT);
  return s.t;
}

describe('melee swing timing', () => {
  it('sheet clip: lead = impact / fps, duration = count / fps, impact clamped / defaulted', () => {
    expect(sheetClip({ count: 28, fps: 12, impact: 4 })).toEqual({ lead: 4 / 12, dur: 28 / 12 });
    expect(sheetClip({ count: 8, fps: 12, impact: 99 }).lead).toBeCloseTo(7 / 12);
    expect(sheetClip({ count: 8, fps: 0, impact: null }).lead).toBeCloseTo(4 / 12);
  });

  it('pre-rolls: a blow announced 1 s ahead reaches the impact frame exactly when it lands', () => {
    const clip = sheetClip({ count: 28, fps: 12, impact: 4 });
    const s = createSwing();
    announceSwing(s, clip, 1);
    expect(s.t).toBe(-1); // waiting for impactIn − lead
    run(s, 0.5);
    expect(s.t).toBe(-1);
    const t = run(s, 0.5);
    expect(t).toBeCloseTo(clip.lead, 2);
    expect(swingFrame(s, 28, 12)).toBe(4);
  });

  it('a blow due sooner than the lead starts part-way with a sped-up wind-up, still on time', () => {
    const clip = { lead: 0.5, dur: 1 };
    const s = createSwing();
    announceSwing(s, clip, 0.2); // first blow after contact
    expect(s.speed).toBe(MAX_WINDUP_SPEED);
    expect(s.t).toBeCloseTo(0, 6);
    expect(run(s, 0.2)).toBeCloseTo(clip.lead, 2);
    const s2 = createSwing();
    announceSwing(s2, clip, 0.05); // faster than the cap allows: skips the start of the wind-up
    expect(s2.t).toBeGreaterThan(0);
    expect(run(s2, 0.05)).toBeCloseTo(clip.lead, 2);
  });

  it('the landed blow is authoritative: an early hit jumps to the impact frame, a late one does not restart', () => {
    const clip = { lead: 0.4, dur: 1 };
    const s = createSwing();
    announceSwing(s, clip, 0.4);
    run(s, 0.2);
    impactSwing(s, clip);
    expect(s.t).toBeCloseTo(clip.lead, 6);
    run(s, 0.05);
    const before = s.t;
    impactSwing(s, clip); // within the grace: keep playing
    expect(s.t).toBe(before);
    const idle = createSwing();
    impactSwing(idle, clip); // unannounced blow: strike from the impact frame
    expect(idle.t).toBeCloseTo(clip.lead, 6);
  });

  it('a queued next wind-up hurries the recovery so the clip ends before it starts', () => {
    const clip = { lead: 0.33, dur: 2.33 };
    const s = createSwing();
    announceSwing(s, clip, 0.33);
    run(s, 0.33);
    impactSwing(s, clip);
    announceSwing(s, clip, 1); // next blow in 1 s → wind-up starts in 0.67 s
    expect(s.recSpeed).toBeGreaterThan(1);
    // The clip still lands the next impact on time.
    expect(run(s, 1)).toBeCloseTo(clip.lead, 1);
  });

  it('a fight that ends before the impact fades the pose out instead of finishing the blow', () => {
    const clip = PROC_CLIP;
    const s = createSwing();
    announceSwing(s, clip, clip.lead);
    run(s, clip.lead * 0.5);
    const pose = swingPose(s, createSwingPose());
    expect(pose.forward).toBeLessThan(0); // leaning back in the wind-up
    cancelSwing(s);
    run(s, 0.06);
    const faded = swingPose(s, createSwingPose());
    expect(Math.abs(faded.forward)).toBeLessThan(Math.abs(pose.forward));
    run(s, 0.1);
    expect(s.t).toBe(-1);
  });

  it('procedural pose: lean back in the wind-up, full lunge at the impact, back to rest', () => {
    const clip = PROC_CLIP;
    const s = createSwing();
    const p = createSwingPose();
    s.clip = clip;
    s.t = clip.lead * 0.5;
    expect(swingPose(s, p).tilt).toBeLessThan(0);
    s.t = clip.lead - 1e-4;
    expect(swingPose(s, p).forward).toBeGreaterThan(0.9);
    s.t = clip.dur - 1e-4;
    expect(Math.abs(swingPose(s, p).forward)).toBeLessThan(0.01);
  });
});

describe('melee facing and spacing', () => {
  it('faces the foe; keeps the facing when the foe is straight above / below', () => {
    expect(faceToward(0.5, -1)).toBe(1);
    expect(faceToward(-0.5, 1)).toBe(-1);
    expect(faceToward(0.01, -1)).toBe(-1);
  });

  it('gang-ups spread over both sides and keep their side for the fight', () => {
    const out: number[] = [];
    // Three soldiers all arriving from the right of a boss: two right, the most central one left.
    assignSides(3, [1.0, 0.3, 0.8], [0, 0, 0], 1, out);
    expect(out).toEqual([1, -1, 1]);
    // Kept next frame even though its sim spot is still on the right.
    assignSides(3, [1.0, 0.3, 0.8], out.slice(), 1, out);
    expect(out).toEqual([1, -1, 1]);
    // Two kept on the right, a second one joins: one per side.
    assignSides(2, [0.9, 0.4], [1, 1], 1, out);
    expect(out).toEqual([1, -1]);
    // The foe walked clearly past a fighter: it switches.
    assignSides(1, [-1.5], [1], 1, out);
    expect(out).toEqual([-1]);
  });

  it('the gap keeps the sprites apart and is never inside the sim contact distance', () => {
    expect(fightGap(0.72, 1.3, 1.15)).toBeGreaterThanOrEqual(0.72);
    expect(fightGap(0.3, 2.5, 1.15)).toBeGreaterThan(1);
  });

  it('gang-up spots: one per side at the gap; shared sides stack without crossing', () => {
    const x: number[] = [];
    const z: number[] = [];
    gangSlots(1, [1], [0.5], 1, x, z);
    expect(x[0]).toBe(1);
    expect(z[0]).toBeCloseTo(0.2); // own height offset, clamped
    gangSlots(2, [-1, 1], [0, 0], 1, x, z);
    expect(x).toEqual([-1, 1]);
    gangSlots(3, [1, 1, 1], [0.3, -0.3, 0], 1, x, z);
    // Sorted by dz: the one above stays above and stands furthest out; about a body height apart.
    expect(z[1]).toBeLessThan(z[2]);
    expect(z[2]).toBeLessThan(z[0]);
    expect(x[1]).toBeGreaterThan(x[2]);
    expect(x[2]).toBeGreaterThan(x[0]);
    expect(z[2] - z[1]).toBeGreaterThanOrEqual(0.7);
    for (const v of x) expect(v).toBeGreaterThan(0.85);
    // Spots never coincide.
    expect(new Set(z.map((v) => v.toFixed(3))).size).toBe(3);
  });

  it('knockback is a jolt: out fast, back to zero', () => {
    expect(knockCurve(0, 0.16)).toBe(0);
    expect(knockCurve(0.048, 0.16)).toBeCloseTo(1, 5);
    expect(knockCurve(0.16, 0.16)).toBe(0);
  });
});
