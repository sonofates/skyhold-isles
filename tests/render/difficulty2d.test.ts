import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { ProgressData } from '../../src/core/types.ts';
import { challengeModifiers } from '../../src/data/challenges.ts';
import {
  DIFFICULTIES,
  difficultyWinsOf,
  isDifficultyId,
  mergeDifficultyWins,
  parseDifficulty,
  sanitizeDifficultyWins,
  starsAwarded,
  withDifficulty,
} from '../../src/data/difficulty.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { combineRunModifiers, isNeutralRun, NEUTRAL_RUN_MODIFIERS } from '../../src/data/runModifiers.ts';
import { workshopModifiers } from '../../src/data/workshop.ts';
import type { RunConfig } from '../../src/game/runConfig.ts';
import { setLocale } from '../../src/i18n/index.ts';
import { decodeSaveCode, encodeSaveCode, mergeProgress } from '../../src/platform/saveCode.ts';
import { createDefaultProgress, migrateProgress } from '../../src/platform/storage.ts';
import { difficultyBadgeSpot, difficultyRuleText } from '../../src/render2d/ui/difficulty2d.ts';
import { endNoteFor } from '../../src/render2d/ui/modeBits.ts';
import { buildRunHref2D, composeRunModifiers2D, resolveQueryRun2D } from '../../src/render2d/ui/modes2d.ts';
import { applyRunResult2D, islandStates, remapProgress } from '../../src/render2d/ui/progress2d.ts';
import { SimWorld } from '../../src/sim/world.ts';

const PLAIN: RunConfig = { endless: false, challenges: [], daily: null };
const N = LEVELS_2D.length;
const NOW = Date.UTC(2026, 10, 19, 12);

afterEach(() => setLocale('en'));

describe('difficulty data', () => {
  it('parses ids and rejects anything else', () => {
    expect(parseDifficulty('hard')).toBe('hard');
    expect(parseDifficulty(' Easy ')).toBe('easy');
    expect(parseDifficulty('nightmare')).toBeNull();
    expect(parseDifficulty(null)).toBeNull();
    expect(isDifficultyId('normal')).toBe(true);
    expect(isDifficultyId('Normal')).toBe(false);
  });

  it('Normal is the island as tuned: no patch, same modifiers object', () => {
    expect(Object.keys(DIFFICULTIES.normal.patch)).toEqual([]);
    const ws = workshopModifiers({ treasury: 2 });
    expect(ws.startGoldBonus).toBe(20);
    expect(withDifficulty(ws, 'normal')).toBe(ws);
    expect(isNeutralRun(withDifficulty(NEUTRAL_RUN_MODIFIERS, 'normal'))).toBe(true);
  });

  it('Easy softens foes and adds gold and lives; Hard toughens foes and slows the hero', () => {
    const e = withDifficulty(NEUTRAL_RUN_MODIFIERS, 'easy');
    expect(e.enemyHpMul).toBeLessThan(1);
    expect(e.enemySpeedMul).toBeLessThan(1);
    expect(e.startGoldMul).toBeGreaterThan(1);
    expect(e.bonusLives).toBeGreaterThan(0);
    const h = withDifficulty(NEUTRAL_RUN_MODIFIERS, 'hard');
    expect(h.enemyHpMul).toBeGreaterThan(1);
    expect(h.startGoldMul).toBeLessThan(1);
    expect(h.heroRespawnMul).toBeGreaterThan(1);
    expect(isNeutralRun(h)).toBe(false);
  });

  it('stacks on top of Workshop and challenges (multipliers multiply, lowest life cap wins)', () => {
    const glass = challengeModifiers(['glassSanctuary']);
    const hard = withDifficulty(glass, 'hard');
    expect(hard.maxLives).toBe(Math.min(8, DIFFICULTIES.hard.patch.maxLives ?? 99));
    expect(withDifficulty(glass, 'easy').maxLives).toBe(8);
    const iron = withDifficulty(challengeModifiers(['ironTide']), 'hard');
    expect(iron.enemyHpMul).toBeCloseTo(1.12 * (DIFFICULTIES.hard.patch.enemyHpMul ?? 1), 6);
    const ws = workshopModifiers({ bastion: 2 });
    expect(ws.bonusLives).toBe(2);
    const easy = composeRunModifiers2D({ bastion: 2 }, [], 'easy');
    expect(easy.bonusLives).toBe(ws.bonusLives + (DIFFICULTIES.easy.patch.bonusLives ?? 0));
  });

  it('Easy awards at most one star; Normal and Hard keep the earned stars', () => {
    expect(starsAwarded(3, 'easy')).toBe(1);
    expect(starsAwarded(1, 'easy')).toBe(1);
    expect(starsAwarded(3, 'normal')).toBe(3);
    expect(starsAwarded(2, 'hard')).toBe(2);
    expect(starsAwarded(Number.NaN, 'hard')).toBe(1);
  });

  it('a save without a difficulty record reads its wins as Normal', () => {
    const p = createDefaultProgress(4);
    p.bestStars = [3, 2, 0, 0];
    const dw = difficultyWinsOf(p);
    expect(dw.normal).toEqual([3, 2, 0, 0]);
    expect(dw.easy).toEqual([0, 0, 0, 0]);
    expect(dw.hard).toEqual([0, 0, 0, 0]);
  });

  it('sanitises stored records (bad values, Easy capped at 1, island count)', () => {
    const dw = sanitizeDifficultyWins({ easy: [3, 'x', 1], normal: [2, -1, 9], hard: [1.7] }, 3);
    expect(dw).toEqual({ easy: [1, 0, 1], normal: [2, 0, 3], hard: [1, 0, 0] });
    expect(sanitizeDifficultyWins(null, 3)).toBeNull();
    expect(sanitizeDifficultyWins([1, 2], 3)).toBeNull();
    const m = mergeDifficultyWins({ easy: [1, 0], normal: [2, 0], hard: [0, 3] }, { easy: [0, 1], normal: [3, 1], hard: [1, 0] }, 2);
    expect(m).toEqual({ easy: [1, 1], normal: [3, 1], hard: [1, 3] });
  });
});

