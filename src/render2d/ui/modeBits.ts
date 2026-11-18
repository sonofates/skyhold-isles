/**
 * Shared bits for showing run modes (island challenges, Daily Squall, Endless) in the painted UI:
 * rule seals, Endless record wording, and the end-panel note after a mode run. The wording helpers
 * are pure (tested); the rules themselves live in src/data (challenges, daily, endlessMutators) and
 * the results come from progress2d.ts.
 */
import { CHALLENGES, type ChallengeId } from '../../data/challenges.ts';
import { ENDLESS_TIERS, endlessTier, endlessWavesCleared } from '../../data/endlessMutators.ts';
import type { RunConfig } from '../../game/runConfig.ts';
import type { RunResultRecord2D } from './progress2d.ts';

/** Medal name for an Endless tier (1 bronze .. 3 gold), '' for none. */
export function tierName(tier: number): string {
  return tier >= 1 && tier <= ENDLESS_TIERS.length ? ENDLESS_TIERS[tier - 1].name : '';
}

/** Kit-friendly colour for an Endless medal tier. */
export function tierColour(tier: number): string {
  return tier >= 3 ? '#f2b33d' : tier === 2 ? '#c9d3dc' : tier === 1 ? '#c98a4b' : '#b9a27c';
}

export interface EndlessRecordText {
  /** Short record, e.g. "Wave 14" or "No record yet". */
  readonly best: string;
  /** Medal tier 0..3 and its name ('' for none). */
  readonly tier: number;
  readonly tierName: string;
  /** What the next medal needs, e.g. "Bronze: clear wave 13" ('' after gold). */
  readonly next: string;
}

/**
 * Wording for an island's Endless best (`bestWave` = one-based wave the best run fell on; 0 = none).
 * Records count only past the island's story waves, like the 3D build.
 */
export function endlessRecordText(bestWave: number, storyWaves: number): EndlessRecordText {
  const tier = endlessTier(bestWave, storyWaves);
  const nextTier = ENDLESS_TIERS[tier];
  const togo = nextTier ? nextTier.cleared - endlessWavesCleared(bestWave, storyWaves) : 0;
  return {
    best: bestWave > storyWaves ? `Wave ${Math.floor(bestWave)}` : 'No record yet',
    tier,
    tierName: tierName(tier),
    next: nextTier ? `${nextTier.name}: clear wave ${storyWaves + nextTier.cleared}${togo > 0 && tier > 0 ? ` (${togo} more)` : ''}` : '',
  };
}

/** Changes the end panel makes for a mode run (null fields keep the panel's own text). */
export interface EndModeNote {
  /** Ribbon title override ("Endless Run"). */
  readonly title?: string;
  /** Summary line override (the wave line on a defeat board). */
  readonly line1?: string;
  /** Replaces the flavour caption under the summary. */
  readonly caption: string;
  /** Use the victory board art even though the run ended in a defeat (Endless). */
  readonly victoryBoard?: boolean;
  /** Caption drawn as a reward (warm red-brown, bold) rather than the soft flavour ink. */
  readonly reward?: boolean;
}

export interface EndNoteInput {
  readonly won: boolean;
  readonly runConfig: Readonly<RunConfig>;
  readonly result: RunResultRecord2D | null;
  /** One-based wave the run ended on. */
  readonly wave: number;
  readonly storyWaves: number;
  /** The island became mastered by this run. */
  readonly masteredNow?: boolean;
}

const names = (ids: readonly string[]): string =>
  ids.map((id) => (id in CHALLENGES ? CHALLENGES[id as ChallengeId].name : id)).join(' & ');

/**
 * End-panel note for a run with a mode (challenge badges earned, Daily Squall result, Endless
 * record). Null for a plain campaign run, or when there is nothing to add.
 */
export function endNoteFor(i: EndNoteInput): EndModeNote | null {
  const cfg = i.runConfig;
  if (cfg.endless) {
    const e = i.result?.endless ?? null;
    if (!e?.reachedEndless) {
      return {
        title: 'Endless Run',
        line1: `Wave ${Math.max(1, i.wave)}/${i.storyWaves}`,
        caption: `Records start past wave ${i.storyWaves}`,
      };
    }
    const tier = endlessTier(e.best, i.storyWaves);
    const medal = tier > 0 ? ` · ${tierName(tier)} medal` : '';
    return {
      title: 'Endless Run',
      line1: `Wave ${Math.max(1, i.wave)}`,
      caption: e.isNewBest ? `New best: wave ${e.best}!${medal}` : `Best: wave ${e.best}${medal}`,
      victoryBoard: true,
      reward: e.isNewBest,
    };
  }
  if (!i.won) return null;
  const parts: string[] = [];
  let reward = false;
  if (cfg.daily !== null) {
    const d = i.result?.daily ?? null;
    if (d?.counted) {
      parts.push(`Daily Squall won +1★ · ${d.streak}-day streak`);
      reward = true;
    } else parts.push('Daily Squall won · reward taken today');
  }
  const fresh = i.result?.win?.newChallenges ?? [];
  if (fresh.length > 0) {
    parts.push(`${fresh.length > 1 ? 'Badges' : 'Badge'}: ${names(fresh)} +${fresh.length}★`);
    reward = true;
  } else if (cfg.daily === null && cfg.challenges.length > 0) {
    parts.push(`Challenge won: ${names(cfg.challenges)}`);
  }
  if (i.masteredNow) {
    parts.push('Isle mastered!');
    reward = true;
  }
  return parts.length > 0 ? { caption: parts.join(' · '), reward } : null;
}
