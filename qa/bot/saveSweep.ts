import type { HeroId, ProgressData } from '../../src/core/types.ts';
import { challengesForLevel } from '../../src/data/challenges.ts';
import { difficultyWinsOf } from '../../src/data/difficulty.ts';
import { defaultSkillsForLevel, HERO_IDS, heroLevelFromXp, heroSkillPointsForLevel } from '../../src/data/heroes.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { buyRank, WORKSHOP_UPGRADES, workshopStarsSpent } from '../../src/data/workshop.ts';
import { starWallet } from '../../src/game/progression.ts';
import type { PlatformAdapter } from '../../src/platform/platform.ts';
import { describeMergeGain } from '../../src/platform/saveCode.ts';
import { createDefaultProgress } from '../../src/platform/storage.ts';
import {
  applyNode,
  heroSkillPointsSpent,
  isHeroUnlocked,
  respec,
  resolveHeroForRun,
  selectHero,
} from '../../src/render2d/heroes2d.ts';
import { dailyForToday, resolveQueryRun2D } from '../../src/render2d/ui/modes2d.ts';
import {
  applyRunResult2D,
  CLOUD_PROGRESS_2D_SLOT,
  decodeSaveCode2D,
  encodeSaveCode2D,
  hydrateProgress2DFromCloud,
  islandStates,
  remapProgress,
} from '../../src/render2d/ui/progress2d.ts';
import type { InvariantViolation } from './invariants.ts';

function assertProgressInvariants(
  p: ProgressData,
  label: string,
  violations: InvariantViolation[],
): void {
  const n = LEVELS_2D.length;
  const fail = (message: string): void => {
    violations.push({ kind: 'save_roundtrip', tick: 0, message: `[${label}] ${message}` });
  };

  if (p.bestStars.length !== n || p.clears.length !== n || p.bestLives.length !== n || p.bestEndlessWaves.length !== n) {
    fail(`island array length mismatch (expected ${n})`);
    return;
  }
  const wallet = starWallet(p);
  if (wallet.available < 0 || !Number.isFinite(wallet.available)) {
    fail(`negative or non-finite starWallet.available=${wallet.available}`);
  }
  const dw = difficultyWinsOf(p);
  for (let i = 0; i < n; i++) {
    const maxDiff = Math.max(dw.easy[i] ?? 0, dw.normal[i] ?? 0, dw.hard[i] ?? 0);
    if ((dw.easy[i] ?? 0) > 1) {
      fail(`island ${LEVELS_2D[i].id} Easy stars exceeded 1 (${dw.easy[i]})`);
    }
    if (p.bestStars[i] < maxDiff) {
      fail(`island ${LEVELS_2D[i].id} bestStars=${p.bestStars[i]} < max difficultyWins=${maxDiff}`);
    }
    if (p.bestStars[i] > 0 && p.clears[i] <= 0) {
      fail(`island ${LEVELS_2D[i].id} has bestStars=${p.bestStars[i]} with clears=${p.clears[i]}`);
    }
  }
  if (p.heroes) {
    if (!isHeroUnlocked(p, p.heroes.selectedHero, LEVELS_2D)) {
      fail(`selectedHero=${p.heroes.selectedHero} is locked on current progress`);
    }
    for (const id of HERO_IDS) {
      const entry = p.heroes.roster[id];
      if (!entry) continue;
      const budget = heroSkillPointsForLevel(heroLevelFromXp(entry.xp));
      const spent = heroSkillPointsSpent(id, entry.skills);
      if (spent > budget) {
        fail(`hero ${id} overspent skill points (${spent} > ${budget})`);
      }
    }
  }
}