describe('hero respawn modifier', () => {
  it('is neutral by default and multiplies when stacked', () => {
    expect(NEUTRAL_RUN_MODIFIERS.heroRespawnMul).toBe(1);
    expect(combineRunModifiers({ heroRespawnMul: 1.25 }, { heroRespawnMul: 2 }).heroRespawnMul).toBeCloseTo(2.5, 9);
    expect(combineRunModifiers({ heroRespawnMul: -1 }).heroRespawnMul).toBe(1);
    expect(isNeutralRun(combineRunModifiers({ heroRespawnMul: 1.25 }))).toBe(false);
  });

  it('scales the fielded hero respawn timer in the sim', () => {
    const level = LEVELS_2D[0];
    const base = new SimWorld(level, new EventBus(), { heroId: 'bran', heroLevel: 1 });
    const hard = new SimWorld(level, new EventBus(), { heroId: 'bran', heroLevel: 1, modifiers: withDifficulty(NEUTRAL_RUN_MODIFIERS, 'hard') });
    const r0 = base.hero!.stats.respawnSec;
    expect(hard.hero!.stats.respawnSec).toBeCloseTo(r0 * (DIFFICULTIES.hard.patch.heroRespawnMul ?? 1), 6);
    expect(hard.startingLives).toBe(DIFFICULTIES.hard.patch.maxLives ?? base.startingLives);
    expect(hard.gold).toBeLessThan(base.gold);
  });
});

