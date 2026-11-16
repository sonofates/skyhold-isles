import { describe, expect, it } from 'vitest';
import { ABILITY_DEFS, ABILITY_IDS, computeMeteorDamage } from '../../src/data/abilities.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS, parseLevelGrid } from '../../src/data/levels/index.ts';
import {
  FROST_TINT_HEX,
  lerpHexColor,
  PALETTE,
  PALETTE_HEX,
  SKY_HORIZON_HEX,
  SKY_ZENITH_HEX,
  type PaletteKey,
} from '../../src/data/palette.ts';
import { getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../../src/data/towers.ts';
import { getTowerPickBounds, TOWER_PICK_BOUNDS } from '../../src/render/towerPicking.ts';
import { CompiledPath } from '../../src/sim/path.ts';
import { ENEMY_BADGE_META, TOWER_ICON_SVGS, UI_ICON_SVGS } from '../../src/ui/icons.ts';

describe('palette and color math contracts', () => {
  it('keeps PALETTE and PALETTE_HEX keys and hex values aligned', () => {
    const cssKeys = Object.keys(PALETTE).sort();
    const hexKeys = Object.keys(PALETTE_HEX).sort();
    expect(cssKeys).toEqual(hexKeys);

    for (const key of cssKeys as PaletteKey[]) {
      const css = PALETTE[key];
      const hex = PALETTE_HEX[key];
      expect(css).toMatch(/^#[0-9a-f]{6}$/i);
      expect(hex).toBe(Number.parseInt(css.slice(1), 16));
    }

    expect(lerpHexColor(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(lerpHexColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(lerpHexColor(0x102030, 0x304050, 0.5)).toBe(0x203040);
    expect(SKY_HORIZON_HEX).toBeGreaterThanOrEqual(0);
    expect(SKY_ZENITH_HEX).toBeGreaterThanOrEqual(0);
    expect(FROST_TINT_HEX).toBeGreaterThanOrEqual(0);
  });
});

describe('tower, enemy, ability, and UI metadata contracts', () => {
  it('ensures every tower archetype has complete stats, picking bounds, unique hotkeys, and SVG icons', () => {
    expect(TOWER_TYPES.length).toBeGreaterThanOrEqual(5);
    const seenHotkeys = new Set<number>();

    for (const type of TOWER_TYPES) {
      const def = TOWER_DEFS[type];
      expect(def.type).toBe(type);
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.shortDesc.trim().length).toBeGreaterThan(0);
      expect(def.turretHeight).toBeGreaterThan(0);
      expect(seenHotkeys.has(def.hotkey)).toBe(false);
      seenHotkeys.add(def.hotkey);

      expect(TOWER_ICON_SVGS[type]).toContain('<svg');
      expect(TOWER_PICK_BOUNDS[type]).toHaveLength(3);

      for (const tier of [1, 2, 3] as const) {
        const stats = getTowerTierStats(type, tier);
        expect(stats.tier).toBe(tier);
        expect(stats.upgradeCost).toBeGreaterThan(0);
        expect(stats.damage).toBeGreaterThanOrEqual(0);
        expect(stats.fireRate).toBeGreaterThan(0);
        expect(stats.minRange).toBeGreaterThanOrEqual(0);
        expect(stats.range).toBeGreaterThan(stats.minRange);
        expect(stats.splashFalloffMin).toBeGreaterThan(0);
        expect(stats.splashFalloffMin).toBeLessThanOrEqual(1);
        expect(stats.slowRatio).toBeGreaterThanOrEqual(0);
        expect(stats.slowRatio).toBeLessThanOrEqual(1);

        const bounds = getTowerPickBounds(type, tier);
        expect(bounds.halfWidth).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);
      }
    }
  });

  it('ensures every enemy archetype has valid combat parameters and UI badge metadata', () => {
    expect(ENEMY_TYPES.length).toBeGreaterThanOrEqual(7);

    for (const type of ENEMY_TYPES) {
      const def = ENEMY_DEFS[type];
      expect(def.type).toBe(type);
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.description.trim().length).toBeGreaterThan(0);
      expect(def.maxHp).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.armor).toBeGreaterThanOrEqual(0);
      expect(def.reward).toBeGreaterThanOrEqual(0);
      expect(def.livesCost).toBeGreaterThanOrEqual(1);
      expect(def.radius).toBeGreaterThan(0);
      expect(def.height).toBeGreaterThan(0);

      const badge = ENEMY_BADGE_META[type];
      expect(badge.label.trim().length).toBeGreaterThan(0);
      expect(badge.color).toMatch(/^#[0-9a-f]{6}$/i);
    }

    expect(ENEMY_DEFS.healer.healAmount).toBeGreaterThan(0);
    expect(ENEMY_DEFS.healer.healRadius).toBeGreaterThan(0);
    expect(ENEMY_DEFS.healer.healInterval).toBeGreaterThan(0);
  });

  it('ensures every ability has valid definitions, icons, and monotonic meteor scaling', () => {
    const seenHotkeys = new Set<string>();
    for (const id of ABILITY_IDS) {
      const def = ABILITY_DEFS[id];
      expect(def.id).toBe(id);
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.cooldownSec).toBeGreaterThan(0);
      expect(seenHotkeys.has(def.hotkey)).toBe(false);
      seenHotkeys.add(def.hotkey);
      expect(UI_ICON_SVGS[id]).toContain('<svg');
    }

    let prev = 0;
    for (let wave = 1; wave <= 30; wave++) {
      const dmg = computeMeteorDamage(wave);
      expect(Number.isInteger(dmg)).toBe(true);
      expect(dmg).toBeGreaterThan(prev);
      prev = dmg;
    }
  });
});

describe('level data, flight paths, waves, and scripted build orders', () => {
  it('validates flight path bounds, wave spawns, and scripted build actions across all islands', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(9);
    const enemyTypeSet = new Set<string>(ENEMY_TYPES);
    const towerTypeSet = new Set<string>(TOWER_TYPES);
    const validDifficulties = new Set(['Breezy', 'Challenging', 'Heroic', 'Master']);

    for (const lvl of LEVELS) {
      expect(lvl.name.trim().length).toBeGreaterThan(0);
      expect(lvl.subtitle.trim().length).toBeGreaterThan(0);
      expect(validDifficulties.has(lvl.difficulty)).toBe(true);
      expect(lvl.startingGold).toBeGreaterThan(0);
      expect(lvl.enemyHpScale ?? 1).toBeGreaterThan(0);
      expect(lvl.waveHpGrowth ?? 0).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(lvl.decorationSeed)).toBe(true);

      // Flight path coordinates must sit inside grid and form non-degenerate segments
      expect(lvl.flightPath.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < lvl.flightPath.length; i++) {
        const pt = lvl.flightPath[i];
        expect(pt.col).toBeGreaterThanOrEqual(0);
        expect(pt.col).toBeLessThan(lvl.cols);
        expect(pt.row).toBeGreaterThanOrEqual(0);
        expect(pt.row).toBeLessThan(lvl.rows);
        if (i > 0) {
          const prev = lvl.flightPath[i - 1];
          expect(Math.hypot(pt.col - prev.col, pt.row - prev.row)).toBeGreaterThan(0);
        }
      }

      const ground = new CompiledPath(lvl.pathWaypoints, lvl.cols, lvl.rows, BALANCE.tilePathTopY, true);
      const flight = new CompiledPath(lvl.flightPath, lvl.cols, lvl.rows, BALANCE.flyerHeight, false);
      expect(ground.totalLength).toBeGreaterThan(0);
      expect(flight.totalLength).toBeGreaterThan(0);

      // Waves must contain valid enemy types, positive intervals/counts, and fit pool capacity
      expect(lvl.waves.length).toBeGreaterThan(0);
      for (const wave of lvl.waves) {
        expect(wave.clearBonus).toBeGreaterThanOrEqual(0);
        expect(wave.groups.length).toBeGreaterThan(0);
        let waveTotal = 0;
        for (const grp of wave.groups) {
          expect(enemyTypeSet.has(grp.enemyType)).toBe(true);
          expect(Number.isInteger(grp.count) && grp.count > 0).toBe(true);
          expect(grp.spawnInterval).toBeGreaterThan(0);
          expect(grp.startDelay).toBeGreaterThanOrEqual(0);
          waveTotal += grp.count;
        }
        expect(waveTotal).toBeLessThanOrEqual(BALANCE.pools.maxEnemies);
      }

      // Scripted build orders (greedy + weak) must build once per grass tile and upgrade <= tier 3
      const grid = parseLevelGrid(lvl);
      for (const order of [lvl.scriptedBuildOrder ?? [], lvl.weakBuildOrder ?? []]) {
        const tiersByTile = new Map<string, number>();
        for (const act of order) {
          expect(act.waveIndex).toBeGreaterThanOrEqual(0);
          expect(act.waveIndex).toBeLessThan(lvl.waves.length);
          expect(grid[act.row]?.[act.col]).toBe('grass');
          const key = `${act.col},${act.row}`;
          if (act.action === 'build') {
            expect(act.towerType && towerTypeSet.has(act.towerType)).toBe(true);
            expect(tiersByTile.has(key)).toBe(false);
            tiersByTile.set(key, 1);
          } else {
            const cur = tiersByTile.get(key) ?? 0;
            expect(cur).toBeGreaterThanOrEqual(1);
            expect(cur).toBeLessThan(3);
            tiersByTile.set(key, cur + 1);
          }
        }
      }
    }
  });
});
