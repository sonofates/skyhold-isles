import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoundManager } from '../../src/audio/soundManager.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import type { GameSettings } from '../../src/core/types.ts';
import { ABILITY_DEFS } from '../../src/data/abilities.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { CameraController } from '../../src/render/cameraController.ts';
import type { RenderWorld } from '../../src/render/renderWorld.ts';
import { getTowerPickHeight } from '../../src/render/towerPicking.ts';
import {
  bindSimEventBridge,
  updateHoverFeedback,
  updateMeteorPreviewFromNdc,
  updatePlacementPreviewFromNdc,
} from '../../src/platform/sessionBridge.ts';
import { getDefaultSettings, isTouchDevice } from '../../src/platform/storage.ts';
import type { TowerEntity } from '../../src/sim/entities.ts';
import { SimWorld } from '../../src/sim/world.ts';
import type { GameOverlays } from '../../src/ui/gameOverlays.ts';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

describe('platform touch detection and sessionBridge event/preview wiring', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('detects touch devices across navigator.maxTouchPoints, ontouchstart, and coarse pointer media query', () => {
    expect(isTouchDevice()).toBe(false);
    expect(getDefaultSettings().quality).toBe('high');

    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
    expect(isTouchDevice()).toBe(true);
    expect(getDefaultSettings().quality).toBe('low');

    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
    vi.stubGlobal('window', { ontouchstart: null });
    expect(isTouchDevice()).toBe(true);

    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }),
    });
    expect(isTouchDevice()).toBe(true);
  });

  it('bridges sim events to SoundManager, floating texts, one-time flyer toast, and win/loss callbacks', () => {
    const bus = new EventBus();
    const unbindMock = vi.fn();
    const soundManager = { bindEvents: vi.fn(() => unbindMock) } as unknown as SoundManager;

    const upgradeCalls: unknown[][] = [];
    const damageCalls: unknown[][] = [];
    const goldCalls: unknown[][] = [];
    const toastMessages: string[] = [];

    const overlays = {
      floatingTextPool: {
        spawnUpgradeTier: (...args: unknown[]) => upgradeCalls.push(args),
        spawnDamage: (...args: unknown[]) => damageCalls.push(args),
        spawnGold: (...args: unknown[]) => goldCalls.push(args),
      },
      toast: {
        show: (msg: string) => toastMessages.push(msg),
      },
    } as unknown as GameOverlays;

    const settings: GameSettings = {
      masterVolume: 0.7,
      muted: false,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    };

    const syncCalls: number[] = [];
    const wins: Array<{ stars: number; lives: number }> = [];
    const losses: Array<{ waveIndex: number; endless?: boolean }> = [];

    const unbind = bindSimEventBridge({
      bus,
      soundManager,
      overlays,
      getSettings: () => settings,
      getSimClock: () => 12.5,
      onSyncUi: () => syncCalls.push(1),
      onGameWon: (stars, lives) => wins.push({ stars, lives }),
      onGameLost: (waveIndex, endless) => losses.push({ waveIndex, endless }),
    });

    // Sync triggers
    bus.emit('economyChanged', { gold: 100, lives: 20 });
    bus.emit('waveStarted', { waveIndex: 0, totalWaves: 10, earlyBonus: 0 });
    bus.emit('waveCompleted', { waveIndex: 0, bonus: 30 });
    bus.emit('towerBuilt', { towerId: 1, type: 'archer', tier: 1, x: 2, z: 4 });
    bus.emit('towerSold', { towerId: 1, type: 'archer', refund: 35, x: 2, z: 4 });
    expect(syncCalls).toHaveLength(5);

    // Tier 2 upgrade spawns floating tier badge at pick height + 0.35
    bus.emit('towerUpgraded', { towerId: 2, type: 'frost', tier: 2, x: 3, z: -1 });
    expect(upgradeCalls).toEqual([[2, 3, getTowerPickHeight('frost', 2) + 0.35, -1, 12.5]]);

    // Flyer toast fires only once across multiple flyer spawns, never for ground enemies
    bus.emit('enemySpawned', { enemyId: 1, enemyType: 'grunt', flying: false });
    bus.emit('enemySpawned', { enemyId: 2, enemyType: 'flyer', flying: true });
    bus.emit('enemySpawned', { enemyId: 3, enemyType: 'flyer', flying: true });
    expect(toastMessages).toHaveLength(1);

    // Damage numbers obey settings.damageNumbers and mark boss / >= 55 dmg as crit
    bus.emit('enemyHit', { enemyId: 1, enemyType: 'grunt', damage: 18, x: 1, y: 1, z: 1, isBoss: false });
    bus.emit('enemyHit', { enemyId: 2, enemyType: 'boss', damage: 10, x: 2, y: 1, z: 2, isBoss: true });
    bus.emit('enemyHit', { enemyId: 3, enemyType: 'brute', damage: 60, x: 3, y: 1, z: 3, isBoss: false });
    settings.damageNumbers = false;
    bus.emit('enemyHit', { enemyId: 4, enemyType: 'grunt', damage: 25, x: 4, y: 1, z: 4, isBoss: false });
    expect(damageCalls).toEqual([
      [1, 18, 1, 1, 1, 12.5, false],
      [2, 10, 2, 1, 2, 12.5, true],
      [3, 60, 3, 1, 3, 12.5, true],
    ]);

    bus.emit('enemyKilled', { enemyId: 1, enemyType: 'grunt', reward: 4, x: 1, y: 0.6, z: 1 });
    expect(goldCalls).toEqual([[4, 1, 0.95, 1, 12.5]]);

    bus.emit('gameWon', { stars: 3, livesRemaining: 20 });
    bus.emit('gameLost', { waveIndex: 11, endless: true });
    expect(wins).toEqual([{ stars: 3, lives: 20 }]);
    expect(losses).toEqual([{ waveIndex: 11, endless: true }]);

    unbind();
    expect(unbindMock).toHaveBeenCalledTimes(1);
  });

  it('updates meteor preview, placement preview, and hover feedback across towers, enemies, and clear states', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    world.gold = 200;
    const cam = new CameraController(1280, 720);
    cam.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);

    const meteorPreviewCalls: unknown[][] = [];
    const placementPreviewCalls: unknown[][] = [];
    const hoveredTowerIds: Array<number | null> = [];
    const cursors: string[] = [];
    let pickedTower: TowerEntity | null = null;

    const renderWorld = {
      cameraController: cam,
      setMeteorTargetPreview: (...args: unknown[]) => meteorPreviewCalls.push(args),
      setPlacementPreview: (...args: unknown[]) => placementPreviewCalls.push(args),
      pickTowerAtNdc: () => pickedTower,
      setHoveredTowerId: (id: number | null) => hoveredTowerIds.push(id),
      setCanvasCursor: (c: string) => cursors.push(c),
    } as unknown as RenderWorld;

    // Meteor preview active vs inactive
    updateMeteorPreviewFromNdc(false, 'meteor', 0, 0, renderWorld);
    updateMeteorPreviewFromNdc(true, 'meteor', 0, 0, renderWorld);
    expect(meteorPreviewCalls[0]).toEqual([false, 0, 0, 1]);
    expect(meteorPreviewCalls[1][0]).toBe(true);
    expect(meteorPreviewCalls[1][3]).toBe(ABILITY_DEFS.meteor.radius);

    // Placement preview clears when hovering over an existing tower or inactive, and snaps valid grass tiles
    const placed = world.placeTower(4, 2, 'archer')!;
    pickedTower = placed;
    updatePlacementPreviewFromNdc(true, 'archer', 0, 0, renderWorld, world);
    expect(placementPreviewCalls[0]).toEqual([false, null, 0, 0, false]);

    pickedTower = null;
    // Project grass tile (4, 3) to NDC so screenNdcToPlane hits (wx, 0, wz) exactly
    const wx = world.grid.gridToWorldX(4);
    const wz = world.grid.gridToWorldZ(3);
    const proj = new THREE.Vector3(wx, 0, wz).project(cam.camera);
    updatePlacementPreviewFromNdc(true, 'archer', proj.x, proj.y, renderWorld, world);
    expect(placementPreviewCalls[1]).toEqual([true, 'archer', wx, wz, true]);

    // Hover feedback: tower tooltip vs selected tower hiding vs enemy tooltip vs outside pointer
    const tooltipCalls: Array<{ kind: string; id?: number }> = [];
    const overlays = {
      tooltip: {
        hide: () => tooltipCalls.push({ kind: 'hide' }),
        showTower: (t: TowerEntity) => tooltipCalls.push({ kind: 'tower', id: t.id }),
        show: (e: { uid: number }) => tooltipCalls.push({ kind: 'enemy', id: e.uid }),
      },
    } as unknown as GameOverlays;

    // Outside canvas clears hover and hides tooltip
    updateHoverFeedback(true, false, false, false, 0, 0, 10, 10, renderWorld, world, overlays);
    expect(hoveredTowerIds[hoveredTowerIds.length - 1]).toBeNull();
    expect(cursors[cursors.length - 1]).toBe('');
    expect(tooltipCalls[tooltipCalls.length - 1]).toEqual({ kind: 'hide' });

    // Hovering unselected tower shows tower tooltip; hovering selected tower hides tooltip
    pickedTower = placed;
    updateHoverFeedback(true, true, false, false, 0, 0, 10, 10, renderWorld, world, overlays, null);
    expect(tooltipCalls[tooltipCalls.length - 1]).toEqual({ kind: 'tower', id: placed.id });
    updateHoverFeedback(true, true, false, false, 0, 0, 10, 10, renderWorld, world, overlays, placed.id);
    expect(tooltipCalls[tooltipCalls.length - 1]).toEqual({ kind: 'hide' });

    // Hovering ground enemy shows enemy tooltip
    pickedTower = null;
    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    grunt.x = wx;
    grunt.z = wz;
    world.spatialHash.clear();
    world.spatialHash.insert(grunt.poolIndex, grunt.x, grunt.z);
    updateHoverFeedback(true, true, false, false, proj.x, proj.y, 10, 10, renderWorld, world, overlays);
    expect(tooltipCalls[tooltipCalls.length - 1]).toEqual({ kind: 'enemy', id: grunt.uid });
  });
});