/**
 * Pure headless campaign save/load mid-progress sweep covering:
 * - Incremental progression across all 25 islands (`l1c` -> `i24`, Chapter 1 -> Chapter 2)
 * - Difficulty wins (`Easy` 1★ cap & `bestLives` preservation, `Normal` 1–3★, `Hard` ribbons)
 * - Hero unlocks (`bran` -> `wren` -> `mira` -> `tobb` -> `sela`), XP/levels, skill nodes & respec
 * - Workshop purchases, Daily Squall streaks on Chapter 2 islands, Endless records
 * - Mid-campaign `SKY2-...` save-code round-trips, Chapter 1 (17) -> Chapter 2 (25) remapping,
 *   and cross-device Steam Cloud conflict merges (`hydrateProgress2DFromCloud`).
 */
export async function runMidProgressSaveSweep(): Promise<readonly InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const p = createDefaultProgress(LEVELS_2D.length);
  const baseDayMs = Date.UTC(2026, 10, 1, 12, 0, 0);

  // Step 1: Clear l1c on Easy (3 earned stars -> 1 awarded star, bestLives stays 0, unlocks i01).
  const easyRes = applyRunResult2D(
    p,
    {
      levelId: 'l1c',
      won: true,
      stars: 3,
      livesRemaining: 25,
      waveReached: LEVELS_2D[0].waves.length,
      runConfig: { endless: false, challenges: ['bowless'], daily: null, difficulty: 'easy' },
      heroId: 'bran',
      enemiesKilled: 95,
      wavesCleared: LEVELS_2D[0].waves.length,
    },
    LEVELS_2D,
  );
  if (easyRes.difficulty?.awardedStars !== 1 || p.bestLives[0] !== 0 || p.challengeClears[0].length !== 0) {
    violations.push({
      kind: 'save_roundtrip',
      tick: 0,
      message: `Easy l1c clear violated Easy reward rules: ${JSON.stringify(easyRes.difficulty)}, bestLives=${p.bestLives[0]}`,
    });
  }
  assertProgressInvariants(p, 'after-easy-l1c', violations);

  // Step 2: Replay l1c on Hard (2★ + bowless badge + Hard ribbon + bestLives recorded), then progress through i16 -> i24.
  applyRunResult2D(
    p,
    {
      levelId: 'l1c',
      won: true,
      stars: 2,
      livesRemaining: 14,
      waveReached: LEVELS_2D[0].waves.length,
      runConfig: { endless: false, challenges: ['bowless'], daily: null, difficulty: 'hard' },
      heroId: 'bran',
      enemiesKilled: 110,
      wavesCleared: LEVELS_2D[0].waves.length,
    },
    LEVELS_2D,
  );
  if (p.bestLives[0] !== 14 || !islandStates(p, LEVELS_2D)[0].hardWon) {
    violations.push({
      kind: 'save_roundtrip',
      tick: 0,
      message: `Hard l1c clear failed to record bestLives=${p.bestLives[0]} or Hard ribbon`,
    });
  }

  for (let idx = 1; idx < LEVELS_2D.length; idx++) {
    const lvl = LEVELS_2D[idx];
    const diff = idx % 3 === 0 ? 'hard' : idx % 5 === 0 ? 'easy' : 'normal';
    const offered = challengesForLevel(lvl);
    const activeHero: HeroId = HERO_IDS.filter((h) => isHeroUnlocked(p, h, LEVELS_2D)).at(-1) ?? 'bran';
    const selected = selectHero(p, activeHero, LEVELS_2D);
    if (selected) p.heroes = selected.heroes;

    applyRunResult2D(
      p,
      {
        levelId: lvl.id,
        won: true,
        stars: idx % 2 === 0 ? 3 : 2,
        livesRemaining: diff === 'easy' ? 25 : 16,
        waveReached: lvl.waves.length,
        runConfig: {
          endless: false,
          challenges: diff !== 'easy' && offered[0] ? [offered[0]] : [],
          daily: null,
          ...(diff !== 'normal' ? { difficulty: diff } : {}),
        },
        heroId: activeHero,
        enemiesKilled: 180 + idx * 12,
        wavesCleared: lvl.waves.length,
      },
      LEVELS_2D,
    );

    // Spend available Workshop stars mid-campaign.
    for (const upg of WORKSHOP_UPGRADES) {
      const avail = starWallet(p).available;
      const nextRanks = buyRank(p.workshop, upg.id, avail);
      if (nextRanks) p.workshop = nextRanks;
    }

    // Unlock a hero skill node mid-campaign and verify save-code round-trip at Chapter 1->2 boundary (i16 -> i17) & boss i24.
    const curLvl = heroLevelFromXp(p.heroes?.roster[activeHero]?.xp ?? 0);
    for (const nodeId of defaultSkillsForLevel(activeHero, curLvl)) {
      const withNode = applyNode(p, activeHero, nodeId, LEVELS_2D);
      if (withNode) p.heroes = withNode.heroes;
    }

    if (lvl.id === 'i16' || lvl.id === 'i20' || lvl.id === 'i24') {
      assertProgressInvariants(p, `mid-campaign-${lvl.id}`, violations);
      const code = encodeSaveCode2D(p, LEVELS_2D);
      const decoded = decodeSaveCode2D(code, LEVELS_2D);
      if (!decoded.ok) {
        violations.push({
          kind: 'save_roundtrip',
          tick: 0,
          message: `decodeSaveCode2D failed at ${lvl.id}: ${decoded.error}`,
        });
      } else {
        assertProgressInvariants(decoded.progress, `decoded-${lvl.id}`, violations);
        if (
          JSON.stringify(decoded.progress.bestStars) !== JSON.stringify(p.bestStars) ||
          JSON.stringify(decoded.progress.difficultyWins) !== JSON.stringify(p.difficultyWins) ||
          workshopStarsSpent(decoded.progress.workshop) !== workshopStarsSpent(p.workshop) ||
          decoded.progress.heroes?.selectedHero !== p.heroes?.selectedHero
        ) {
          violations.push({
            kind: 'save_roundtrip',
            tick: 0,
            message: `save code round-trip lost fields at ${lvl.id}`,
          });
        }

        // Verify mid-campaign URL + hero resolution (`?level=i17&diff=hard`) works seamlessly from decoded save.
        const nextId = lvl.id === 'i16' ? 'i17' : 'i24';
        const resolved = resolveQueryRun2D(
          new URLSearchParams(`level=${nextId}&diff=hard`),
          decoded.progress,
          { nowMs: baseDayMs, levels: LEVELS_2D, warn: () => undefined },
        );
        const heroRun = resolveHeroForRun(decoded.progress, null, null, LEVELS_2D);
        if (!resolved.level || resolved.runConfig.difficulty !== 'hard' || !heroRun) {
          violations.push({
            kind: 'save_roundtrip',
            tick: 0,
            message: `mid-progress resolveQueryRun2D / resolveHeroForRun failed on ${nextId}`,
          });
        }
      }
    }
  }

  // Step 3: Exercise respec + Daily Squall on Chapter-Two cleared roster + Endless record on i24.
  const respecced = respec(p, 'sela', LEVELS_2D);
  p.heroes = respecced.heroes;
  if ((p.heroes?.roster.sela?.skills.length ?? 0) !== 0) {
    violations.push({ kind: 'save_roundtrip', tick: 0, message: 'respec failed to clear sela skills' });
  }

  let ch2DailyFound = false;
  for (let d = 0; d < 40; d++) {
    const dayMs = baseDayMs + d * 86_400_000;
    const daily = dailyForToday(dayMs, p, LEVELS_2D);
    if (daily && daily.levelIndex >= 17) {
      ch2DailyFound = true;
      applyRunResult2D(
        p,
        {
          levelId: daily.levelId,
          won: true,
          stars: 3,
          livesRemaining: 19,
          waveReached: daily.level.waves.length,
          runConfig: { endless: false, challenges: [...daily.challenges], daily: daily.day },
          nowMs: dayMs,
          heroId: 'sela',
          enemiesKilled: 260,
          wavesCleared: daily.level.waves.length,
        },
        LEVELS_2D,
      );
      break;
    }
  }
  if (!ch2DailyFound) {
    violations.push({
      kind: 'save_roundtrip',
      tick: 0,
      message: 'dailyForToday never selected a Chapter 2 island across 40 UTC days with all 25 islands cleared',
    });
  }

  applyRunResult2D(
    p,
    {
      levelId: 'i24',
      won: false,
      stars: 0,
      livesRemaining: 0,
      waveReached: LEVELS_2D[24].waves.length + 11,
      runConfig: { endless: true, challenges: [], daily: null },
      heroId: 'mira',
      enemiesKilled: 520,
      wavesCleared: LEVELS_2D[24].waves.length + 10,
    },
    LEVELS_2D,
  );
  assertProgressInvariants(p, 'after-ch2-daily-and-endless', violations);

  // Step 4: Chapter 1 (17-island) legacy save remapped onto 25 islands + Steam Cloud conflict merge.
  const ch1Ids = LEVELS_2D.slice(0, 17).map((l) => l.id);
  const legacyCh1 = createDefaultProgress(17);
  legacyCh1.bestStars.fill(3);
  legacyCh1.clears.fill(1);
  legacyCh1.unlockedLevelIndex = 16;
  const remapped25 = remapProgress(legacyCh1, ch1Ids, LEVELS_2D);
  if (remapped25.unlockedLevelIndex !== 17 || remapped25.bestStars[16] !== 3 || remapped25.bestStars[17] !== 0) {
    violations.push({
      kind: 'save_roundtrip',
      tick: 0,
      message: `17->25 Chapter 2 remap failed to open i17 (unlockedLevelIndex=${remapped25.unlockedLevelIndex})`,
    });
  }

  const cloudStore = new Map<string, string>();
  const cloudProgress = createDefaultProgress(LEVELS_2D.length);
  applyRunResult2D(
    cloudProgress,
    {
      levelId: 'i16',
      won: true,
      stars: 3,
      livesRemaining: 20,
      waveReached: LEVELS_2D[16].waves.length,
      runConfig: { endless: false, challenges: [], daily: null, difficulty: 'hard' },
      heroId: 'tobb',
      enemiesKilled: 300,
      wavesCleared: LEVELS_2D[16].waves.length,
    },
    LEVELS_2D,
  );
  cloudStore.set(
    CLOUD_PROGRESS_2D_SLOT,
    JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: cloudProgress }),
  );
  const mockSteamAdapter: PlatformAdapter = {
    name: 'steam',
    isSteam: true,
    isMobile: false,
    overlayActive: false,
    onPause: () => () => undefined,
    onResume: () => () => undefined,
    onOverlayChange: () => () => undefined,
    achievements: {
      unlock: () => Promise.resolve(true),
      isUnlocked: () => false,
    },
    cloudSave: {
      read: (slot) => Promise.resolve(cloudStore.get(slot) ?? null),
      write: (slot, json) => {
        cloudStore.set(slot, json);
        return Promise.resolve(true);
      },
    },
  };
  const hydrated = await hydrateProgress2DFromCloud(remapped25, LEVELS_2D, mockSteamAdapter);
  assertProgressInvariants(hydrated.merged, 'cloud-hydrated', violations);
  const gainDesc = describeMergeGain(remapped25, hydrated.merged);
  if (!hydrated.merged.difficultyWins || hydrated.merged.difficultyWins.hard[16] !== 3 || !gainDesc.includes('Hard ribbon')) {
    violations.push({
      kind: 'save_roundtrip',
      tick: 0,
      message: `cloud merge missed Hard ribbon on i16 (gain="${gainDesc}")`,
    });
  }

  return violations;
}
