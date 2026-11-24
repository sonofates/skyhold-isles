import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetMusicPrefsCache, setMusicVolume } from '../../src/audio/musicPrefs.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import type { TowerType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import {
  CHALLENGE_IDS,
  CHALLENGE_IDS_2D,
  CHALLENGES,
  challengesForLevel,
  isChallengeEffectiveIn2D,
  isChallengeId,
  runModifiersFor,
  type ChallengeId,
} from '../../src/data/challenges.ts';
import { dailyChallengeFor, dailyPairAllowed, isStrongRule, utcDayNumber } from '../../src/data/daily.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { LEVEL_L1C, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { hasModifierEffectIn2D, NEUTRAL_RUN_MODIFIERS } from '../../src/data/runModifiers.ts';
import { maxedWorkshopRanks, workshopModifiers } from '../../src/data/workshop.ts';
import { starWallet } from '../../src/game/progression.ts';
import { createDefaultProgress, getDefaultSettings, saveSettings } from '../../src/platform/storage.ts';
import {
  audioSettings2d,
  createDamagePopupPool2D,
  createShakeState2D,
  DAMAGE_POPUP_DURATION_SEC,
  MAX_SHAKE_UNITS_2D,
  shouldShake2D,
  shouldShowDamageNumbers2D,
  shouldVibrate2D,
  spawnDamageNumber2D,
  stepDamageNumbers2D,
  stepShake2D,
  triggerShake2D,
} from '../../src/render2d/settings2d.ts';
import {
  abilityGate,
  abilitySlotView,
  castMeteor2D,
  castOvercharge2D,
} from '../../src/render2d/ui/abilities2d.ts';
import {
  availableChallenges,
  buildRunHref2D,
  DAILY_LINK_GRACE_MS,
  canPlayEndless,
  composeRunModifiers2D,
  dailyForToday,
  dailyHref2D,
  resolveQueryRun2D,
} from '../../src/render2d/ui/modes2d.ts';
import {
  applyRunResult2D,
  islandStates,
  loadProgress2D,
  PROGRESS_2D_KEY,
  recordDailyWin2D,
  recordEndless2D,
  recordRunResult2D,
  recordWin2D,
  remapProgress,
  saveProgress2D,
} from '../../src/render2d/ui/progress2d.ts';
import { SimWorld } from '../../src/sim/world.ts';

function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
  vi.stubGlobal('localStorage', mock);
  resetMusicPrefsCache();
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetMusicPrefsCache();
});

