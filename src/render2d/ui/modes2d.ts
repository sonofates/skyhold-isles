/**
 * Pure mode, challenge, Daily Squall, Endless, and run-modifier helpers for the 2D front end.
 *
 * Reuses the 3D build's data and composition functions (`workshopModifiers`, `runModifiersFor`,
 * `challengesForLevel`, `dailyChallengeFor`, `utcDayNumber`) without forking any math.
 */
import type { ProgressData } from '../../core/types.ts';
import {
  CHALLENGE_IDS_2D,
  CHALLENGES,
  challengesForLevel,
  isChallengeEffectiveIn2D,
  isChallengeId,
  runModifiersFor,
  type ChallengeDef,
  type ChallengeId,
} from '../../data/challenges.ts';
import { dailyChallengeFor, utcDayNumber, type DailyChallenge } from '../../data/daily.ts';
import { DIFFICULTIES, parseDifficulty, withDifficulty, type DifficultyId } from '../../data/difficulty.ts';
import { getLevelById, LEVELS_2D } from '../../data/levels2d/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { isNeutralRun, NEUTRAL_RUN_MODIFIERS, type RunModifiers } from '../../data/runModifiers.ts';
import { sanitizeRanks, workshopModifiers, type WorkshopRanks } from '../../data/workshop.ts';
import type { RunConfig } from '../../game/runConfig.ts';
import { indexOf2D } from './progress2d.ts';

export { audioSettings2d, type AudioSettings2D } from '../settings2d.ts';

export interface AvailableChallenge2D extends ChallengeDef {
  /** Whether the player has already earned this challenge's badge on the island. */
  readonly completed: boolean;
}

export interface Daily2D extends DailyChallenge {
  readonly levelId: string;
  readonly level: LevelDef;
}

export interface ResolvedRun2D {
  readonly levelId: string;
  readonly level: LevelDef | null;
  readonly runConfig: RunConfig;
  readonly modifiers: RunModifiers;
}

export interface ResolveQueryOptions2D {
  readonly nowMs?: number;
  readonly levels?: readonly LevelDef[];
  readonly lookupLevel?: (id: string) => LevelDef | null;
  readonly warn?: (msg: string) => void;
  /** Include saved Workshop upgrades in `modifiers` (true in normal play, false in debug scenes). */
  readonly applySaveModifiers?: boolean;
}

function isPosFinite(val: unknown): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val > 0;
}

function isIslandCleared(progress: ProgressData, index: number): boolean {
  const rawDw = progress.difficultyWins ?? (progress as unknown as { readonly dw?: unknown }).dw;
  const dw =
    rawDw && typeof rawDw === 'object' && !Array.isArray(rawDw)
      ? (rawDw as Partial<
          Record<'easy' | 'normal' | 'hard' | 'e' | 'n' | 'h', readonly unknown[] | undefined>
        >)
      : undefined;
  return (
    isPosFinite(progress.clears?.[index]) ||
    isPosFinite(progress.bestStars?.[index]) ||
    isPosFinite(dw?.easy?.[index]) ||
    isPosFinite(dw?.e?.[index]) ||
    isPosFinite(dw?.normal?.[index]) ||
    isPosFinite(dw?.n?.[index]) ||
    isPosFinite(dw?.hard?.[index]) ||
    isPosFinite(dw?.h?.[index])
  );
}

/**
 * Island challenges offered on `levelId` for the briefing card.
 * Locked (returns `[]`) until the island has been cleared at least once, matching the 3D briefing.
 */
export function availableChallenges(
  levelId: string,
  progress: ProgressData,
  levels: readonly LevelDef[] = LEVELS_2D,
): AvailableChallenge2D[] {
  const i = indexOf2D(levelId, levels);
  if (i < 0 || !isIslandCleared(progress, i)) return [];
  const rawDone = Array.isArray(progress.challengeClears) ? progress.challengeClears[i] : undefined;
  const done = Array.isArray(rawDone) ? rawDone : [];
  return challengesForLevel(levels[i]).map((id) => ({
    ...CHALLENGES[id],
    completed: done.includes(id),
  }));
}

/**
 * Deterministic Daily Squall for `date` (UTC day) over the 2D island list.
 * - When `progress` is passed, picks only among cleared islands (returns `null` until one is cleared).
 * - When `progress` is omitted, picks deterministically across all `levels` (pure date lookup).
 */
