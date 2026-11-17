import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ABILITY_DEFS, ABILITY_IDS, computeMeteorDamage } from '../../src/data/abilities.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS, parseLevelGrid } from '../../src/data/levels/index.ts';
import { parseTileChar } from '../../src/data/levels/types.ts';
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
import { KENNEY_MODEL_LIST } from '../../src/render/kenneyAssets.ts';
import { getTowerPickBounds, TOWER_PICK_BOUNDS } from '../../src/render/towerPicking.ts';
import { gridToWorldX, gridToWorldZ } from '../../src/sim/grid.ts';
import { CompiledPath } from '../../src/sim/path.ts';
import { buildEndlessWaveDef } from '../../src/sim/waveSystem.ts';
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
    expect(lerpHexColor(0x102030, 0x304050, 0.25)).toBe(0x182838);
    expect(lerpHexColor(0x102030, 0x304050, 0.5)).toBe(0x203040);
    expect(SKY_HORIZON_HEX).toBeGreaterThanOrEqual(0);
    expect(SKY_ZENITH_HEX).toBeGreaterThanOrEqual(0);
    expect(FROST_TINT_HEX).toBeGreaterThanOrEqual(0);
  });
});

describe('tower, enemy, ability, and UI metadata contracts', () => {
  it('ensures every tower archetype has complete stats, picking bounds, unique hotkeys, and SVG icons', () => {
    expect(TOWER_TYPES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(TOWER_TYPES).size).toBe(TOWER_TYPES.length);
    const seenHotkeys = new Set<number>();

    TOWER_TYPES.forEach((type, idx) => {
      const def = TOWER_DEFS[type];
      expect(def.type).toBe(type);
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.shortDesc.trim().length).toBeGreaterThan(0);
      expect(def.turretHeight).toBeGreaterThan(0);
      expect(def.hotkey).toBe(idx + 1);
      expect(seenHotkeys.has(def.hotkey)).toBe(false);
      seenHotkeys.add(def.hotkey);

      expect(TOWER_ICON_SVGS[type]).toContain('<svg');
      expect(TOWER_PICK_BOUNDS[type]).toHaveLength(3);

      for (const tier of [1, 2, 3] as const) {
        const stats = getTowerTierStats(type, tier);
        expect(stats.tier).toBe(tier);
        expect(Number.isInteger(stats.upgradeCost)).toBe(true);
        expect(stats.upgradeCost).toBeGreaterThan(0);
        expect(stats.damage).toBeGreaterThanOrEqual(0);
        expect(stats.fireRate).toBeGreaterThan(0);
        expect(stats.minRange).toBeGreaterThanOrEqual(0);
        expect(stats.range).toBeGreaterThan(stats.minRange);
        expect(stats.splashFalloffMin).toBeGreaterThan(0);
        expect(stats.splashFalloffMin).toBeLessThanOrEqual(1);
        expect(stats.slowRatio).toBeGreaterThanOrEqual(0);
        expect(stats.slowRatio).toBeLessThanOrEqual(1);
        expect(stats.projectileSpeed).toBeGreaterThanOrEqual(0);
        expect(stats.splashRadius).toBeGreaterThanOrEqual(0);
        expect(stats.chainCount).toBeGreaterThanOrEqual(0);
        if (stats.chainCount > 1) {
          expect(stats.chainRange).toBeGreaterThan(0);
          expect(stats.chainFalloff).toBeGreaterThan(0);
          expect(stats.chainFalloff).toBeLessThanOrEqual(1);
        }

        const bounds = getTowerPickBounds(type, tier);
        expect(bounds.halfWidth).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);
      }

      expect(TOWER_PICK_BOUNDS[type][0].height).toBeGreaterThanOrEqual(def.turretHeight);
      expect(TOWER_PICK_BOUNDS[type][1].height).toBeGreaterThanOrEqual(TOWER_PICK_BOUNDS[type][0].height);
      expect(TOWER_PICK_BOUNDS[type][2].height).toBeGreaterThanOrEqual(TOWER_PICK_BOUNDS[type][1].height);

      const t1 = getTowerTierStats(type, 1);
      const t2 = getTowerTierStats(type, 2);
      const t3 = getTowerTierStats(type, 3);
      if (t1.damage > 0) {
        expect(t2.damage * t2.fireRate).toBeGreaterThan(t1.damage * t1.fireRate);
        expect(t3.damage * t3.fireRate).toBeGreaterThan(t2.damage * t2.fireRate);
      }
      expect(t2.range).toBeGreaterThanOrEqual(t1.range);
      expect(t3.range).toBeGreaterThanOrEqual(t2.range);
    });

    expect(TOWER_TYPES.some((t) => TOWER_DEFS[t].hitsFlyers)).toBe(true);
    expect(TOWER_TYPES.some((t) => getTowerTierStats(t, 1).splashRadius > 0)).toBe(true);
  });

  it('ensures every enemy archetype has valid combat parameters and UI badge metadata', () => {
    expect(ENEMY_TYPES.length).toBeGreaterThanOrEqual(7);
    expect(new Set(ENEMY_TYPES).size).toBe(ENEMY_TYPES.length);

    for (const type of ENEMY_TYPES) {
      const def = ENEMY_DEFS[type];
      expect(def.type).toBe(type);
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.description.trim().length).toBeGreaterThan(0);
      expect(def.maxHp).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.armor).toBeGreaterThanOrEqual(0);
      expect(def.reward).toBeGreaterThan(0);
      expect(def.livesCost).toBeGreaterThanOrEqual(1);
      expect(def.radius).toBeGreaterThan(0);
      expect(def.height).toBeGreaterThan(0);

      const badge = ENEMY_BADGE_META[type];
      expect(badge.label.trim().length).toBeGreaterThan(0);
      expect(badge.color).toMatch(/^#[0-9a-f]{6}$/i);

      const hasHealField =
        def.healAmount !== undefined || def.healRadius !== undefined || def.healInterval !== undefined;
      if (hasHealField) {
        expect(def.healAmount).toBeGreaterThan(0);
        expect(def.healRadius).toBeGreaterThan(0);
        expect(def.healInterval).toBeGreaterThan(0);
      }
    }

    expect(ENEMY_DEFS.healer.healAmount).toBeGreaterThan(0);
    expect(ENEMY_DEFS.healer.healRadius).toBeGreaterThan(0);
    expect(ENEMY_DEFS.healer.healInterval).toBeGreaterThan(0);
  });

  it('ensures every ability has valid definitions, icons, and monotonic meteor scaling', () => {
    expect(new Set(ABILITY_IDS).size).toBe(ABILITY_IDS.length);
    const seenHotkeys = new Set<string>();
    for (const id of ABILITY_IDS) {
      const def = ABILITY_DEFS[id];
      expect(def.id).toBe(id);
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.shortDesc.trim().length).toBeGreaterThan(0);
      expect(def.cooldownSec).toBeGreaterThan(0);
      expect(seenHotkeys.has(def.hotkey)).toBe(false);
      seenHotkeys.add(def.hotkey);
      expect(UI_ICON_SVGS[id]).toContain('<svg');
    }

    expect(ABILITY_DEFS.meteor.requiresTarget).toBe(true);
    expect(ABILITY_DEFS.meteor.radius).toBeGreaterThan(0);
    expect(ABILITY_DEFS.meteor.impactDelaySec).toBeGreaterThan(0);
    expect(ABILITY_DEFS.meteor.baseDamage).toBeGreaterThan(0);
    expect(ABILITY_DEFS.meteor.waveDamageScale).toBeGreaterThanOrEqual(0);
    expect(ABILITY_DEFS.meteor.slowRatio).toBeGreaterThanOrEqual(0);
    expect(ABILITY_DEFS.meteor.slowRatio).toBeLessThan(1);
    expect(ABILITY_DEFS.meteor.slowDuration).toBeGreaterThanOrEqual(0);

    expect(ABILITY_DEFS.overcharge.requiresTarget).toBe(false);
    expect(ABILITY_DEFS.overcharge.durationSec).toBeGreaterThan(0);
    expect(ABILITY_DEFS.overcharge.fireRateMultiplier).toBeGreaterThan(1);

    expect(computeMeteorDamage(0)).toBe(ABILITY_DEFS.meteor.baseDamage);
    expect(computeMeteorDamage(-3)).toBe(ABILITY_DEFS.meteor.baseDamage);
    expect(computeMeteorDamage(1)).toBe(ABILITY_DEFS.meteor.baseDamage);

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
    const seenLevelIds = new Set<string>();

    const cheapestTowerCost = Math.min(...TOWER_TYPES.map((t) => getTowerTierStats(t, 1).upgradeCost));
    const maxAntiAirRange = Math.max(
      ...TOWER_TYPES.filter((t) => TOWER_DEFS[t].hitsFlyers).map((t) => getTowerTierStats(t, 1).range),
    );
    const maxGroundRange = Math.max(...TOWER_TYPES.map((t) => getTowerTierStats(t, 1).range));
    const validTokens = new Set(['.', 'T', 'P', 'S', 'G', '~']);
    const campaignEnemiesSeen = new Set<string>();
    const sampleVec = { x: 0, y: 0, z: 0 };

    LEVELS.forEach((lvl, idx) => {
      expect(lvl.index).toBe(idx);
      expect(seenLevelIds.has(lvl.id)).toBe(false);
      seenLevelIds.add(lvl.id);
      expect(lvl.name.trim().length).toBeGreaterThan(0);
      expect(lvl.subtitle.trim().length).toBeGreaterThan(0);
      expect(validDifficulties.has(lvl.difficulty)).toBe(true);
      expect(lvl.startingGold).toBeGreaterThanOrEqual(cheapestTowerCost);
      expect(lvl.enemyHpScale ?? 1).toBeGreaterThan(0);
      expect(lvl.waveHpGrowth ?? 0).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(lvl.decorationSeed)).toBe(true);
      expect(lvl.layout).toHaveLength(lvl.rows);
      for (const rowStr of lvl.layout) {
        const tokens = rowStr.trim().split(/\s+/);
        expect(tokens).toHaveLength(lvl.cols);
        for (const tok of tokens) {
          expect(validTokens.has(tok), `Invalid layout token "${tok}" in ${lvl.id}`).toBe(true);
        }
      }

      // Ground path coordinates must sit inside grid with non-degenerate segments
      expect(lvl.pathWaypoints.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < lvl.pathWaypoints.length; i++) {
        const pt = lvl.pathWaypoints[i];
        expect(pt.col).toBeGreaterThanOrEqual(0);
        expect(pt.col).toBeLessThan(lvl.cols);
        expect(pt.row).toBeGreaterThanOrEqual(0);
        expect(pt.row).toBeLessThan(lvl.rows);
        if (i > 0) {
          const prev = lvl.pathWaypoints[i - 1];
          expect(Math.hypot(pt.col - prev.col, pt.row - prev.row)).toBeGreaterThan(0);
        }
      }

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
        let worstCaseSpawns = 0;
        for (const grp of wave.groups) {
          expect(enemyTypeSet.has(grp.enemyType)).toBe(true);
          campaignEnemiesSeen.add(grp.enemyType);
          expect(Number.isInteger(grp.count) && grp.count > 0).toBe(true);
          expect(grp.spawnInterval).toBeGreaterThan(0);
          expect(grp.startDelay).toBeGreaterThanOrEqual(0);
          waveTotal += grp.count;
          const multiplier = grp.enemyType === 'splitter' || grp.enemyType === 'boss' ? 3 : 1;
          worstCaseSpawns += grp.count * multiplier;
        }
        expect(waveTotal).toBeLessThanOrEqual(BALANCE.pools.maxEnemies);
        expect(worstCaseSpawns).toBeLessThanOrEqual(BALANCE.pools.maxEnemies);
      }

      // Scripted build orders (greedy + weak) must build once per grass tile and upgrade <= tier 3
      const grid = parseLevelGrid(lvl);
      const spawns: Array<{ col: number; row: number }> = [];
      const goals: Array<{ col: number; row: number }> = [];
      const roadTiles = new Set<string>();
      for (let r = 0; r < lvl.rows; r++) {
        for (let c = 0; c < lvl.cols; c++) {
          const tile = grid[r][c];
          if (tile === 'spawn') spawns.push({ col: c, row: r });
          if (tile === 'goal') goals.push({ col: c, row: r });
          if (tile === 'path' || tile === 'spawn' || tile === 'goal') {
            roadTiles.add(`${c},${r}`);
          }
        }
      }
      expect(spawns).toEqual([lvl.pathWaypoints[0]]);
      expect(goals).toEqual([lvl.pathWaypoints[lvl.pathWaypoints.length - 1]]);

      const walked = new Set<string>();
      for (let i = 0; i < lvl.pathWaypoints.length - 1; i++) {
        const a = lvl.pathWaypoints[i];
        const b = lvl.pathWaypoints[i + 1];
        expect((a.col === b.col) !== (a.row === b.row)).toBe(true);
        const dc = Math.sign(b.col - a.col);
        const dr = Math.sign(b.row - a.row);
        let c = a.col;
        let r = a.row;
        while (true) {
          const key = `${c},${r}`;
          const isJoin = i > 0 && c === a.col && r === a.row;
          if (!isJoin) {
            expect(walked.has(key)).toBe(false);
            walked.add(key);
          }
          expect(roadTiles.has(key)).toBe(true);
          if (c === b.col && r === b.row) break;
          c += dc;
          r += dr;
        }
      }
      expect(walked.size).toBe(roadTiles.size);

      const grassCount = grid.reduce(
        (acc, row) => acc + row.filter((cell) => cell === 'grass').length,
        0,
      );
      expect(grassCount).toBeGreaterThanOrEqual(10);

      // Every island must have buildable tiles within Tier-1 ground and anti-air tower reach
      const samplePathDist = (path: CompiledPath, wx: number, wz: number): number => {
        let best = Infinity;
        for (let d = 0; d <= path.totalLength; d += 0.5) {
          path.sample(d, sampleVec);
          best = Math.min(best, Math.hypot(sampleVec.x - wx, sampleVec.z - wz));
        }
        return best;
      };
      let groundReachableGrass = 0;
      let airReachableGrass = 0;
      for (let r = 0; r < lvl.rows; r++) {
        for (let c = 0; c < lvl.cols; c++) {
          if (grid[r][c] !== 'grass') continue;
          const wx = gridToWorldX(c, lvl.cols);
          const wz = gridToWorldZ(r, lvl.rows);
          if (samplePathDist(ground, wx, wz) <= maxGroundRange) groundReachableGrass++;
          if (samplePathDist(flight, wx, wz) <= maxAntiAirRange) airReachableGrass++;
        }
      }
      expect(groundReachableGrass).toBeGreaterThanOrEqual(1);
      expect(airReachableGrass).toBeGreaterThanOrEqual(1);

      for (const order of [lvl.scriptedBuildOrder ?? [], lvl.weakBuildOrder ?? []]) {
        const tiersByTile = new Map<string, number>();
        let prevWaveIndex = 0;
        for (const act of order) {
          expect(act.waveIndex).toBeGreaterThanOrEqual(prevWaveIndex);
          expect(act.waveIndex).toBeLessThan(lvl.waves.length);
          prevWaveIndex = act.waveIndex;
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
    });

    for (const type of ENEMY_TYPES) {
      expect(campaignEnemiesSeen.has(type), `EnemyType "${type}" never spawned in campaign`).toBe(true);
    }
  });
});