describe('2D run modifiers composition matches 3D composition', () => {
  it('plain run with empty save uses NEUTRAL_RUN_MODIFIERS', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    const warnings: string[] = [];
    const res = resolveQueryRun2D(new URLSearchParams('level=l1c'), p, { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
    expect(res.level?.id).toBe('l1c');
    expect(res.runConfig).toEqual({ endless: false, challenges: [], daily: null });
    expect(res.modifiers).toBe(NEUTRAL_RUN_MODIFIERS);
    expect(res.modifiers).toEqual(runModifiersFor(workshopModifiers({}), []));
  });

  it('workshop upgrades match 3D workshopModifiers for partial and maxed ranks', () => {
    const partial = { treasury: 1, bastion: 2, quickcast: 1, fletcher: 2 };
    expect(composeRunModifiers2D(partial)).toEqual(runModifiersFor(workshopModifiers(partial), []));

    const maxed = maxedWorkshopRanks();
    const p = createDefaultProgress(LEVELS_2D.length);
    p.workshop = maxed;
    const res = resolveQueryRun2D(new URLSearchParams('level=i01'), p);
    expect(res.modifiers).toEqual(runModifiersFor(workshopModifiers(maxed), []));

    const w = new SimWorld(LEVEL_L1C, new EventBus(), res.modifiers);
    expect(w.gold).toBe(LEVEL_L1C.startingGold + 20);
    expect(w.startingLives).toBe(BALANCE.startingLives + 2);
  });

  it('workshop + single or stacked challenges match 3D runModifiersFor and drive SimWorld', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    p.workshop = { treasury: 2, bastion: 2, storm: 1 };
    const pair: ChallengeId[] = ['thinPurse', 'glassSanctuary'];
    const q = new URLSearchParams('level=l1c&challenge=thinPurse&challenge=glassSanctuary');
    const res = resolveQueryRun2D(q, p);
    const expected3d = runModifiersFor(workshopModifiers(p.workshop), pair);
    expect(res.runConfig).toEqual({ endless: false, challenges: pair, daily: null });
    expect(res.modifiers).toEqual(expected3d);

    // SimWorld applies Thin Purse gold mul + Treasury flat bonus, and Glass Sanctuary overrides Bastion lives.
    const w = new SimWorld(LEVEL_L1C, new EventBus(), res.modifiers);
    expect(w.gold).toBe(Math.round(LEVEL_L1C.startingGold * 0.7) + 20);
    expect(w.startingLives).toBe(8);
    expect(w.lives).toBe(8);
  });

  it('banned towers from ?challenge= prevent building in SimWorld', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    const res = resolveQueryRun2D(new URLSearchParams('level=l1c&challenge=bowless,quietGuns'), p);
    expect(res.modifiers.bannedTowers).toEqual(['archer', 'cannon', 'mortar']);
    const w = new SimWorld(LEVEL_L1C, new EventBus(), res.modifiers);
    w.gold = 9999;
    expect(w.placeTowerOnPlot(0, 'archer')).toBeNull();
    expect(w.placeTowerOnPlot(0, 'cannon')).toBeNull();
    expect(w.placeTowerOnPlot(0, 'tesla')).not.toBeNull();
  });

  it('?daily=1 composes Workshop + today\'s two Daily challenges identically to 3D', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    p.clears[0] = 1;
    p.clears[1] = 2;
    p.workshop = { bounty: 1, powder: 2 };
    const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
    const daily = dailyForToday(nowMs, p, LEVELS_2D)!;
    expect(daily).not.toBeNull();

    // Works both without ?level= and with ?level=<today's island>.
    for (const query of ['daily=1', `level=${daily.levelId}&daily=1`]) {
      const warnings: string[] = [];
      const res = resolveQueryRun2D(new URLSearchParams(query), p, {
        nowMs,
        levels: LEVELS_2D,
        warn: (m) => warnings.push(m),
      });
      expect(warnings).toEqual([]);
      expect(res.level?.id).toBe(daily.levelId);
      expect(res.runConfig).toEqual({
        endless: false,
        challenges: [...daily.challenges],
        daily: utcDayNumber(nowMs),
      });
      expect(res.modifiers).toEqual(runModifiersFor(workshopModifiers(p.workshop), daily.challenges));
    }
  });

  it('a Daily link opened just after UTC midnight still plays the Daily its sheet showed', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < 12; i++) p.clears[i] = 1;
    // Find a day whose Daily island differs from the next day's.
    let day = utcDayNumber(Date.UTC(2026, 10, 18));
    while (dailyForToday(day * 86_400_000, p)!.levelId === dailyForToday((day + 1) * 86_400_000, p)!.levelId) day++;
    const shown = dailyForToday(day * 86_400_000 + 86_000_000, p)!; // the sheet, 6 min before midnight
    const query = new URLSearchParams(`level=${shown.levelId}&daily=1`);
    const at = (msAfterMidnight: number) => resolveQueryRun2D(query, p, { nowMs: (day + 1) * 86_400_000 + msAfterMidnight, warn: () => {} });
    // Loaded 2 minutes past midnight: yesterday's Daily (its rules and its day, which still counts).
    const late = at(2 * 60_000);
    expect(late.level?.id).toBe(shown.levelId);
    expect(late.runConfig).toEqual({ endless: false, challenges: [...shown.challenges], daily: day });
    // Hours later the stale link is just an island link again.
    expect(at(DAILY_LINK_GRACE_MS + 1).runConfig.daily).toBeNull();
  });

  it('?endless=1 enables endless mode with Workshop modifiers and drops challenge/daily rules', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    p.workshop = { treasury: 1 };
    const warnings: string[] = [];
    const res = resolveQueryRun2D(new URLSearchParams('level=l1c&endless=1&challenge=bowless'), p, {
      warn: (m) => warnings.push(m),
    });
    expect(warnings.length).toBe(1);
    expect(res.runConfig).toEqual({ endless: true, challenges: [], daily: null });
    expect(res.modifiers).toEqual({ ...workshopModifiers(p.workshop), itemsDisabled: true });

    const w = new SimWorld(LEVEL_L1C, new EventBus(), res.modifiers);
    expect(w.startEndlessFromStart()).toBe(true);
    expect(w.waveSystem.isEndless).toBe(true);
  });

  it('ignores unknown query values with console.warn and preserves ?level= deep links', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    const warnings: string[] = [];
    const q = new URLSearchParams('level=i02&challenge=notARealChallenge,bowless&daily=maybe&endless=nope');
    const res = resolveQueryRun2D(q, p, { warn: (m) => warnings.push(m) });
    expect(res.level?.id).toBe('i02');
    expect(res.runConfig).toEqual({ endless: false, challenges: ['bowless'], daily: null });
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('nope');
    expect(warnings[1]).toContain('maybe');
    expect(warnings[2]).toContain('notARealChallenge');

    const badLevelWarn: string[] = [];
    const bad = resolveQueryRun2D(new URLSearchParams('level=atlantis'), p, {
      warn: (m) => badLevelWarn.push(m),
    });
    expect(bad.level).toBeNull();
    expect(badLevelWarn[0]).toContain('atlantis');
  });

  it('debug scenes ignore saved Workshop upgrades unless explicit challenges are passed', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    p.workshop = maxedWorkshopRanks();
    const res = resolveQueryRun2D(new URLSearchParams('bench=150'), p, { applySaveModifiers: false });
    expect(res.modifiers).toBe(NEUTRAL_RUN_MODIFIERS);
  });
});