describe('run URL and resolution', () => {
  const lvl = LEVELS_2D[1];
  const cleared = (): ProgressData => {
    const p = createDefaultProgress(N);
    p.clears[1] = 1;
    p.bestStars[1] = 2;
    p.unlockedLevelIndex = 2;
    return p;
  };
  const resolve = (qs: string, p = cleared()) => {
    const warns: string[] = [];
    const r = resolveQueryRun2D(new URLSearchParams(qs), p, { nowMs: NOW, warn: (m) => warns.push(m) });
    return { r, warns };
  };

  it('builds &diff= for Easy / Hard only, never on Daily or Endless', () => {
    expect(buildRunHref2D(lvl.id, { difficulty: 'hard', pathname: '/2d.html' })).toBe(`/2d.html?level=${lvl.id}&diff=hard`);
    expect(buildRunHref2D(lvl.id, { difficulty: 'normal', pathname: '/2d.html' })).toBe(`/2d.html?level=${lvl.id}`);
    expect(buildRunHref2D(lvl.id, { difficulty: 'hard', endless: true, pathname: '/2d.html' })).toBe(`/2d.html?level=${lvl.id}&endless=1`);
    expect(buildRunHref2D(lvl.id, { difficulty: 'hard', daily: true, pathname: '/2d.html' })).toBe(`/2d.html?level=${lvl.id}&daily=1`);
    // Easy carries no challenges.
    expect(buildRunHref2D(lvl.id, { difficulty: 'easy', challenges: ['bowless'], pathname: '/2d.html' })).toBe(`/2d.html?level=${lvl.id}&diff=easy`);
  });

  it('?diff=hard sets the run difficulty and its patch on top of the save', () => {
    const { r, warns } = resolve(`level=${lvl.id}&diff=hard`);
    expect(warns).toEqual([]);
    expect(r.runConfig.difficulty).toBe('hard');
    expect(r.modifiers.enemyHpMul).toBeCloseTo(DIFFICULTIES.hard.patch.enemyHpMul ?? 1, 6);
    expect(r.modifiers.maxLives).toBe(DIFFICULTIES.hard.patch.maxLives ?? null);
    expect(r.modifiers.heroRespawnMul).toBeCloseTo(DIFFICULTIES.hard.patch.heroRespawnMul ?? 1, 6);
  });

  it('Normal and plain runs stay neutral; junk values warn and play Normal', () => {
    expect(resolve(`level=${lvl.id}&diff=normal`).r.runConfig.difficulty).toBeUndefined();
    expect(isNeutralRun(resolve(`level=${lvl.id}&diff=normal`).r.modifiers)).toBe(true);
    const { r, warns } = resolve(`level=${lvl.id}&diff=insane`);
    expect(r.runConfig.difficulty).toBeUndefined();
    expect(isNeutralRun(r.modifiers)).toBe(true);
    expect(warns.some((w) => w.includes('?diff=insane'))).toBe(true);
  });

  it('Endless and Daily ignore a difficulty; Easy drops challenges', () => {
    const e = resolve(`level=${lvl.id}&endless=1&diff=hard`);
    expect(e.r.runConfig.endless).toBe(true);
    expect(e.r.runConfig.difficulty).toBeUndefined();
    expect(e.r.modifiers).toEqual({ ...NEUTRAL_RUN_MODIFIERS, itemsDisabled: true });
    expect(e.warns.some((w) => w.includes('always Normal'))).toBe(true);
    const easy = resolve(`level=${lvl.id}&challenge=bowless&diff=easy`);
    expect(easy.r.runConfig.challenges).toEqual([]);
    expect(easy.r.runConfig.difficulty).toBe('easy');
    expect(easy.r.modifiers.bannedTowers).toEqual([]);
    const hardCh = resolve(`level=${lvl.id}&challenge=bowless&diff=hard`);
    expect(hardCh.r.runConfig.challenges).toEqual(['bowless']);
    expect(hardCh.r.modifiers.bannedTowers).toEqual(['archer']);
  });
});

