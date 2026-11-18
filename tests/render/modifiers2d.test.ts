import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetMusicPrefsCache, setMusicVolume } from '../../src/audio/musicPrefs.ts';
import { EventBus } from '../../src/core/eventBus.ts';
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
  availableChallenges,
  buildRunHref2D,
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

  it('?endless=1 enables endless mode with Workshop modifiers and drops challenge/daily rules', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    p.workshop = { treasury: 1 };
    const warnings: string[] = [];
    const res = resolveQueryRun2D(new URLSearchParams('level=l1c&endless=1&challenge=bowless'), p, {
      warn: (m) => warnings.push(m),
    });
    expect(warnings.length).toBe(1);
    expect(res.runConfig).toEqual({ endless: true, challenges: [], daily: null });
    expect(res.modifiers).toEqual(workshopModifiers(p.workshop));

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

  it('excludes Silent Skies and any ability-only challenge in 2D via data-driven patch check (no free badges)', () => {
    // Data-driven check inspects patch fields, not hardcoded challenge IDs.
    expect(hasModifierEffectIn2D({})).toBe(false);
    expect(hasModifierEffectIn2D({ abilitiesDisabled: true })).toBe(false);
    expect(hasModifierEffectIn2D({ abilityCooldownMul: 2 })).toBe(false);
    expect(hasModifierEffectIn2D({ enemyHpMul: 1.12 })).toBe(true);
    expect(hasModifierEffectIn2D({ championWaves: true })).toBe(true);

    expect(isChallengeEffectiveIn2D(CHALLENGES.silentSkies)).toBe(false);
    expect(CHALLENGE_IDS_2D).not.toContain('silentSkies');
    expect(CHALLENGE_IDS_2D).toHaveLength(CHALLENGE_IDS.length - 1);
    for (const id of CHALLENGE_IDS_2D) {
      expect(isChallengeEffectiveIn2D(CHALLENGES[id]), id).toBe(true);
    }

    // Every 2D island (including Master islands i08–i16) excludes silentSkies in availableChallenges.
    const p = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < LEVELS_2D.length; i++) p.clears[i] = 1;
    for (const lvl of LEVELS_2D) {
      const offered = availableChallenges(lvl.id, p, LEVELS_2D);
      expect(offered.length, lvl.id).toBeGreaterThan(0);
      expect(offered.map((c) => c.id), lvl.id).not.toContain('silentSkies');
      for (const c of offered) {
        expect(isChallengeEffectiveIn2D(c), `${lvl.id}:${c.id}`).toBe(true);
      }
      if (lvl.difficulty === 'Master') {
        expect(offered.map((c) => c.id), lvl.id).toEqual(['ironTide']);
      }
    }

    // Even a hand-picked island ID with layout2d attached filters out silentSkies.
    const masterPlotMock = { ...LEVELS[4], layout2d: LEVEL_L1C.layout2d };
    expect(challengesForLevel(LEVELS[4])).toContain('silentSkies'); // 3D keeps Silent Skies
    expect(challengesForLevel(masterPlotMock)).toEqual(['galeForce']); // 2D drops Silent Skies

    // Winning a 2D Master island with ?challenge=silentSkies awards NO badge; winning ironTide masters it.
    installMemoryStorage();
    const masterIdx = LEVELS_2D.findIndex((l) => l.id === 'i16');
    expect(masterIdx).toBeGreaterThan(0);
    const freeAttempt = recordWin2D('i16', 3, 20, LEVELS_2D, ['silentSkies'])!;
    expect(freeAttempt.newChallenges).toEqual([]);
    expect(loadProgress2D(LEVELS_2D).challengeClears[masterIdx]).toEqual([]);
    expect(islandStates(loadProgress2D(LEVELS_2D), LEVELS_2D)[masterIdx].mastered).toBe(false);

    const realClear = recordWin2D('i16', 3, 20, LEVELS_2D, ['ironTide'])!;
    expect(realClear.newChallenges).toEqual(['ironTide']);
    expect(islandStates(loadProgress2D(LEVELS_2D), LEVELS_2D)[masterIdx].mastered).toBe(true);

    // Daily pool filtering also supports CHALLENGE_IDS_2D with zero silentSkies rolls.
    for (let day = 20_000; day < 20_200; day++) {
      const dc = dailyChallengeFor(day, [0, 1, 2], CHALLENGE_IDS_2D)!;
      expect(dc.challenges).not.toContain('silentSkies');
    }

    // SimWorld on a 2D plot map allows global abilities once a wave starts, unless disabled by modifier.
    const w2d = new SimWorld(LEVEL_L1C, new EventBus());
    expect(w2d.castMeteor(0, 0)).toBe(false);
    expect(w2d.castOvercharge()).toBe(false);
    w2d.startNextWave();
    expect(w2d.castMeteor(0, 0)).toBe(true);
    expect(w2d.castOvercharge()).toBe(true);
    const w2dSilent = new SimWorld(LEVEL_L1C, new EventBus(), { ...NEUTRAL_RUN_MODIFIERS, abilitiesDisabled: true });
    w2dSilent.startNextWave();
    expect(w2dSilent.castMeteor(0, 0)).toBe(false);
    expect(w2dSilent.castOvercharge()).toBe(false);
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
