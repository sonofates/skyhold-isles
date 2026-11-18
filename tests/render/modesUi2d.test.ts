import { describe, expect, it } from 'vitest';
import { createDefaultProgress } from '../../src/platform/storage.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { endlessRecordText, endNoteFor, tierName } from '../../src/render2d/ui/modeBits.ts';
import { applyRunResult2D } from '../../src/render2d/ui/progress2d.ts';
import { worldMapLayout } from '../../src/render2d/ui/mapLayout.ts';
import type { RunConfig } from '../../src/game/runConfig.ts';

const PLAIN: RunConfig = { endless: false, challenges: [], daily: null };

describe('endless record wording', () => {
  it('no record before the story waves are passed', () => {
    const r = endlessRecordText(0, 10);
    expect(r.best).toBe('No record yet');
    expect(r.tier).toBe(0);
    expect(r.next).toBe('Bronze: clear wave 13');
    expect(endlessRecordText(10, 10).best).toBe('No record yet');
  });

  it('medal tiers and the next goal', () => {
    // Fell on wave 14 of a 10-wave isle: 3 endless waves cleared = bronze.
    const r = endlessRecordText(14, 10);
    expect(r.best).toBe('Wave 14');
    expect(r.tierName).toBe('Bronze');
    expect(r.next).toBe('Silver: clear wave 16 (3 more)');
    const g = endlessRecordText(30, 10);
    expect(g.tierName).toBe('Gold');
    expect(g.next).toBe('');
    expect(tierName(0)).toBe('');
  });
});

describe('end panel notes for mode runs', () => {
  const lvl = LEVELS_2D[0];
  const won = (cfg: RunConfig, prep?: (p: ReturnType<typeof createDefaultProgress>) => void) => {
    const p = createDefaultProgress(LEVELS_2D.length);
    prep?.(p);
    return applyRunResult2D(p, { levelId: lvl.id, won: true, stars: 3, livesRemaining: 8, waveReached: lvl.waves.length, runConfig: cfg, nowMs: Date.UTC(2026, 10, 18, 12) });
  };

  it('plain runs add nothing', () => {
    expect(endNoteFor({ won: true, runConfig: PLAIN, result: won(PLAIN), wave: 10, storyWaves: 10 })).toBeNull();
    expect(endNoteFor({ won: false, runConfig: PLAIN, result: null, wave: 4, storyWaves: 10 })).toBeNull();
  });

  it('a new challenge badge is a reward line', () => {
    const cfg: RunConfig = { ...PLAIN, challenges: ['bowless'] };
    const n = endNoteFor({ won: true, runConfig: cfg, result: won(cfg), wave: 10, storyWaves: 10, masteredNow: false });
    expect(n?.caption).toBe('Badge: Bowless +1★');
    expect(n?.reward).toBe(true);
  });

  it('a challenge already earned is named, not rewarded', () => {
    const cfg: RunConfig = { ...PLAIN, challenges: ['bowless'] };
    const res = won(cfg, (p) => {
      p.clears[0] = 1;
      p.challengeClears[0] = ['bowless'];
    });
    const n = endNoteFor({ won: true, runConfig: cfg, result: res, wave: 10, storyWaves: 10 });
    expect(n?.caption).toBe('Challenge won: Bowless');
    expect(n?.reward).toBe(false);
  });

  it('daily squall win shows the streak; a second win the same day says so', () => {
    const day = Math.floor(Date.UTC(2026, 10, 18, 12) / 86_400_000);
    const cfg: RunConfig = { ...PLAIN, challenges: ['thaw', 'galeForce'], daily: day };
    const first = endNoteFor({ won: true, runConfig: cfg, result: won(cfg), wave: 10, storyWaves: 10 });
    expect(first?.caption).toContain('Daily Squall won +1★ · 1-day streak');
    const again = won(cfg, (p) => {
      p.daily.lastDay = day;
      p.daily.streak = 1;
    });
    expect(endNoteFor({ won: true, runConfig: cfg, result: again, wave: 10, storyWaves: 10 })?.caption).toContain('reward taken today');
  });

  it('endless: record past the story waves, plain wording before', () => {
    const cfg: RunConfig = { endless: true, challenges: [], daily: null };
    const p = createDefaultProgress(LEVELS_2D.length);
    const res = applyRunResult2D(p, { levelId: lvl.id, won: false, stars: 0, livesRemaining: 0, waveReached: 17, runConfig: cfg });
    const n = endNoteFor({ won: false, runConfig: cfg, result: res, wave: 17, storyWaves: 10 });
    expect(n).toMatchObject({ title: 'Endless Run', line1: 'Wave 17', caption: 'New best: wave 17! · Silver medal', victoryBoard: true, reward: true });
    const early = applyRunResult2D(p, { levelId: lvl.id, won: false, stars: 0, livesRemaining: 0, waveReached: 6, runConfig: cfg });
    expect(endNoteFor({ won: false, runConfig: cfg, result: early, wave: 6, storyWaves: 10 })).toMatchObject({ line1: 'Wave 6/10', caption: 'Records start past wave 10' });
  });
});

describe('world map with many islands', () => {
  const VIEWPORTS: [number, number][] = [
    [844, 390],
    [1600, 900],
    [2560, 1080],
  ];
  for (const [w, h] of VIEWPORTS) {
    for (const n of [9, 17, 24]) {
      it(`${n} islands at ${w}x${h}: scrolls, keeps spacing, name tags never collide`, () => {
        const L = worldMapLayout(n, w, h, { top: 0, right: 0, bottom: 0, left: 0 }, 70);
        expect(L.nodes).toHaveLength(n);
        if (n >= 17) expect(L.worldW).toBeGreaterThan(w);
        for (let i = 1; i < n; i++) {
          const dx = L.nodes[i].x - L.nodes[i - 1].x;
          // Name tags (≤ 1.25 D text + ring) of neighbours fit between the centres.
          expect(dx).toBeGreaterThanOrEqual(L.nodeD * 1.6);
          expect(L.nodes[i].y).not.toBe(L.nodes[i - 1].y);
        }
        expect(L.nodes[n - 1].x + L.nodeD / 2).toBeLessThanOrEqual(L.worldW);
      });
    }
  }

  it('stand-in levels keep ids unique (mock islands for QA)', () => {
    const ids = new Set((LEVELS_2D as readonly LevelDef[]).map((l) => l.id));
    expect(ids.size).toBe(LEVELS_2D.length);
  });
});