describe('recording results per difficulty', () => {
  const lvl = LEVELS_2D[0];
  const win = (p: ProgressData, cfg: RunConfig, stars = 3, lives = 18) =>
    applyRunResult2D(p, { levelId: lvl.id, won: true, stars, livesRemaining: lives, waveReached: lvl.waves.length, runConfig: cfg, nowMs: NOW });

  it('an Easy win unlocks the next isle but awards one star, no badge, no lives record', () => {
    const p = createDefaultProgress(N);
    const res = win(p, { ...PLAIN, challenges: ['bowless'], difficulty: 'easy' }, 3, 25);
    expect(p.bestStars[0]).toBe(1);
    expect(p.unlockedLevelIndex).toBe(1);
    expect(p.clears[0]).toBe(1);
    expect(p.challengeClears[0]).toEqual([]);
    expect(p.bestLives[0]).toBe(0);
    expect(p.difficultyWins?.easy[0]).toBe(1);
    expect(p.difficultyWins?.normal[0]).toBe(0);
    expect(res.difficulty).toEqual({ id: 'easy', earnedStars: 3, awardedStars: 1, firstWin: true });
    const note = endNoteFor({ won: true, runConfig: { ...PLAIN, difficulty: 'easy' }, result: res, wave: 10, storyWaves: 10 });
    expect(note?.caption).toBe('Easy win: 1★ (play Normal or Hard for more)');
  });

  it('a Hard win keeps its stars, records the ribbon and says so once', () => {
    const p = createDefaultProgress(N);
    const cfg: RunConfig = { ...PLAIN, difficulty: 'hard' };
    const first = win(p, cfg, 2, 6);
    expect(p.bestStars[0]).toBe(2);
    expect(p.difficultyWins?.hard[0]).toBe(2);
    expect(first.difficulty?.firstWin).toBe(true);
    const n1 = endNoteFor({ won: true, runConfig: cfg, result: first, wave: 10, storyWaves: 10 });
    expect(n1).toEqual({ caption: 'Hard ribbon earned!', reward: true });
    const again = win(p, cfg, 3, 9);
    expect(again.difficulty?.firstWin).toBe(false);
    expect(p.difficultyWins?.hard[0]).toBe(3);
    expect(endNoteFor({ won: true, runConfig: cfg, result: again, wave: 10, storyWaves: 10 })).toBeNull();
    const st = islandStates(p)[0];
    expect(st.hardWon).toBe(true);
    expect(st.diffStars).toEqual({ easy: 0, normal: 0, hard: 3 });

    // Raw difficultyWins-only ProgressData derives stars, clears & mastery non-destructively in islandStates.
    const rawDwOnly = createDefaultProgress(N);
    rawDwOnly.difficultyWins = {
      easy: new Array<number>(N).fill(0),
      normal: new Array<number>(N).fill(0),
      hard: new Array<number>(N).fill(0),
    };
    rawDwOnly.difficultyWins.hard[0] = 3;
    const rawSt = islandStates(rawDwOnly)[0];
    expect(rawSt.stars).toBe(3);
    expect(rawSt.clears).toBe(1);
    expect(rawSt.hardWon).toBe(true);
    expect(rawDwOnly.bestStars[0]).toBe(0);
    expect(rawDwOnly.clears[0]).toBe(0);
  });

  it('a legacy save keeps its old wins as Normal when the first difficulty win is recorded', () => {
    const p = createDefaultProgress(N);
    p.bestStars[0] = 3;
    p.clears[0] = 2;
    p.bestStars[1] = 2;
    p.clears[1] = 1;
    p.unlockedLevelIndex = 2;
    expect(p.difficultyWins).toBeUndefined();
    expect(islandStates(p)[1].diffStars.normal).toBe(2);
    win(p, { ...PLAIN, difficulty: 'easy' });
    expect(p.difficultyWins?.normal.slice(0, 2)).toEqual([3, 2]);
    expect(p.difficultyWins?.easy[0]).toBe(1);
    expect(p.bestStars[0]).toBe(3);
  });

  it('Daily and Endless record nothing per difficulty beyond Normal', () => {
    const p = createDefaultProgress(N);
    const res = win(p, { ...PLAIN, difficulty: 'hard', daily: 20700, challenges: [] });
    expect(res.difficulty?.id).toBe('normal');
    expect(p.difficultyWins?.hard[0]).toBe(0);
  });
});

