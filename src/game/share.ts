import { CHALLENGES, isChallengeId } from '../data/challenges.ts';

/** ISO date (YYYY-MM-DD) of a UTC day number. */
export function dayToIsoDate(day: number): string {
  const d = Number.isFinite(day) ? Math.floor(day) : 0;
  return new Date(d * 86_400_000).toISOString().slice(0, 10);
}

export interface DailyShareInput {
  readonly day: number;
  readonly islandName: string;
  readonly challenges: readonly string[];
  readonly stars: number;
  readonly livesLost: number;
  /** Streak after this win (0/1 = no streak line). */
  readonly streak: number;
}

/**
 * A short, spoiler-free result line for a won Daily Squall, for the player to paste anywhere
 * (copied to the clipboard only — nothing is sent anywhere).
 */
export function dailyShareText(r: DailyShareInput): string {
  const stars = Math.max(0, Math.min(3, Math.floor(r.stars)));
  const starRow = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  const names = r.challenges.map((id) => (isChallengeId(id) ? CHALLENGES[id].name : id)).join(' + ');
  const lost = Math.max(0, Math.floor(r.livesLost));
  const lines = [
    `Skyhold Isles · Daily Squall ${dayToIsoDate(r.day)}`,
    `${r.islandName}${names ? ` · ${names}` : ''}`,
    `${starRow} · ${lost === 0 ? 'flawless' : `${lost} ${lost === 1 ? 'life' : 'lives'} lost`}${
      r.streak > 1 ? ` · ${r.streak}-day streak` : ''
    }`,
  ];
  return lines.join('\n');
}