export function dailyForToday(
  date: Date | number,
  progress?: ProgressData,
  levels: readonly LevelDef[] = LEVELS_2D,
): Daily2D | null {
  const ms = date instanceof Date ? date.getTime() : date;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || levels.length === 0) return null;
  const cleared: number[] = [];
  if (progress) {
    levels.forEach((_, i) => {
      if (isIslandCleared(progress, i)) cleared.push(i);
    });
  } else {
    levels.forEach((_, i) => cleared.push(i));
  }
  const dc = dailyChallengeFor(utcDayNumber(ms), cleared, CHALLENGE_IDS_2D);
  if (!dc) return null;
  const level = levels[dc.levelIndex];
  if (!level) return null;
  return { ...dc, levelId: level.id, level };
}

/**
 * Whether Endless mode can be started from `levelId`'s briefing card.
 * Unlocks once the island has been cleared at least once.
 */
export function canPlayEndless(
  levelId: string,
  progress: ProgressData,
  levels: readonly LevelDef[] = LEVELS_2D,
): boolean {
  const i = indexOf2D(levelId, levels);
  return i >= 0 && isIslandCleared(progress, i);
}

/**
 * Composes Workshop ranks + active challenges into `RunModifiers`, using the exact 3D functions
 * (`GameSession.buildRunModifiers` = `runModifiersFor(workshopModifiers(workshop), challenges)`),
 * then stacks the difficulty patch on top (Normal adds nothing).
 */
export function composeRunModifiers2D(
  workshop: WorkshopRanks,
  challenges: readonly ChallengeId[] = [],
  difficulty: DifficultyId = 'normal',
): RunModifiers {
  return withDifficulty(runModifiersFor(workshopModifiers(workshop), challenges), difficulty);
}

/**
 * URL builder for 2D runs (`?level=<id>` plus optional `challenge`, `daily=1`, `endless=1`,
 * `diff=easy|hard`, `intro=1`). Normal difficulty is the default and is left out; Daily and
 * Endless never carry one.
 */
export function buildRunHref2D(
  levelId: string,
  opts: {
    readonly challenges?: readonly ChallengeId[];
    readonly daily?: boolean;
    readonly endless?: boolean;
    readonly difficulty?: DifficultyId;
    readonly intro?: boolean;
    readonly pathname?: string;
  } = {},
): string {
  const base = opts.pathname ?? (typeof location !== 'undefined' ? location.pathname : '/2d.html');
  const params: string[] = [`level=${encodeURIComponent(levelId)}`];
  if (opts.daily) {
    params.push('daily=1');
  } else if (opts.endless) {
    params.push('endless=1');
  } else {
    const diff = opts.difficulty && DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'normal';
    if (opts.challenges && opts.challenges.length > 0 && DIFFICULTIES[diff].allowsChallenges) {
      for (const id of opts.challenges) params.push(`challenge=${encodeURIComponent(id)}`);
    }
    if (diff !== 'normal') params.push(`diff=${diff}`);
  }
  if (opts.intro) params.push('intro=1');
  return `${base}?${params.join('&')}`;
}

/** URL that launches today's Daily Squall on `levelId` (`?level=<id>&daily=1`). */
export function dailyHref2D(levelId: string, pathname?: string): string {
  return buildRunHref2D(levelId, { daily: true, pathname });
}

/**
 * Resolves URL query params (`?level=`, `?challenge=<id>`, `?daily=1`, `?endless=1`,
 * `?diff=easy|normal|hard`) and the 2D save's Workshop upgrades into the level, `RunConfig`, and
 * `RunModifiers` for `Game2D`. Unknown ids / values are ignored with `warn(...)`. Daily and Endless
 * runs are always Normal; Easy runs carry no challenges.
 */