describe('difficulty record in saves', () => {
  it('survives migration, save codes and merges', () => {
    const p = createDefaultProgress(3);
    p.bestStars = [3, 1, 0];
    p.clears = [1, 1, 0];
    p.unlockedLevelIndex = 2;
    p.difficultyWins = { easy: [0, 1, 0], normal: [3, 0, 0], hard: [2, 0, 0] };
    const migrated = migrateProgress(JSON.parse(JSON.stringify(p)), 3);
    expect(migrated.difficultyWins).toEqual(p.difficultyWins);
    const code = encodeSaveCode(p);
    const back = decodeSaveCode(code, 3);
    expect(back.ok && back.progress.difficultyWins).toEqual(p.difficultyWins);
    // A legacy save (no record) merged in: its wins count as Normal.
    const legacy = createDefaultProgress(3);
    legacy.bestStars = [1, 3, 0];
    legacy.clears = [1, 1, 0];
    const merged = mergeProgress(p, legacy, 3);
    expect(merged.difficultyWins).toEqual({ easy: [0, 1, 0], normal: [3, 3, 0], hard: [2, 0, 0] });
    // Two legacy saves stay legacy (nothing invented).
    expect(mergeProgress(legacy, legacy, 3).difficultyWins).toBeUndefined();
    expect(migrateProgress(JSON.parse(JSON.stringify(legacy)), 3).difficultyWins).toBeUndefined();
  });

  it('follows its island when the island list is reordered', () => {
    const p = createDefaultProgress(2);
    p.bestStars = [2, 3];
    p.clears = [1, 1];
    p.unlockedLevelIndex = 1;
    p.difficultyWins = { easy: [0, 0], normal: [2, 0], hard: [0, 3] };
    const out = remapProgress(JSON.parse(JSON.stringify(p)), ['a', 'b'], [{ id: 'b' }, { id: 'new' }, { id: 'a' }]);
    expect(out.difficultyWins).toEqual({ easy: [0, 0, 0], normal: [0, 0, 2], hard: [3, 0, 0] });
  });
});

describe('selector wording', () => {
  it('builds the one-line rules from the data (EN and TR)', () => {
    const hp = Math.round(((DIFFICULTIES.easy.patch.enemyHpMul ?? 1) - 1) * -100);
    expect(difficultyRuleText('easy')).toContain(`−${hp}% health`);
    expect(difficultyRuleText('easy')).toContain('max 1★');
    expect(difficultyRuleText('easy').charAt(0)).toBe('F');
    expect(difficultyRuleText('hard')).toContain('Hard ribbon');
    expect(difficultyRuleText('normal')).toBe('The isle as it was built · up to 3★');
    setLocale('tr');
    expect(difficultyRuleText('hard')).toContain('Zor nişanı');
    expect(difficultyRuleText('easy')).toContain('en çok 1★');
  });

  it("shows Hard's flat starting-gold cut next to its percentage (and the kill gold / recharge)", () => {
    setLocale('en');
    const p = DIFFICULTIES.hard.patch;
    const n = Math.round((1 - (p.startGoldMul ?? 1)) * 100);
    const g = -(p.startGoldBonus ?? 0);
    expect(g).toBeGreaterThan(0);
    expect(difficultyRuleText('hard')).toContain(`starting gold −${n}% −${g}`);
    if ((p.killGoldMul ?? 1) > 1) expect(difficultyRuleText('hard')).toContain(`+${Math.round(((p.killGoldMul ?? 1) - 1) * 100)}% gold per foe`);
    if ((p.abilityCooldownMul ?? 1) > 1) expect(difficultyRuleText('hard')).toContain('abilities recharge');
    setLocale('tr');
    expect(difficultyRuleText('hard')).toContain(`başlangıç altını −%${n} −${g}`);
    setLocale('en');
  });

  it('pins the in-run difficulty pill centred on the wave banner rope across desktop and small windows', () => {
    for (const banner of [
      { x: 642, y: 547.5, w: 150, h: 44.5 }, // 800x600
      { x: 1086, y: 653.5, w: 181, h: 53.7 }, // 1280x720
      { x: 1630, y: 980, w: 271, h: 80.5 }, // 1920x1080
    ]) {
      const spot = difficultyBadgeSpot(banner);
      expect(spot.left).toBeCloseTo(banner.x + banner.w / 2, 5);
      expect(spot.top).toBeGreaterThan(banner.y);
      expect(spot.top).toBeLessThan(banner.y + banner.h * 0.45);
      expect(spot.fontSize).toBeGreaterThanOrEqual(11);
      expect(spot.fontSize).toBeLessThanOrEqual(16);
    }
  });
});
