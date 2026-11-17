import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildArtMatrix,
  enemyHasArt,
  listArtFiles,
  mixTint,
  mulTint,
  pickTier,
  resolveEnemyArt,
  resolveEnemyType,
  resolveTowerTiers,
} from '../../src/render2d/artResolve.ts';
import { enemyArtFor, ManifestError, parseManifest } from '../../src/render2d/manifest.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { TOWER_TYPES } from '../../src/data/towers.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const RAW = JSON.parse(readFileSync(resolve(ROOT, 'public/art2d/manifest.json'), 'utf8')) as Record<string, unknown>;
const M = parseManifest(RAW);
const onDisk = (p: string): boolean => existsSync(resolve(ROOT, 'public/art2d', p));
const none = (): boolean => false;
const all = (): boolean => true;

describe('manifest covers the full roster', () => {
  it('maps every sim enemy type to its own art key (grunt = raider, flyer = kite)', () => {
    for (const t of ENEMY_TYPES) {
      const key = enemyArtFor(M, t, ENEMY_DEFS[t].flying).art;
      expect(M.enemies[key], `${t} → ${key}`).toBeDefined();
    }
    expect(enemyArtFor(M, 'grunt', false).art).toBe('raider');
    expect(enemyArtFor(M, 'flyer', true).art).toBe('kite');
    const own = ENEMY_TYPES.filter((t) => t !== 'grunt' && t !== 'flyer');
    for (const t of own) expect(enemyArtFor(M, t, ENEMY_DEFS[t].flying).art).toBe(t);
  });

  it('names the art files the pipeline will deliver', () => {
    const fresh = ENEMY_TYPES.filter((t) => !['grunt', 'brute', 'flyer'].includes(t));
    for (const t of fresh) {
      const e = M.enemies[t];
      expect(e.file).toBe(`enemy-${t}.webp`);
      expect(e.back).toBe(`enemy-${t}-back.webp`);
      expect(e.sheet?.down).toBe(`anim/${t}-walk-down.json`);
      expect(e.sheet?.up).toBe(`anim/${t}-walk-up.json`);
      expect(e.mode).toBe('sheet');
    }
    expect(M.enemies.burrower.mound).toBe('enemy-burrower-mound.webp');
    expect(M.towers.archer?.tiers[0]).toBe('tower-archer.webp');
    expect(M.towers.cannon?.tiers[0]).toBe('tower-cannon.webp');
    expect(M.towers.tesla?.tiers).toEqual(['tower-mage.webp', 'tower-mage-t2.webp', 'tower-mage-t3.webp']);
    for (const t of ['frost', 'mortar', 'ballista', 'beacon'] as const) {
      expect(M.towers[t]?.tiers).toEqual([1, 2, 3].map((n) => `tower-${t}-t${n}.webp`));
    }
  });

  it('has all 7 towers in the build ring', () => {
    expect(M.buildRing).toEqual(expect.arrayContaining([...TOWER_TYPES]));
  });
});