describe('2D results recording and save persistence', () => {
  it('records challenge completions, filters foreign challenges, and updates mastery & wallet', () => {
    installMemoryStorage();
    const offered = challengesForLevel(LEVELS_2D[0]);
    const foreign = (['thaw', 'quietGuns', 'bowless', 'galeForce'] as ChallengeId[]).find(
      (c) => !offered.includes(c),
    )!;

    // First challenge win (3 stars + one island challenge + one foreign challenge).
    const r1 = recordWin2D(LEVELS_2D[0].id, 3, 20, LEVELS_2D, [offered[0], foreign])!;
    expect(r1.newChallenges).toEqual([offered[0]]);

    let p = loadProgress2D(LEVELS_2D);
    expect(p.challengeClears[0]).toEqual([offered[0]]);
    expect(starWallet(p)).toMatchObject({ campaign: 3, challenge: 1, earned: 4 });
    expect(islandStates(p, LEVELS_2D)[0].mastered).toBe(false);

    // Second challenge completes mastery; re-winning offered[0] does not double-count.
    const r2 = recordWin2D(LEVELS_2D[0].id, 2, 14, LEVELS_2D, [offered[0], offered[1]])!;
    expect(r2.newChallenges).toEqual([offered[1]]);
    p = loadProgress2D(LEVELS_2D);
    expect(p.challengeClears[0]).toEqual([offered[0], offered[1]]);
    expect(starWallet(p)).toMatchObject({ campaign: 3, challenge: 2, earned: 5 });
    expect(islandStates(p, LEVELS_2D)[0].mastered).toBe(true);
  });

  it('records Daily Squall wins once per UTC day with streak tracking', () => {
    installMemoryStorage();
    const day1Ms = Date.UTC(2026, 10, 18, 10, 0, 0);
    const day2Ms = Date.UTC(2026, 10, 19, 10, 0, 0);
    const day1 = utcDayNumber(day1Ms);
    const day2 = utcDayNumber(day2Ms);

    const out1 = recordRunResult2D(
      {
        levelId: LEVELS_2D[0].id,
        won: true,
        stars: 2,
        livesRemaining: 15,
        waveReached: 10,
        runConfig: { endless: false, challenges: ['galeForce', 'thinPurse'], daily: day1 },
        nowMs: day1Ms,
      },
      LEVELS_2D,
    );
    expect(out1.daily).toEqual({ counted: true, streak: 1 });
    expect(out1.win?.stars).toBe(2);

    // Second win on the same UTC day does not pay another daily star.
    expect(recordDailyWin2D(day1, day1Ms, LEVELS_2D)).toEqual({ counted: false, streak: 1 });
    // Consecutive day extends streak.
    expect(recordDailyWin2D(day2, day2Ms, LEVELS_2D)).toEqual({ counted: true, streak: 2 });

    const p = loadProgress2D(LEVELS_2D);
    expect(p.daily).toEqual({ lastDay: day2, streak: 2, bestStreak: 2, total: 2 });
    expect(starWallet(p).challenge).toBeGreaterThanOrEqual(2);
  });

  it('records Endless best wave only past story waves and never awards campaign stars', () => {
    installMemoryStorage();
    const lvl = LEVELS_2D[0];
    const storyWaves = lvl.waves.length;

    // Falling on a story wave writes nothing.
    const early = recordRunResult2D(
      {
        levelId: lvl.id,
        won: false,
        stars: 0,
        livesRemaining: 0,
        waveReached: storyWaves,
        runConfig: { endless: true, challenges: [], daily: null },
      },
      LEVELS_2D,
    );
    expect(early.endless).toEqual({ best: 0, previousBest: 0, isNewBest: false, reachedEndless: false });
    expect(loadProgress2D(LEVELS_2D).bestEndlessWaves[0]).toBe(0);
    expect(loadProgress2D(LEVELS_2D).bestStars[0]).toBe(0);

    // Reaching endless waves records and keeps the maximum.
    const rec1 = recordEndless2D(lvl.id, storyWaves + 4, LEVELS_2D)!;
    expect(rec1).toEqual({ best: storyWaves + 4, previousBest: 0, isNewBest: true, reachedEndless: true });
    const rec2 = recordEndless2D(lvl.id, storyWaves + 2, LEVELS_2D)!;
    expect(rec2).toEqual({ best: storyWaves + 4, previousBest: storyWaves + 4, isNewBest: false, reachedEndless: true });
    expect(islandStates(loadProgress2D(LEVELS_2D), LEVELS_2D)[0].bestEndlessWave).toBe(storyWaves + 4);
  });

  it('non-endless losses do not mutate progress, and remapProgress preserves new mode fields', () => {
    const p = createDefaultProgress(2);
    p.clears[0] = 1;
    p.bestStars[0] = 2;
    p.challengeClears[0] = ['bowless'];
    p.bestEndlessWaves[0] = 15;
    p.daily = { lastDay: 20500, streak: 3, bestStreak: 4, total: 6 };
    p.workshop = { treasury: 1 };

    const loss = applyRunResult2D(
      p,
      {
        levelId: LEVELS_2D[0].id,
        won: false,
        stars: 0,
        livesRemaining: 0,
        waveReached: 5,
        runConfig: { endless: false, challenges: ['bowless'], daily: 20501 },
      },
      LEVELS_2D.slice(0, 2),
    );
    expect(loss).toEqual({ win: null, daily: null, endless: null });
    expect(p.clears[0]).toBe(1);
    expect(p.daily.total).toBe(6);

    const remapped = remapProgress(p, ['a', 'b'], [{ id: 'new' }, { id: 'a' }, { id: 'b' }]);
    expect(remapped.challengeClears[1]).toEqual(['bowless']);
    expect(remapped.bestEndlessWaves[1]).toBe(15);
    expect(remapped.daily).toEqual(p.daily);
    expect(remapped.workshop).toEqual({ treasury: 1 });

    // Bare ProgressData stored without `{ ids, progress }` wrapper still loads cleanly.
    const store = installMemoryStorage();
    store.set(PROGRESS_2D_KEY, JSON.stringify(p));
    const loaded = loadProgress2D(LEVELS_2D.slice(0, 2));
    expect(loaded.challengeClears[0]).toEqual(['bowless']);
    saveProgress2D(loaded, LEVELS_2D.slice(0, 2));
    expect(JSON.parse(store.get(PROGRESS_2D_KEY)!).ids).toHaveLength(2);
  });
});

