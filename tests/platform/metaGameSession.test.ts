import { afterEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { SoundManager } from '../../src/audio/soundManager.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { TOWER_TYPES } from '../../src/data/towers.ts';
import type { GameLoop } from '../../src/platform/browserLoop.ts';
import { GameSession, type SessionRuntimeDeps } from '../../src/platform/gameSession.ts';
import type { InputManager } from '../../src/platform/input.ts';
import { updatePlacementPreviewFromNdc } from '../../src/platform/sessionBridge.ts';
import type { RenderWorld } from '../../src/render/renderWorld.ts';
import { createDefaultMetaSave } from '../../src/sim/meta/metaEngine.ts';
import type { GameOverlays } from '../../src/ui/gameOverlays.ts';

function installMockLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  return store;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

function createStubEnv() {
  const placementCalls: Array<{ visible: boolean; type: string | null; valid: boolean }> = [];
  const menuCalls: Array<{ screen: 'menu' | 'levelSelect'; open: boolean; unlocked: number }> = [];
  const outcomeWinCalls: Array<{ levelId: string; hasNext: boolean }> = [];
  const hitPos = new Vector3();

  const renderWorld = {
    setQuality: () => {},
    loadLevel: () => {},
    setHoveredTowerId: () => {},
    setCanvasCursor: () => {},
    setPlacementGridActive: () => {},
    setFlightPathHighlight: () => {},
    setRoutesPinned: () => {},
    setMeteorTargetPreview: () => {},
    setPlacementPreview: (visible: boolean, type: string | null, _x: number, _z: number, valid: boolean) => {
      placementCalls.push({ visible, type, valid });
    },
    pickTowerAtNdc: () => null,
    cameraController: {
      setShowcaseMode: () => {},
      screenNdcToPlane: () => hitPos,
    },
    overlayIndicators: {
      setSelectedTowerRing: () => {},
    },
  } as unknown as RenderWorld;

  const soundManager = {
    unlock: () => {},
    bindEvents: () => () => {},
    updateSettings: () => {},
  } as unknown as SoundManager;

  const overlays = {
    isModalOpen: () => false,
    setPlayVisibility: () => {},
    syncInPlay: () => {},
    closeModals: () => {},
    floatingTextPool: {
      clear: () => {},
      spawnDamage: () => {},
      spawnGold: () => {},
      spawnUpgradeTier: () => {},
    },
    tooltip: { hide: () => {} },
    toast: { hide: () => {}, show: () => {} },
    towerPanel: { setSellConfirmArmed: () => {} },
    outcomeOverlay: {
      showWin: (level: { id: string }, _stars: number, _lives: number, _kills: number, hasNext: boolean) => {
        outcomeWinCalls.push({ levelId: level.id, hasNext });
      },
      showLose: () => {},
      isOpen: () => false,
    },
    pauseMenu: { setOpen: () => {} },
    settingsModal: { setOpen: () => {} },
    mainMenu: {
      setOpen: (open: boolean, progress?: { unlockedLevelIndex: number }) => {
        menuCalls.push({ screen: 'menu', open, unlocked: progress?.unlockedLevelIndex ?? -1 });
      },
    },
    levelSelect: {
      setOpen: (open: boolean, progress?: { unlockedLevelIndex: number }) => {
        menuCalls.push({ screen: 'levelSelect', open, unlocked: progress?.unlockedLevelIndex ?? -1 });
      },
    },
  } as unknown as GameOverlays;

  const deps: SessionRuntimeDeps = {
    overlays,
    inputManager: { setEnabled: () => {}, setModalOpen: () => {} } as unknown as InputManager,
    loop: {
      speed: 1,
      simActive: false,
      paused: false,
      resetAccumulator: () => {},
    } as unknown as GameLoop,
    setDebugVisible: () => {},
  };

  return { renderWorld, soundManager, deps, placementCalls, menuCalls, outcomeWinCalls, hitPos };
}

function runScriptedLevelThroughSession(
  session: GameSession,
  levelIndex: number,
  maxSeconds = 1200,
): void {
  const level = LEVELS[levelIndex];
  const legal = session.getAllowedTowerTypes();
  const queue = (level.scriptedBuildOrder ?? []).map((a) => {
    if (a.action !== 'build' || !a.towerType || legal.includes(a.towerType)) return a;
    const sub =
      legal.find((t) => t === 'archer' || t === 'tesla') ??
      legal[0];
    return { ...a, towerType: sub };
  });

  const stepBuild = (): boolean => {
    while (queue.length > 0) {
      const a = queue[0];
      if (a.action === 'build' && a.towerType) {
        if (session.simWorld.gold < session.getTowerBuildCost(a.towerType)) return false;
        if (session.simWorld.placeTower(a.col, a.row, a.towerType, a.targetingMode ?? 'first')) {
          queue.shift();
          return true;
        }
        queue.shift();
        continue;
      }
      const tid = session.simWorld.grid.getTowerIdAt(a.col, a.row);
      const tw = tid === -1 ? null : session.simWorld.getTowerById(tid);
      if (!tw || tw.tier >= 3) {
        queue.shift();
        continue;
      }
      const uc = session.getTowerUpgradeCost(tw.id);
      if (uc === null || session.simWorld.gold < uc) return false;
      if (session.simWorld.upgradeTower(tw.id)) {
        queue.shift();
        return true;
      }
      queue.shift();
    }
    for (const tw of session.simWorld.towers) {
      const uc = session.getTowerUpgradeCost(tw.id);
      if (uc !== null && session.simWorld.gold >= uc) {
        session.simWorld.upgradeTower(tw.id);
        return true;
      }
    }
    return false;
  };

  while (stepBuild()) {
    // initial pre-wave setup
  }
  session.simWorld.startNextWave();
  for (let t = 0; t < 60 * maxSeconds && session.simWorld.outcome === 'ongoing'; t++) {
    if (session.simWorld.waveSystem.state === 'betweenWaves' && session.simWorld.waveSystem.canStartNextWave()) {
      while (stepBuild()) {
        // between-wave build/upgrade
      }
      session.simWorld.startNextWave();
    } else if (t % (60 * 3) === 0) {
      stepBuild();
    }
    if (session.simWorld.waveSystem.state !== 'preFirstWave') {
      if (
        session.simWorld.abilitySystem.canCast('overcharge') &&
        (session.simWorld.towers.some((tw) => tw.stunTimer > 0) || session.simWorld.enemyPool.getActiveCount() >= 8)
      ) {
        session.simWorld.castOvercharge();
      }
      if (session.simWorld.abilitySystem.canCast('meteor') && session.simWorld.enemyPool.getActiveCount() > 0) {
        const idx0 = session.simWorld.enemyPool.getActiveIndex(0);
        const target = session.simWorld.enemyPool.items[idx0];
        session.simWorld.castMeteor(target.x, target.z);
      }
    }
    session.fixedTick(BALANCE.fixedDt);
  }
}

describe('GameSession and sessionBridge meta wiring', () => {
  it('enforces tower bans, cost scaling, restartCurrentRun, save import menu sync, and pendingDebugSpawns taint', () => {
    installMockLocalStorage();
    const { renderWorld, soundManager, deps, placementCalls, menuCalls, hitPos } = createStubEnv();
    const session = new GameSession(renderWorld, soundManager);
    session.attachRuntime(deps);

    // Start a daily run with restricted towers and scaled costs (find a date with a banned tower dynamically)
    let banDate = '2026-07-13';
    for (let d = 1; d <= 31; d++) {
      const cand = `2026-07-${String(d).padStart(2, '0')}`;
      if (session.getDailyChallenge(cand).modifiers.forbiddenTowerTypes.length > 0) {
        banDate = cand;
        break;
      }
    }
    const spec = session.startDailyChallenge(banDate);
    expect(session.viewMode).toBe('playing');
    expect(session.getActiveDailyChallenge()?.date).toBe(banDate);

    // Placement mode blocks banned towers
    const bannedTower = spec.modifiers.forbiddenTowerTypes[0]!;
    expect(session.isTowerAllowed(bannedTower)).toBe(false);
    session.setPlacementMode(bannedTower);
    expect(session.getAllowedTowerTypes()).not.toContain(bannedTower);

    // restartCurrentRun preserves active daily date and modifiers
    session.restartCurrentRun();
    expect(session.getActiveDailyChallenge()?.date).toBe(banDate);

    // startMutatedLevel with tight_budget updates build & upgrade costs and placement preview validity
    session.startMutatedLevel(0, ['tight_budget']);
    expect(session.getActiveDailyChallenge()).toBeNull();
    expect(session.getActiveRunModifiers()?.towerCostMultiplier).toBe(1.15);
    const scaledBuildCost = Math.round(50 * 1.15);
    expect(session.getTowerBuildCost('archer')).toBe(scaledBuildCost);
    const archer = session.simWorld.placeTower(4, 2, 'archer')!;
    expect(archer).not.toBeNull();
    expect(session.getTowerUpgradeCost(archer.id)).toBe(Math.round(55 * 1.15));

    // updatePlacementPreviewFromNdc checks towerCostMultiplier & bans
    hitPos.set(
      session.simWorld.grid.gridToWorldX(4),
      0,
      session.simWorld.grid.gridToWorldZ(3),
    );
    session.simWorld.gold = 55; // >= base 50, but < scaled 57!
    placementCalls.length = 0;
    updatePlacementPreviewFromNdc(true, 'archer', 0, 0, renderWorld, session.simWorld);
    expect(placementCalls[placementCalls.length - 1]?.valid).toBe(false);

    session.simWorld.gold = scaledBuildCost;
    updatePlacementPreviewFromNdc(true, 'archer', 0, 0, renderWorld, session.simWorld);
    expect(placementCalls[placementCalls.length - 1]?.valid).toBe(true);

    // Queued pendingDebugSpawns taints run on fixedTick even before spawn delay expires
    session.startLevel(0);
    expect(session.meta.isCurrentRunEligible()).toBe(true);
    session.pendingDebugSpawns.push({ type: 'grunt', delay: 5 });
    session.fixedTick(BALANCE.fixedDt);
    expect(session.meta.isCurrentRunEligible()).toBe(false);

    // importMetaSaveJson refreshes menu/levelSelect overlays when not playing
    session.showMenuView('menu', true);
    menuCalls.length = 0;
    const upgradedSave = createDefaultMetaSave(LEVELS.length);
    upgradedSave.campaign.unlockedLevelIndex = 4;
    upgradedSave.campaign.bestStars[0] = 3;
    expect(session.importMetaSaveJson(JSON.stringify(upgradedSave), 'merge').ok).toBe(true);
    expect(menuCalls).toEqual([
      { screen: 'menu', open: true, unlocked: 4 },
      { screen: 'levelSelect', open: false, unlocked: 4 },
    ]);

    session.dispose();
  });

  it('completes campaign + endless, isolates daily -> endless outcomes, and blocks debug tampering end-to-end', () => {
    installMockLocalStorage();
    const { renderWorld, soundManager, deps, outcomeWinCalls } = createStubEnv();
    const session = new GameSession(renderWorld, soundManager);
    session.attachRuntime(deps);

    // Non-finite / out-of-range startLevel clamps cleanly
    session.startLevel(Number.NaN);
    expect(session.currentLevelIndex).toBe(0);
    session.startLevel(999);
    expect(session.currentLevelIndex).toBe(LEVELS.length - 1);

    // 1. Clean campaign win on Island 1 -> awards campaign stars, unlocks Island 2, populates outcome & live states,
    //    and allows mutated Endless continuation with banned tower placement cleared
    session.startLevel(0);
    session.setSpeed(3);
    runScriptedLevelThroughSession(session, 0, 600);
    expect(session.simWorld.outcome).toBe('won');
    expect(outcomeWinCalls[outcomeWinCalls.length - 1]).toEqual({
      levelId: LEVELS[0].id,
      hasNext: true,
    });
    expect(session.progress.bestStars[0]).toBeGreaterThanOrEqual(1);
    expect(session.progress.unlockedLevelIndex).toBeGreaterThanOrEqual(1);
    const winOutcome = session.getLastRunMetaOutcome()!;
    expect(winOutcome.won).toBe(true);
    expect(winOutcome.isDaily).toBe(false);
    expect(session.getChallengeStatus(0)!.earnedStars).toBeGreaterThanOrEqual(1);
    expect(session.getLiveChallengeStates().length).toBe(3);
    expect(session.getTowerMasteryStats()).toHaveLength(TOWER_TYPES.length);
    expect(session.getTowerMasteryStats().some((t) => t.builtCount > 0)).toBe(true);
    expect(session.getEnemyIntelStats()).toHaveLength(ENEMY_TYPES.length);
    expect(session.getEnemyIntelStats().some((e) => e.discovered)).toBe(true);

    // Arm frost placement before entering Lean Siege Endless (which bans frost) -> cleared cleanly,
    // and endlessEntered listeners already observe the new Endless modifiers & badges immediately.
    let endlessListenerAllowedFrost: boolean | null = null;
    let endlessListenerBadges: string[] = [];
    session.events.on('endlessEntered', () => {
      endlessListenerAllowedFrost = session.isTowerAllowed('frost');
      endlessListenerBadges = session.getActiveModifierBadges().map((b) => b.id);
    });
    session.setPlacementMode('frost');
    session.enterEndlessMode({ presetId: 'lean-siege' });
    expect(endlessListenerAllowedFrost).toBe(false);
    expect(endlessListenerBadges).toEqual(['tight_budget', 'no_frost']);
    expect(session.getAllowedTowerTypes()).not.toContain('frost');
    expect(session.getActiveModifierBadges().map((b) => b.id)).toEqual(['tight_budget', 'no_frost']);
    session.simWorld.startNextWave();
    for (let t = 0; t < 60 * 120 && session.simWorld.waveSystem.currentWaveOneBased <= LEVELS[0].waves.length; t++) {
      session.fixedTick(BALANCE.fixedDt);
    }
    expect(session.getLiveEndlessScore()).not.toBeNull();
    // Simulate quitting Endless after reaching Endless wave -> preserves bestEndlessWaves without gamesLost
    session.showMenuView('menu', true);
    expect(session.progress.bestEndlessWaves[0]).toBeGreaterThan(LEVELS[0].waves.length);
    expect(session.getStats().gamesLost).toBe(0);

    // 2. Daily Watch win on a locked high island does NOT unlock locked islands, and Endless continuation clears active daily
    let dailyDate = '2026-11-17';
    for (let d = 1; d <= 30; d++) {
      const candidate = `2026-11-${String(d).padStart(2, '0')}`;
      const candSpec = session.getDailyChallenge(candidate);
      if (
        candSpec.levelIndex >= 2 &&
        LEVELS[candSpec.levelIndex].difficulty === 'Challenging' &&
        (LEVELS[candSpec.levelIndex].scriptedBuildOrder?.length ?? 0) > 0
      ) {
        dailyDate = candidate;
        break;
      }
    }
    const lockedBeforeDaily = session.progress.unlockedLevelIndex;
    const spec = session.startDailyChallenge(dailyDate);
    expect(spec.levelIndex).toBeGreaterThanOrEqual(2);
    expect(session.getActiveDailyChallenge()?.date).toBe(dailyDate);
    runScriptedLevelThroughSession(session, spec.levelIndex, 1800);
    expect(session.simWorld.outcome).toBe('won');
    expect(session.progress.unlockedLevelIndex).toBe(lockedBeforeDaily);
    expect(outcomeWinCalls[outcomeWinCalls.length - 1]).toEqual({
      levelId: spec.levelId,
      hasNext: false,
    });
    expect(session.getDailyStatus(dailyDate).completedToday).toBe(true);
    expect(session.getLastRunMetaOutcome()?.isDaily).toBe(true);

    // Continuing Endless from a Daily win clears active daily banner & isolates Endless loss
    session.enterEndlessMode();
    expect(session.getActiveDailyChallenge()).toBeNull();
    session.simWorld.startNextWave();
    session.showMenuView('menu', true);
    expect(session.progress.unlockedLevelIndex).toBe(lockedBeforeDaily);

    // Daily Watch on already-unlocked Island 1 (unlockedLevelIndex >= 1) keeps Next Island enabled
    let l1DailyDate = '';
    for (let m = 1; m <= 12 && !l1DailyDate; m++) {
      for (let d = 1; d <= 28; d++) {
        const cand = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (session.getDailyChallenge(cand).levelIndex === 0) {
          l1DailyDate = cand;
          break;
        }
      }
    }
    const l1Spec = session.startDailyChallenge(l1DailyDate);
    expect(l1Spec.levelIndex).toBe(0);
    runScriptedLevelThroughSession(session, 0, 600);
    expect(session.simWorld.outcome).toBe('won');
    expect(outcomeWinCalls[outcomeWinCalls.length - 1]).toEqual({
      levelId: LEVELS[0].id,
      hasNext: true,
    });

    // 3. Verify debug cheats (?debug gold, debugSkipToWave, debugForceWin, debugForceLose) never taint progress
    session.startLevel(2); // locked/uncleared Island 3
    session.simWorld.gold += 500;
    session.fixedTick(BALANCE.fixedDt);
    expect(session.meta.isCurrentRunEligible()).toBe(false);
    session.simWorld.debugForceWin();
    expect(session.progress.bestStars[2]).toBe(0);
    expect(session.progress.unlockedLevelIndex).toBe(lockedBeforeDaily);

    session.startLevel(2);
    session.simWorld.debugSkipToWave(2);
    session.fixedTick(BALANCE.fixedDt);
    expect(session.meta.isCurrentRunEligible()).toBe(false);
    session.simWorld.debugForceLose();
    expect(session.getStats().gamesLost).toBe(0);

    // Post-win gold cheat before Endless Mode blocks Endless wave records
    session.startLevel(0);
    runScriptedLevelThroughSession(session, 0, 600);
    expect(session.simWorld.outcome).toBe('won');
    const prevBestEndlessL0 = session.progress.bestEndlessWaves[0];
    session.simWorld.gold += 9999;
    session.enterEndlessMode();
    expect(session.meta.isCurrentRunEligible()).toBe(false);
    session.simWorld.startNextWave();
    for (let t = 0; t < 60 * 400 && session.simWorld.outcome === 'ongoing'; t++) {
      session.fixedTick(BALANCE.fixedDt);
    }
    expect(session.progress.bestEndlessWaves[0]).toBe(prevBestEndlessL0);

    // 4. enterEndlessMode is a no-op before winning (even with invalid preset), and advantageous Endless modifiers taint Endless eligibility immediately
    session.startLevel(0);
    session.enterEndlessMode({ presetId: 'lean-siege' });
    expect(() => session.enterEndlessMode({ presetId: 'nonexistent-preset' })).not.toThrow();
    expect(session.simWorld.waveSystem.isEndless).toBe(false);
    expect(session.getActiveRunModifiers()?.activeMutatorIds).toEqual([]);

    runScriptedLevelThroughSession(session, 0, 600);
    expect(session.simWorld.outcome).toBe('won');
    let eligibleDuringAdvantageousEndless: boolean | null = null;
    session.events.on('endlessEntered', () => {
      eligibleDuringAdvantageousEndless = session.meta.isCurrentRunEligible();
    });
    session.enterEndlessMode({ enemyHpMultiplier: 0.5 });
    expect(eligibleDuringAdvantageousEndless).toBe(false);
    expect(session.meta.isCurrentRunEligible()).toBe(false);

    session.dispose();
  }, 15_000);
});