describe('fallback resolution with the art that is on disk today', () => {
  it('every enemy type resolves to art whose front file exists', () => {
    for (const t of ENEMY_TYPES) {
      const res = resolveEnemyType(M, t, ENEMY_DEFS[t].flying, onDisk);
      const art = M.enemies[res.key];
      expect(enemyHasArt(art, onDisk), `${t} → ${res.chain.join(' → ')}`).toBe(true);
      expect(onDisk(art.file), `${t}: ${art.file}`).toBe(true);
    }
  });

  it('every tower type resolves to tier files that exist, for all three tiers', () => {
    for (const t of TOWER_TYPES) {
      const res = resolveTowerTiers(M, t, onDisk);
      expect(res.tierFiles.every((f) => f !== null && onDisk(f)), `${t} → ${res.source}`).toBe(true);
    }
  });

  it('pending enemies draw a tinted raider / brute / kite', () => {
    const golem = resolveEnemyArt(M, 'golem', none);
    expect(golem.key).toBe('brute');
    expect(golem.own).toBe(false);
    expect(golem.tint).not.toBe(0xffffff);
    expect(resolveEnemyArt(M, 'carrier', none).key).toBe('kite');
    expect(resolveEnemyArt(M, 'runner', none).key).toBe('raider');
  });

  it('own art wins as soon as one file lands (sheet pair or sprite)', () => {
    const sprite = (p: string): boolean => p === 'enemy-runner.webp';
    expect(resolveEnemyArt(M, 'runner', sprite).own).toBe(true);
    const sheets = (p: string): boolean => p.startsWith('anim/runner-walk-');
    expect(resolveEnemyArt(M, 'runner', sheets).own).toBe(true);
    const halfSheet = (p: string): boolean => p === 'anim/runner-walk-down.json';
    expect(resolveEnemyArt(M, 'runner', halfSheet).own).toBe(false);
  });

  it('towers: highest present tier at or below, else lowest above, else the tinted similar tower', () => {
    expect(pickTier([true, false, false], 3)).toBe(0);
    expect(pickTier([true, true, false], 3)).toBe(1);
    expect(pickTier([false, true, true], 1)).toBe(1);
    expect(pickTier([false, false, false], 2)).toBe(-1);
    const t2only = (p: string): boolean => p === 'tower-frost-t2.webp';
    expect(resolveTowerTiers(M, 'frost', t2only).tierFiles).toEqual(Array(3).fill('tower-frost-t2.webp'));
    const nothing = resolveTowerTiers(M, 'frost', (p) => p.startsWith('tower-archer'));
    expect(nothing.source).toBe('archer');
    expect(nothing.own).toBe(false);
    expect(nothing.tint).not.toBe(0xffffff);
    expect(nothing.tierFiles).toEqual(['tower-archer.webp', 'tower-archer-t2.webp', 'tower-archer-t3.webp']);
    expect(resolveTowerTiers(M, 'mortar', (p) => p.startsWith('tower-cannon')).source).toBe('cannon');
  });

  it('a fallback chain cannot loop forever', () => {
    const loop = JSON.parse(JSON.stringify(RAW)) as { enemies: Record<string, { fallback?: unknown }> };
    loop.enemies.raider.fallback = { art: 'runner' };
    loop.enemies.runner.fallback = { art: 'raider' };
    const m = parseManifest(loop);
    expect(resolveEnemyArt(m, 'runner', none).chain.length).toBeLessThanOrEqual(7);
  });

  it('rejects fallbacks that point at nothing', () => {
    const bad = JSON.parse(JSON.stringify(RAW)) as { enemies: Record<string, { fallback?: unknown }> };
    bad.enemies.runner.fallback = { art: 'nope' };
    expect(() => parseManifest(bad)).toThrow(ManifestError);
    const badT = JSON.parse(JSON.stringify(RAW)) as { towers: Record<string, { fallback?: unknown }> };
    badT.towers.frost.fallback = { tower: 'nope' };
    expect(() => parseManifest(badT)).toThrow(ManifestError);
  });
});

describe('artcheck matrix', () => {
  it('reports present vs missing per slot and what is drawn instead', () => {
    const rows = buildArtMatrix(M, (p) => p === 'enemy-raider.webp' || p === 'tower-archer.webp');
    const raider = rows.find((r) => r.id === 'raider')!;
    expect(raider.cells.front).toBe(true);
    expect(raider.cells.back).toBe(false);
    expect(raider.types).toContain('grunt');
    const runner = rows.find((r) => r.id === 'runner')!;
    expect(runner.cells.front).toBe(false);
    expect(runner.effective).toBe('→ raider');
    expect(runner.complete).toBe(false);
    const frost = rows.find((r) => r.id === 'frost')!;
    expect(frost.effective).toBe('→ archer');
    expect(rows.find((r) => r.id === 'archer')!.cells.t1).toBe(true);
    expect(rows.find((r) => r.id === 'burrower')!.cells.mound).toBe(false);
    expect(rows.find((r) => r.id === 'brute')!.cells.mound).toBeNull();
  });

  it('is complete when every file exists', () => {
    const rows = buildArtMatrix(M, all);
    expect(rows.every((r) => r.complete)).toBe(true);
    expect(listArtFiles(M).length).toBeGreaterThan(60);
  });
});

describe('tint maths', () => {
  it('multiplies and mixes 0xRRGGBB', () => {
    expect(mulTint(0xffffff, 0x80c0ff)).toBe(0x80c0ff);
    expect(mulTint(0x000000, 0xffffff)).toBe(0);
    expect(mixTint(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixTint(0x102030, 0xffffff, 0)).toBe(0x102030);
  });
});