describe('modes2d pure UI helpers', () => {
  it('availableChallenges unlocks after first clear and tracks completed badges', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    const id = LEVELS_2D[0].id;
    expect(availableChallenges(id, p, LEVELS_2D)).toEqual([]);
    expect(availableChallenges('unknown-id', p, LEVELS_2D)).toEqual([]);

    p.clears[0] = 1;
    const initial = availableChallenges(id, p, LEVELS_2D);
    expect(initial).toHaveLength(2);
    expect(initial.every((c) => isChallengeId(c.id) && !c.completed)).toBe(true);

    p.challengeClears[0] = [initial[1].id];
    const updated = availableChallenges(id, p, LEVELS_2D);
    expect(updated.map((c) => c.completed)).toEqual([false, true]);
  });

  it('offers Silent Skies on 2D islands per 3D rules while keeping data-driven filtering for no-effect patches', () => {
    // Data-driven check: abilities count in 2D; empty/neutral patches and unknown-tower bans stay false.
    expect(hasModifierEffectIn2D({})).toBe(false);
    expect(hasModifierEffectIn2D({ enemyHpMul: 1, abilityCooldownMul: 1, abilitiesDisabled: false })).toBe(false);
    expect(hasModifierEffectIn2D({ bannedTowers: ['trebuchet' as TowerType] })).toBe(false);
    expect(
      hasModifierEffectIn2D({ towerFireRateMul: { trebuchet: 1.25 } as Partial<Record<TowerType, number>> }),
    ).toBe(false);
    expect(isChallengeEffectiveIn2D({ patch: {} })).toBe(false);
    expect(isChallengeEffectiveIn2D({ patch: { bannedTowers: ['trebuchet' as TowerType] } })).toBe(false);

    expect(hasModifierEffectIn2D({ abilitiesDisabled: true })).toBe(true);
    expect(hasModifierEffectIn2D({ abilityCooldownMul: 0.85 })).toBe(true);
    expect(hasModifierEffectIn2D({ bannedTowers: ['archer'] })).toBe(true);
    expect(hasModifierEffectIn2D({ bannedTowers: ['barracks'] })).toBe(true);
    expect(hasModifierEffectIn2D({ enemyHpMul: 1.12 })).toBe(true);
    expect(hasModifierEffectIn2D({ championWaves: true })).toBe(true);

    expect(isChallengeEffectiveIn2D(CHALLENGES.silentSkies)).toBe(true);
    expect(CHALLENGE_IDS_2D).toContain('silentSkies');
    expect(CHALLENGE_IDS_2D).toEqual(CHALLENGE_IDS);

    // Every 2D island offers its two challenges per the same rules as 3D (Master islands i08–i16 get silentSkies + ironTide).
    const p = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < LEVELS_2D.length; i++) p.clears[i] = 1;
    for (const lvl of LEVELS_2D) {
      const offered = availableChallenges(lvl.id, p, LEVELS_2D);
      const expected3d = challengesForLevel({ id: lvl.id, difficulty: lvl.difficulty });
      expect(offered.map((c) => c.id), lvl.id).toEqual(expected3d);
      expect(offered, lvl.id).toHaveLength(2);
      if (lvl.difficulty === 'Master') {
        expect(offered.map((c) => c.id), lvl.id).toEqual(['silentSkies', 'ironTide']);
      }
    }

    // Hand-picked 3D island IDs with layout2d attached preserve their exact 3D pairs (including silentSkies).
    for (const lvl3d of LEVELS) {
      const withPlot = { ...lvl3d, layout2d: LEVEL_L1C.layout2d };
      expect(challengesForLevel(withPlot), lvl3d.id).toEqual(challengesForLevel(lvl3d));
    }
    expect(challengesForLevel({ ...LEVELS[4], layout2d: LEVEL_L1C.layout2d })).toEqual(['galeForce', 'silentSkies']);
  });

  it('Silent Skies disables both Meteor Strike and Overcharge button casts in the 2D sim', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    p.workshop = maxedWorkshopRanks();
    const masterLevel = LEVELS_2D.find((l) => l.id === 'i08')!;
    const plot = masterLevel.layout2d!.plots[0];

    // Control: without Silent Skies on the same 2D island, both ability buttons are ready and cast in the sim.
    const normalRun = resolveQueryRun2D(new URLSearchParams('level=i08'), p);
    expect(normalRun.modifiers.abilitiesDisabled).toBe(false);
    const wNormal = new SimWorld(masterLevel, new EventBus(), normalRun.modifiers);
    wNormal.gold = 9999;
    expect(wNormal.placeTowerOnPlot(0, 'archer')).not.toBeNull();
    wNormal.startNextWave();
    expect(abilityGate(wNormal)).toBe('ok');
    expect(abilitySlotView(wNormal, 'meteor').state).toBe('ready');
    expect(abilitySlotView(wNormal, 'overcharge').state).toBe('ready');
    expect(castMeteor2D(wNormal, plot.x, plot.z)).toBe(true);
    expect(castOvercharge2D(wNormal)).toBe(true);

    // Silent Skies: launching with ?challenge=silentSkies disables both HUD buttons and blocks casts in SimWorld.
    const silentRun = resolveQueryRun2D(new URLSearchParams('level=i08&challenge=silentSkies'), p);
    expect(silentRun.runConfig.challenges).toEqual(['silentSkies']);
    expect(silentRun.modifiers.abilitiesDisabled).toBe(true);

    const events = new EventBus();
    let targetedEvents = 0;
    let overchargeEvents = 0;
    events.on('abilityTargeted', () => targetedEvents++);
    events.on('overchargeActivated', () => overchargeEvents++);

    const wSilent = new SimWorld(masterLevel, events, silentRun.modifiers);
    wSilent.gold = 9999;
    expect(wSilent.placeTowerOnPlot(0, 'archer')).not.toBeNull();
    wSilent.startNextWave();

    expect(abilityGate(wSilent)).toBe('disabled');
    expect(abilitySlotView(wSilent, 'meteor').state).toBe('disabled');
    expect(abilitySlotView(wSilent, 'overcharge').state).toBe('disabled');
    expect(castMeteor2D(wSilent, plot.x, plot.z)).toBe(false);
    expect(castOvercharge2D(wSilent)).toBe(false);
    expect(wSilent.castMeteor(plot.x, plot.z)).toBe(false);
    expect(wSilent.castOvercharge()).toBe(false);
    expect(wSilent.castAbility('meteor', plot.x, plot.z)).toBe(false);
    expect(wSilent.castAbility('overcharge')).toBe(false);
    expect(wSilent.getAbilityState('meteor')).toMatchObject({ disabled: true, usable: false });
    expect(wSilent.getAbilityState('overcharge')).toMatchObject({ disabled: true, usable: false });
    expect(wSilent.abilitySystem.getOverchargeRemaining()).toBe(0);
    expect(targetedEvents).toBe(0);
    expect(overchargeEvents).toBe(0);
  });

  it('records the Silent Skies badge, bonus star, and mastery on 2D Master islands', () => {
    installMemoryStorage();
    const masterIdx = LEVELS_2D.findIndex((l) => l.id === 'i16');
    expect(masterIdx).toBeGreaterThan(0);

    const silentClear = recordWin2D('i16', 3, 20, LEVELS_2D, ['silentSkies'])!;
    expect(silentClear.newChallenges).toEqual(['silentSkies']);
    let saved = loadProgress2D(LEVELS_2D);
    expect(saved.challengeClears[masterIdx]).toEqual(['silentSkies']);
    expect(starWallet(saved)).toMatchObject({ campaign: 3, challenge: 1, earned: 4 });
    expect(availableChallenges('i16', saved, LEVELS_2D).map((c) => [c.id, c.completed])).toEqual([
      ['silentSkies', true],
      ['ironTide', false],
    ]);
    expect(islandStates(saved, LEVELS_2D)[masterIdx].mastered).toBe(false);

    // Re-winning Silent Skies does not double-count; clearing Iron Tide completes mastery.
    expect(recordWin2D('i16', 3, 20, LEVELS_2D, ['silentSkies'])!.newChallenges).toEqual([]);
    const secondClear = recordWin2D('i16', 2, 16, LEVELS_2D, ['ironTide'])!;
    expect(secondClear.newChallenges).toEqual(['ironTide']);
    saved = loadProgress2D(LEVELS_2D);
    expect(saved.challengeClears[masterIdx]).toEqual(['silentSkies', 'ironTide']);
    expect(starWallet(saved)).toMatchObject({ campaign: 3, challenge: 2, earned: 5 });
    expect(islandStates(saved, LEVELS_2D)[masterIdx].mastered).toBe(true);
  });

  it('includes Silent Skies in the 2D Daily Squall pool and applies it on ?daily=1 runs', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < 6; i++) p.clears[i] = 1;
    const cleared = [0, 1, 2, 3, 4, 5];

    let silentDays = 0;
    let firstSilentDayMs: number | null = null;
    for (let day = 20_000; day < 20_200; day++) {
      const dayMs = day * 86_400_000 + 3_600_000;
      const dc2d = dailyForToday(dayMs, p, LEVELS_2D)!;
      const dc3d = dailyChallengeFor(day, cleared)!;
      expect(dc2d.challenges).toEqual(dc3d.challenges);
      expect(dailyChallengeFor(day, cleared, CHALLENGE_IDS_2D)!.challenges).toEqual(dc3d.challenges);
      if (dc2d.challenges.includes('silentSkies')) {
        silentDays++;
        firstSilentDayMs ??= dayMs;
      }
    }
    expect(silentDays).toBeGreaterThan(0);

    // Launching ?daily=1 on a Silent Skies day disables both abilities in the resolved 2D run.
    const res = resolveQueryRun2D(new URLSearchParams('daily=1'), p, {
      nowMs: firstSilentDayMs!,
      levels: LEVELS_2D,
    });
    expect(res.runConfig.challenges).toContain('silentSkies');
    expect(res.modifiers.abilitiesDisabled).toBe(true);
    const w = new SimWorld(res.level!, new EventBus(), res.modifiers);
    w.gold = 9999;
    w.placeTowerOnPlot(0, 'archer');
    w.startNextWave();
    expect(castMeteor2D(w, 0, 0)).toBe(false);
    expect(castOvercharge2D(w)).toBe(false);
  });

  it('canPlayEndless requires at least one clear on a valid 2D island', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    expect(canPlayEndless(LEVELS_2D[0].id, p, LEVELS_2D)).toBe(false);
    expect(canPlayEndless('unknown-id', p, LEVELS_2D)).toBe(false);
    p.clears[0] = 1;
    expect(canPlayEndless(LEVELS_2D[0].id, p, LEVELS_2D)).toBe(true);
  });

  it('dailyForToday is pure, deterministic per UTC date, and respects cleared islands when progress is given', () => {
    const d1 = new Date('2026-11-18T01:00:00Z');
    const d1Late = new Date('2026-11-18T23:50:00Z');
    const a = dailyForToday(d1);
    const b = dailyForToday(d1Late);
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(dailyPairAllowed(a!.challenges[0], a!.challenges[1])).toBe(true);
    expect(a!.challenges.filter((c) => isStrongRule(c)).length).toBeLessThanOrEqual(1);
    expect(dailyForToday(new Date('invalid'))).toBeNull();

    const fresh = createDefaultProgress(LEVELS_2D.length);
    expect(dailyForToday(d1, fresh, LEVELS_2D)).toBeNull();
    fresh.clears[2] = 1;
    const single = dailyForToday(d1, fresh, LEVELS_2D)!;
    expect(single.levelIndex).toBe(2);
    expect(single.levelId).toBe(LEVELS_2D[2].id);
  });

  it('buildRunHref2D and dailyHref2D format query links cleanly', () => {
    expect(dailyHref2D('i01', '/2d.html')).toBe('/2d.html?level=i01&daily=1');
    expect(buildRunHref2D('l1c', { challenges: ['bowless', 'glassSanctuary'], pathname: '/2d.html' })).toBe(
      '/2d.html?level=l1c&challenge=bowless&challenge=glassSanctuary',
    );
    expect(buildRunHref2D('l1c', { endless: true, intro: true, pathname: '/2d.html' })).toBe(
      '/2d.html?level=l1c&endless=1&intro=1',
    );
  });
});