describe('BALANCE constants and Kenney public asset contracts', () => {
  it('enforces valid simulation, economy, and pool constants in BALANCE', () => {
    expect(BALANCE.tileSize).toBeGreaterThan(0);
    expect(BALANCE.flyerHeight).toBeGreaterThan(BALANCE.tileGrassTopY);
    expect(BALANCE.tileGrassTopY).toBeGreaterThan(BALANCE.tilePathTopY);
    expect(BALANCE.tilePathTopY).toBeGreaterThan(BALANCE.waterPlaneY);
    expect(BALANCE.fixedDt).toBeCloseTo(1 / 60, 10);
    expect(BALANCE.maxFrameDt).toBeGreaterThanOrEqual(BALANCE.fixedDt);
    expect(BALANCE.startingLives).toBeGreaterThan(0);
    expect(BALANCE.sellRefundRatio).toBeGreaterThan(0);
    expect(BALANCE.sellRefundRatio).toBeLessThanOrEqual(1);
    expect(BALANCE.earlyWaveBonusMaxGold).toBeGreaterThan(0);
    expect(BALANCE.interWaveCountdownSec).toBeGreaterThan(0);
    expect(BALANCE.minArmorDamage).toBeGreaterThanOrEqual(1);
    expect(BALANCE.starThresholds.twoStarsMinLives).toBeGreaterThan(0);
    expect(BALANCE.starThresholds.threeStarsMinLives).toBeGreaterThan(
      BALANCE.starThresholds.twoStarsMinLives,
    );
    expect(BALANCE.starThresholds.threeStarsMinLives).toBeLessThanOrEqual(BALANCE.startingLives);
    expect(BALANCE.maxSlowRatio).toBeGreaterThan(0);
    expect(BALANCE.maxSlowRatio).toBeLessThan(1);
    expect(BALANCE.spatialHashCellSize).toBeGreaterThan(0);
    expect(BALANCE.pools.maxEnemies).toBeGreaterThan(0);
    expect(BALANCE.pools.maxProjectiles).toBeGreaterThan(0);
    expect(BALANCE.pools.maxShards).toBeGreaterThan(0);
    expect(BALANCE.pools.maxParticles).toBeGreaterThan(0);
    expect(BALANCE.pools.maxLightningArcs).toBeGreaterThan(0);
    expect(BALANCE.pools.maxPulseRings).toBeGreaterThan(0);
    expect(BALANCE.pools.maxFloatingTexts).toBeGreaterThan(0);
  });

  it('verifies every KENNEY_MODEL_LIST GLB binary/JSON mesh structure, render references, and colormap texture', () => {
    expect(new Set(KENNEY_MODEL_LIST).size).toBe(KENNEY_MODEL_LIST.length);
    const kenneySet = new Set<string>(KENNEY_MODEL_LIST);
    const kenneyRoot = resolve(process.cwd(), 'public/models/kenney');
    const colormapStat = statSync(resolve(kenneyRoot, 'Textures/colormap.png'));
    expect(colormapStat.size).toBeGreaterThan(100);

    for (const modelName of KENNEY_MODEL_LIST) {
      const filePath = resolve(kenneyRoot, `${modelName}.glb`);
      const buf = readFileSync(filePath);
      expect(buf.length, `${modelName}.glb empty`).toBeGreaterThanOrEqual(20);
      expect(buf.subarray(0, 4).toString('ascii'), `${modelName}.glb invalid GLB magic`).toBe('glTF');
      expect(buf.readUInt32LE(4), `${modelName}.glb unsupported GLB version`).toBe(2);
      expect(buf.readUInt32LE(8), `${modelName}.glb truncated or mismatched byte length`).toBe(buf.byteLength);

      const jsonLen = buf.readUInt32LE(12);
      const jsonType = buf.readUInt32LE(16);
      expect(jsonType, `${modelName}.glb chunk 0 must be JSON`).toBe(0x4e4f534a);
      expect(20 + jsonLen).toBeLessThanOrEqual(buf.byteLength);
      const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
        meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number> }> }>;
        accessors?: Array<{ count?: number }>;
        bufferViews?: Array<{ byteOffset?: number; byteLength?: number }>;
        buffers?: Array<{ byteLength?: number }>;
      };
      expect(Array.isArray(gltf.meshes) && gltf.meshes.length > 0, `${modelName}.glb missing meshes`).toBe(true);
      expect(Array.isArray(gltf.accessors) && gltf.accessors.length > 0, `${modelName}.glb missing accessors`).toBe(true);
      const firstPosAccIdx = gltf.meshes![0].primitives?.[0]?.attributes?.POSITION;
      expect(typeof firstPosAccIdx, `${modelName}.glb primitive missing POSITION`).toBe('number');
      expect(gltf.accessors![firstPosAccIdx!]?.count ?? 0, `${modelName}.glb empty POSITION accessor`).toBeGreaterThan(0);

      if (20 + jsonLen + 8 <= buf.byteLength) {
        const binLen = buf.readUInt32LE(20 + jsonLen);
        const binType = buf.readUInt32LE(20 + jsonLen + 4);
        expect(binType, `${modelName}.glb chunk 1 must be BIN`).toBe(0x004e4942);
        expect(20 + jsonLen + 8 + binLen).toBeLessThanOrEqual(buf.byteLength);
        if (gltf.buffers?.[0]?.byteLength !== undefined) {
          expect(binLen).toBeGreaterThanOrEqual(gltf.buffers[0].byteLength);
        }
      }
    }

    // Verify every Kenney model name referenced in src/render/ is registered in KENNEY_MODEL_LIST
    const renderFiles = collectTsFiles(resolve(process.cwd(), 'src/render'));
    const refRegex = /\b(?:cloneGeometry|grab|frostBase|teslaSquare|mortarSquare)\(\s*['"]([a-z0-9-]+)['"]/g;
    let totalRefs = 0;
    for (const filePath of renderFiles) {
      const code = stripComments(readFileSync(filePath, 'utf8'));
      for (const match of code.matchAll(refRegex)) {
        totalRefs++;
        expect(
          kenneySet.has(match[1]),
          `${filePath} references unregistered Kenney model "${match[1]}"`,
        ).toBe(true);
      }
    }
    expect(totalRefs).toBeGreaterThan(20);
  });
});

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (ent.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('simulation determinism and endless scaling safety contracts', () => {
  it('forbids nondeterministic RNG/clock APIs and Three.js imports in src/core, src/data, and src/sim', () => {
    const dirs = ['src/core', 'src/data', 'src/sim'].map((d) => resolve(process.cwd(), d));
    const files = dirs.flatMap(collectTsFiles);
    expect(files.length).toBeGreaterThan(10);

    const importForbiddenPatterns: Array<{ name: string; regex: RegExp }> = [
      { name: 'three import', regex: /from\s+['"]three(?:\/[^'"]*)?['"]/ },
      {
        name: 'browser layer import',
        regex: /from\s+['"][^'"]*\/(?:render|ui|platform|audio)\/[^'"]*['"]/,
      },
    ];
    const codeForbiddenPatterns: Array<{ name: string; regex: RegExp }> = [
      { name: 'Math.random', regex: /\bMath\.random\b/ },
      { name: 'Date.now', regex: /\bDate\.now\b/ },
      { name: 'performance.now', regex: /\bperformance\.now\b/ },
      { name: 'crypto randomness', regex: /\bcrypto\.(randomUUID|getRandomValues)\b/ },
      { name: 'non-deterministic timers or Date', regex: /\b(?:setTimeout|setInterval)\b|\bnew\s+Date\b/ },
      {
        name: 'browser or network global (window/document/navigator/storage/rAF/DOM/AudioContext/fetch/WS)',
        regex: /\b(?:window|document|navigator|globalThis|localStorage|sessionStorage|indexedDB|fetch|WebSocket|XMLHttpRequest|requestAnimationFrame|cancelAnimationFrame|HTMLElement|HTMLCanvasElement|PointerEvent|KeyboardEvent|WheelEvent|AudioContext)\b/,
      },
    ];

    for (const filePath of files) {
      const code = stripComments(readFileSync(filePath, 'utf8'));
      const codeNoStrings = code.replace(/(['"`])(?:\\.|(?!\1)[^\\\r\n])*\1/g, '""');
      for (const { name, regex } of importForbiddenPatterns) {
        expect(regex.test(code), `${filePath} must not use ${name}`).toBe(false);
      }
      for (const { name, regex } of codeForbiddenPatterns) {
        expect(regex.test(codeNoStrings), `${filePath} must not use ${name}`).toBe(false);
      }
    }
  });

  it('keeps single-wave endless spawns within maxEnemies pool capacity across all islands and extreme offsets', () => {
    const enemyTypeSet = new Set<string>(ENEMY_TYPES);
    const offsets = [0, 4, 19, 49, 99];

    for (const lvl of LEVELS) {
      for (const offset of offsets) {
        const wave = buildEndlessWaveDef(lvl.waves.length + offset, lvl);
        expect(wave.clearBonus).toBeGreaterThan(0);
        expect(wave.groups.length).toBeGreaterThan(0);

        let worstCaseSpawns = 0;
        for (const grp of wave.groups) {
          expect(enemyTypeSet.has(grp.enemyType)).toBe(true);
          expect(Number.isInteger(grp.count) && grp.count > 0).toBe(true);
          expect(grp.spawnInterval).toBeGreaterThanOrEqual(0.18);
          expect(grp.startDelay).toBeGreaterThanOrEqual(0);
          const mult = grp.enemyType === 'splitter' || grp.enemyType === 'boss' ? 3 : 1;
          worstCaseSpawns += grp.count * mult;
        }
        expect(
          worstCaseSpawns,
          `Endless offset +${offset} on ${lvl.id} worst-case ${worstCaseSpawns} > ${BALANCE.pools.maxEnemies}`,
        ).toBeLessThanOrEqual(BALANCE.pools.maxEnemies);
      }
    }
  });

  it('validates targeting modes and distinct endpoints on every level', () => {
    const validTargets = new Set(['first', 'last', 'strongest', 'closest']);
    for (const lvl of LEVELS) {
      const firstWp = lvl.pathWaypoints[0];
      const lastWp = lvl.pathWaypoints[lvl.pathWaypoints.length - 1];
      expect(firstWp.col === lastWp.col && firstWp.row === lastWp.row).toBe(false);

      const firstFp = lvl.flightPath[0];
      const lastFp = lvl.flightPath[lvl.flightPath.length - 1];
      expect(firstFp.col === lastFp.col && firstFp.row === lastFp.row).toBe(false);

      for (const act of [...(lvl.scriptedBuildOrder ?? []), ...(lvl.weakBuildOrder ?? [])]) {
        expect(Number.isInteger(act.waveIndex)).toBe(true);
        if (act.targetingMode !== undefined) {
          expect(validTargets.has(act.targetingMode)).toBe(true);
        }
        if (act.action === 'upgrade') {
          expect(act.targetingMode).toBeUndefined();
        }
      }
    }
  });

  it('parseTileChar falls back to empty and parseLevelGrid pads short/missing rows with empty', () => {
    expect(parseTileChar('.')).toBe('grass');
    expect(parseTileChar('T')).toBe('decor');
    expect(parseTileChar('P')).toBe('path');
    expect(parseTileChar('S')).toBe('spawn');
    expect(parseTileChar('G')).toBe('goal');
    expect(parseTileChar('~')).toBe('empty');
    expect(parseTileChar('?')).toBe('empty');
    expect(parseTileChar('')).toBe('empty');

    const grid = parseLevelGrid({
      ...LEVELS[0],
      cols: 4,
      rows: 3,
      layout: ['S .', 'P ? G'],
    });
    expect(grid).toEqual([
      ['spawn', 'grass', 'empty', 'empty'],
      ['path', 'empty', 'goal', 'empty'],
      ['empty', 'empty', 'empty', 'empty'],
    ]);
  });
});
