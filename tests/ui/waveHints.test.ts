import { describe, expect, it } from 'vitest';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { TOWER_DEFS, TOWER_TYPES } from '../../src/data/towers.ts';
import { airTowerNames, waveAccent, waveBannerContent, waveHint } from '../../src/ui/content/waveHints.ts';

describe('wave banner text', () => {
  it('every story wave has a real name (no blanks, no duplicates inside an island)', () => {
    for (const level of LEVELS) {
      const seen = new Set<string>();
      for (let i = 0; i < level.waves.length; i++) {
        const name = level.waves[i].name?.trim() ?? '';
        expect(name.length, `${level.id} wave ${i + 1}`).toBeGreaterThan(1);
        expect(name.length, `${level.id} wave ${i + 1} too long for a banner`).toBeLessThanOrEqual(28);
        expect(seen.has(name.toLowerCase()), `${level.id}: duplicate wave name "${name}"`).toBe(false);
        seen.add(name.toLowerCase());
      }
    }
  });

  it('builds a kicker, title and short hint for every wave of every island', () => {
    for (const level of LEVELS) {
      const total = level.waves.length;
      for (let i = 0; i < total; i++) {
        const c = waveBannerContent(level, i, total);
        expect(c.title).toBe(level.waves[i].name);
        expect(c.hint.length, `${level.id} W${i + 1}`).toBeGreaterThan(10);
        expect(c.hint.length, `${level.id} W${i + 1}`).toBeLessThanOrEqual(80);
        expect(c.kicker).toBe(i === total - 1 ? 'FINAL WAVE' : `WAVE ${i + 1} OF ${total}`);
      }
    }
  });

  it('names the towers that hit air, never the Beacon', () => {
    const names = airTowerNames();
    expect(names).not.toMatch(/beacon/i);
    const air = TOWER_TYPES.filter((t) => TOWER_DEFS[t].hitsFlyers && TOWER_DEFS[t].role === 'attack');
    for (const t of air) expect(names.toLowerCase()).toContain(t);
    const flyerWave = LEVELS.flatMap((l) => l.waves).find((w) => w.groups.some((g) => g.enemyType === 'flyer'));
    expect(waveHint(flyerWave)).toContain(names);
    expect(waveHint(flyerWave)).toMatch(/^Flyers incoming/);
  });

  it('marks boss waves and puts the boss hint first', () => {
    let bossWaves = 0;
    for (const level of LEVELS) {
      for (const wave of level.waves) {
        const hasBoss = wave.groups.some((g) => ENEMY_DEFS[g.enemyType].isBoss);
        expect(waveAccent(wave) === 'boss').toBe(hasBoss);
        if (hasBoss) {
          bossWaves++;
          expect(waveHint(wave)).toMatch(/^Boss wave/);
        }
      }
    }
    expect(bossWaves).toBeGreaterThan(1);
  });

  it('flags elite waves', () => {
    const level = LEVELS.find((l) => l.waves.some((w) => w.groups.some((g) => g.elite)));
    expect(level).toBeDefined();
    const idx = level!.waves.findIndex((w) => w.groups.some((g) => g.elite));
    expect(waveBannerContent(level!, idx, level!.waves.length).elite).toBe(true);
    expect(waveBannerContent(level!, 0, level!.waves.length).elite).toBe(level!.waves[0].groups.some((g) => g.elite === true));
  });

  it('falls back to "Wave N" without a name and handles endless waves', () => {
    const level = LEVELS[0];
    const total = level.waves.length;
    const endless = waveBannerContent(level, total + 4, total, true);
    expect(endless.kicker).toBe(`ENDLESS · WAVE ${total + 5}`);
    expect(endless.title).toBe(`Wave ${total + 5}`);
    expect(endless.hint.length).toBeGreaterThan(10);
    const unnamed = { ...level, waves: [{ groups: level.waves[0].groups, clearBonus: 10 }] };
    expect(waveBannerContent(unnamed, 0, 3).title).toBe('Wave 1');
    // Out-of-range, non-endless: still safe.
    expect(waveBannerContent(level, 99, total).hint).toBe('Hold the road.');
  });

  it('picks the most urgent hint when a wave mixes foes', () => {
    const mixed = { clearBonus: 0, groups: [
      { enemyType: 'grunt' as const, count: 3, spawnInterval: 1, startDelay: 0 },
      { enemyType: 'healer' as const, count: 1, spawnInterval: 1, startDelay: 0 },
      { enemyType: 'flyer' as const, count: 2, spawnInterval: 1, startDelay: 0 },
    ] };
    expect(waveHint(mixed)).toMatch(/^Flyers incoming/);
    expect(waveHint({ ...mixed, groups: mixed.groups.slice(0, 2) })).toMatch(/^Healers/);
    expect(waveHint(undefined)).toBe('Hold the road.');
  });
});