describe('settings2d pure gating functions', () => {
  it('audioSettings2d combines masterVolume, musicVolume, and muted', () => {
    expect(audioSettings2d({ masterVolume: 0.8, muted: false }, 0.5)).toEqual({
      muted: false,
      masterVolume: 0.8,
      musicVolume: 0.5,
      effectiveSfxVolume: 0.8,
      effectiveMusicVolume: 0.4,
    });
    expect(audioSettings2d({ masterVolume: 0.8, muted: true }, 0.5)).toEqual({
      muted: true,
      masterVolume: 0.8,
      musicVolume: 0.5,
      effectiveSfxVolume: 0,
      effectiveMusicVolume: 0,
    });
    expect(audioSettings2d({ masterVolume: 0, muted: false }, 0.7)).toMatchObject({
      effectiveSfxVolume: 0,
      effectiveMusicVolume: 0,
    });

    // Reads saved GameSettings + musicPrefs from storage when called with no arguments.
    installMemoryStorage();
    saveSettings({ ...getDefaultSettings(), masterVolume: 0.5, muted: false });
    setMusicVolume(0.4);
    expect(audioSettings2d()).toEqual({
      muted: false,
      masterVolume: 0.5,
      musicVolume: 0.4,
      effectiveSfxVolume: 0.5,
      effectiveMusicVolume: 0.2,
    });
  });

  it('gates screen shake when cameraShake is off and decays when on', () => {
    const s = createShakeState2D();
    expect(shouldShake2D({ cameraShake: false })).toBe(false);
    expect(triggerShake2D(s, 0.08, { cameraShake: false })).toBe(false);
    expect(s.intensity).toBe(0);

    expect(triggerShake2D(s, 0.05, { cameraShake: true })).toBe(true);
    expect(s.triggers).toBe(1);
    // Stronger blow inside cooldown raises amplitude without incrementing triggers; clamped to max.
    expect(triggerShake2D(s, 0.9, { cameraShake: true })).toBe(true);
    expect(s.intensity).toBe(MAX_SHAKE_UNITS_2D);
    expect(s.triggers).toBe(1);

    stepShake2D(s, 1 / 60, { cameraShake: true });
    expect(Math.hypot(s.offsetX, s.offsetY)).toBeGreaterThan(0);
    expect(s.intensity).toBeLessThan(MAX_SHAKE_UNITS_2D);

    // Turning cameraShake off mid-shake zeroes offsets immediately.
    stepShake2D(s, 1 / 60, { cameraShake: false });
    expect(s).toMatchObject({ intensity: 0, offsetX: 0, offsetY: 0, cooldown: 0 });
  });

  it('gates floating damage numbers when damageNumbers is off, merges within 150ms, and expires', () => {
    const pool = createDamagePopupPool2D(4);
    expect(shouldShowDamageNumbers2D({ damageNumbers: false }, 20)).toBe(false);
    expect(
      spawnDamageNumber2D(pool, { enemyId: 1, damage: 25, x: 1, y: 0, z: 2 }, 1.0, { damageNumbers: false }),
    ).toBeNull();
    expect(pool.spawned).toBe(0);

    const a = spawnDamageNumber2D(pool, { enemyId: 7, damage: 30, x: 1, y: 0, z: 2 }, 1.0, { damageNumbers: true })!;
    expect(a.amount).toBe(30);
    expect(a.heavy).toBe(false);

    // Hit on same enemy within 150ms merges and crosses heavy threshold (>= 55).
    const merged = spawnDamageNumber2D(pool, { enemyId: 7, damage: 30, x: 1.2, y: 0, z: 2 }, 1.1, {
      damageNumbers: true,
    })!;
    expect(merged).toBe(a);
    expect(merged.amount).toBe(60);
    expect(merged.heavy).toBe(true);
    expect(pool.spawned).toBe(1);

    // Hit after merge window spawns a separate slot.
    const b = spawnDamageNumber2D(pool, { enemyId: 7, damage: 12, x: 1.5, y: 0, z: 2 }, 1.3, {
      damageNumbers: true,
    })!;
    expect(b).not.toBe(a);
    expect(pool.spawned).toBe(2);

    expect(stepDamageNumbers2D(pool, 0.2, { damageNumbers: true })).toBe(2);
    expect(stepDamageNumbers2D(pool, DAMAGE_POPUP_DURATION_SEC, { damageNumbers: true })).toBe(0);

    // Toggling damageNumbers off clears active slots immediately.
    spawnDamageNumber2D(pool, { enemyId: 9, damage: 18, x: 0, y: 0, z: 0 }, 2.0, { damageNumbers: true });
    expect(stepDamageNumbers2D(pool, 0.01, { damageNumbers: false })).toBe(0);
  });

  it('shouldVibrate2D requires both haptics setting and touch device', () => {
    expect(shouldVibrate2D({ haptics: true }, true)).toBe(true);
    expect(shouldVibrate2D({ haptics: false }, true)).toBe(false);
    expect(shouldVibrate2D({ haptics: true }, false)).toBe(false);
  });
});