export function resolveQueryRun2D(
  q: URLSearchParams,
  progress: ProgressData,
  opts: ResolveQueryOptions2D = {},
): ResolvedRun2D {
  const nowMs = typeof opts.nowMs === 'number' && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const levels = opts.levels ?? LEVELS_2D;
  const lookup = opts.lookupLevel ?? getLevelById;
  const warn = opts.warn ?? ((msg: string): void => console.warn(msg));
  const applySaveModifiers = opts.applySaveModifiers ?? true;

  let endlessReq = false;
  if (q.has('endless')) {
    const raw = q.get('endless');
    if (raw === '1') endlessReq = true;
    else if (raw !== '0') warn(`[skyhold-2d] Unknown ?endless=${String(raw)}; expected 1.`);
  }

  let dailyReq = false;
  if (q.has('daily')) {
    const raw = q.get('daily');
    if (raw === '1') dailyReq = true;
    else if (raw !== '0') warn(`[skyhold-2d] Unknown ?daily=${String(raw)}; expected 1.`);
  }

  const challengesReq: ChallengeId[] = [];
  if (q.has('challenge')) {
    for (const rawVal of q.getAll('challenge')) {
      for (const part of rawVal.split(',')) {
        const token = part.trim();
        if (!token) {
          warn('[skyhold-2d] Empty ?challenge= parameter ignored.');
          continue;
        }
        if (!isChallengeId(token)) {
          warn(`[skyhold-2d] Unknown challenge id "${token}" ignored.`);
          continue;
        }
        if (!isChallengeEffectiveIn2D(CHALLENGES[token])) {
          warn(`[skyhold-2d] Challenge "${token}" has no effect in 2D; ignored.`);
          continue;
        }
        if (!challengesReq.includes(token)) challengesReq.push(token);
      }
    }
  }

  let diffReq: DifficultyId = 'normal';
  if (q.has('diff')) {
    const raw = q.get('diff');
    const parsed = parseDifficulty(raw);
    if (parsed) diffReq = parsed;
    else warn(`[skyhold-2d] Unknown ?diff=${String(raw)}; expected easy, normal or hard. Playing Normal.`);
  }

  const dailyToday = dailyReq ? dailyForToday(nowMs, progress, levels) : null;

  let levelId: string;
  let level: LevelDef | null;
  if (q.has('level')) {
    levelId = q.get('level') ?? '';
    const found = lookup(levelId);
    if (!found?.layout2d) {
      warn(`[skyhold-2d] Unknown 2D island "${levelId}".`);
      return {
        levelId,
        level: null,
        runConfig: { endless: false, challenges: [], daily: null },
        modifiers: NEUTRAL_RUN_MODIFIERS,
      };
    }
    level = found;
    levelId = found.id;
  } else if (dailyReq && !endlessReq) {
    if (dailyToday) {
      level = dailyToday.level;
      levelId = dailyToday.levelId;
    } else {
      warn('[skyhold-2d] Daily Squall requires at least one cleared island; falling back to l1c.');
      dailyReq = false;
      level = lookup('l1c');
      levelId = 'l1c';
    }
  } else {
    level = lookup('l1c');
    levelId = 'l1c';
  }

  if (!level?.layout2d) {
    return {
      levelId,
      level: null,
      runConfig: { endless: false, challenges: [], daily: null },
      modifiers: NEUTRAL_RUN_MODIFIERS,
    };
  }

  let runConfig: RunConfig;
  if (endlessReq) {
    if (dailyReq || challengesReq.length > 0) {
      warn('[skyhold-2d] ?endless=1 runs without daily or challenge modifiers; extra params ignored.');
    }
    runConfig = { endless: true, challenges: [], daily: null };
  } else if (dailyReq) {
    if (!dailyToday) {
      warn('[skyhold-2d] Daily Squall requires at least one cleared island; ignoring ?daily=1.');
      runConfig = { endless: false, challenges: [], daily: null };
    } else if (q.has('level') && level.id !== dailyToday.levelId) {
      warn(`[skyhold-2d] Today's Daily Squall is on "${dailyToday.levelId}", not "${level.id}"; ignoring ?daily=1.`);
      runConfig = { endless: false, challenges: [], daily: null };
    } else {
      if (challengesReq.length > 0) {
        warn('[skyhold-2d] ?daily=1 uses today\'s fixed challenge pair; ignoring extra ?challenge= params.');
      }
      runConfig = { endless: false, challenges: [...dailyToday.challenges], daily: dailyToday.day };
    }
  } else {
    runConfig = { endless: false, challenges: challengesReq, daily: null };
  }
  if (diffReq !== 'normal') {
    if (runConfig.endless || runConfig.daily !== null) {
      warn(`[skyhold-2d] ${runConfig.endless ? 'Endless' : 'Daily Squall'} runs are always Normal; ignoring ?diff=${diffReq}.`);
    } else {
      if (!DIFFICULTIES[diffReq].allowsChallenges && runConfig.challenges.length > 0) {
        warn(`[skyhold-2d] Challenges cannot be played on ${diffReq}; ignoring ?challenge= params.`);
        runConfig = { ...runConfig, challenges: [] };
      }
      runConfig = { ...runConfig, difficulty: diffReq };
    }
  }
  const difficulty = runConfig.difficulty ?? 'normal';

  const workshop = applySaveModifiers ? sanitizeRanks(progress.workshop) : {};
  const hasWorkshop = Object.keys(workshop).length > 0;
  const composed =
    !hasWorkshop && runConfig.challenges.length === 0 && difficulty === 'normal'
      ? NEUTRAL_RUN_MODIFIERS
      : composeRunModifiers2D(workshop, runConfig.challenges, difficulty);
  const competitive = runConfig.endless || runConfig.daily !== null || runConfig.challenges.length > 0;
  const modifiers = competitive ? { ...composed, itemsDisabled: true }
    : isNeutralRun(composed) ? NEUTRAL_RUN_MODIFIERS : composed;

  return { levelId, level, runConfig, modifiers };
}
