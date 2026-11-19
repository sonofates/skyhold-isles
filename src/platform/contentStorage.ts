import type { EnemyType, ProgressData, TowerType } from '../core/types.ts';
import type { LevelDef } from '../data/levels/types.ts';

/**
 * Persistence for the onboarding / first-sighting / codex features. Own localStorage keys (versioned)
 * so it never touches the progress or settings saves.
 */
export const CODEX_KEY = 'skyhold_isles_codex_v1';
export const ONBOARDING_KEY = 'skyhold_isles_onboarding_v1';

export type OnboardingStatus = 'pending' | 'done' | 'skipped';

/** Ids: `enemy:<type>`, `tower:<type>`, `elite`. */
export type SeenId = string;
export const enemySeenId = (t: EnemyType): SeenId => `enemy:${t}`;
export const towerSeenId = (t: TowerType): SeenId => `tower:${t}`;
export const ELITE_SEEN_ID: SeenId = 'elite';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Foe types that already got the older one-time "New foe" toast (legacy `enemy_intros_seen` key). */
const LEGACY_TOAST_TYPES: readonly EnemyType[] = [
  'healer', 'splitter', 'warden', 'burrower', 'carrier', 'blinker', 'golem', 'mite', 'hexer', 'tempest',
];

/** Ids a returning player has already met, inferred from how far their save got. */
export function inferSeenFromProgress(
  levels: readonly Pick<LevelDef, 'waves'>[],
  progress: Pick<ProgressData, 'unlockedLevelIndex' | 'bestStars'>,
  legacyEnemyIntroSeen: (type: string) => boolean = () => false,
): SeenId[] {
  const out = new Set<SeenId>();
  for (let i = 0; i < levels.length; i++) {
    // Cleared islands, and every island before the frontier, were played through.
    const played = (progress.bestStars[i] ?? 0) > 0 || i < progress.unlockedLevelIndex;
    if (!played) continue;
    for (const wave of levels[i].waves) {
      for (const g of wave.groups) {
        out.add(enemySeenId(g.enemyType));
        if (g.elite) out.add(ELITE_SEEN_ID);
      }
    }
  }
  for (const t of LEGACY_TOAST_TYPES) if (legacyEnemyIntroSeen(t)) out.add(enemySeenId(t));
  return [...out];
}

interface CodexSave {
  v: 1;
  seen: SeenId[];
  /** Entries the player has opened in the codex (drives the "new" dots). Absent in older saves. */
  viewed?: SeenId[];
}

export class ContentStore {
  private seen = new Set<SeenId>();
  private viewed = new Set<SeenId>();
  private status: OnboardingStatus = 'pending';
  /** False until the onboarding key has been written once (a brand-new player or a pre-tutorial save). */
  private statusKnown = false;
  private codexKnown = false;

  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null = defaultStorage()) {
    this.storage = storage;
    this.load();
  }

  private load(): void {
    const s = this.storage;
    if (!s) return;
    try {
      const raw = s.getItem(CODEX_KEY);
      if (raw) {
        const rawParsed: unknown = JSON.parse(raw);
        const parsed =
          rawParsed && typeof rawParsed === 'object' && !Array.isArray(rawParsed)
            ? (rawParsed as Partial<CodexSave>)
            : null;
        if (parsed && Array.isArray(parsed.seen)) {
          for (const v of parsed.seen) if (typeof v === 'string') this.seen.add(v);
          if (Array.isArray(parsed.viewed)) {
            for (const v of parsed.viewed) if (typeof v === 'string') this.viewed.add(v);
          } else {
            // Saved before "viewed" existed: nothing counts as new.
            for (const v of this.seen) this.viewed.add(v);
          }
          this.codexKnown = true;
        }
      }
    } catch {
      // corrupt: treat as empty
    }
    try {
      const raw = s.getItem(ONBOARDING_KEY);
      if (raw) {
        const rawParsed: unknown = JSON.parse(raw);
        const parsed =
          rawParsed && typeof rawParsed === 'object' && !Array.isArray(rawParsed)
            ? (rawParsed as { v?: number; status?: unknown })
            : null;
        if (
          parsed &&
          (parsed.status === 'pending' || parsed.status === 'done' || parsed.status === 'skipped')
        ) {
          this.status = parsed.status;
          this.statusKnown = true;
        }
      }
    } catch {
      // ignore
    }
  }

  /** First launch of this feature: seed from the player's existing progress so veterans see no recap. */
  migrate(
    levels: readonly Pick<LevelDef, 'waves'>[],
    progress: Pick<ProgressData, 'unlockedLevelIndex' | 'bestStars'>,
    legacyEnemyIntroSeen?: (type: string) => boolean,
  ): void {
    const veteran = progress.unlockedLevelIndex > 0 || progress.bestStars.some((n) => n > 0);
    if (!this.codexKnown) {
      for (const id of inferSeenFromProgress(levels, progress, legacyEnemyIntroSeen)) {
        this.seen.add(id);
        this.viewed.add(id); // a veteran's backlog is not "new"
      }
      this.codexKnown = true;
      this.saveSeen();
    }
    if (!this.statusKnown) {
      this.status = veteran ? 'done' : 'pending';
      this.statusKnown = true;
      this.saveStatus();
    }
  }

  hasSeen(id: SeenId): boolean {
    return this.seen.has(id);
  }

  /** Returns true when `id` was newly recorded. */
  markSeen(id: SeenId): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.saveSeen();
    return true;
  }

  /** Takes back a `markSeen` (an introduction that was queued but never actually shown). */
  unmarkSeen(id: SeenId): void {
    if (!this.seen.delete(id)) return;
    this.viewed.delete(id);
    this.saveSeen();
  }

  /** Seen but never opened in the codex. */
  isNew(id: SeenId): boolean {
    return this.seen.has(id) && !this.viewed.has(id);
  }

  markViewed(id: SeenId): void {
    if (this.viewed.has(id) || !this.seen.has(id)) return;
    this.viewed.add(id);
    this.saveSeen();
  }

  /** Settings → Reset progress: forget sightings/codex and run the tutorial again on island 1. */
  resetAll(): void {
    this.seen.clear();
    this.viewed.clear();
    this.codexKnown = true;
    this.saveSeen();
    this.setOnboardingStatus('pending');
  }

  /** After a save code is loaded: a player who now has progress skips the tutorial and keeps no "new" backlog. */
  adoptProgress(
    levels: readonly Pick<LevelDef, 'waves'>[],
    progress: Pick<ProgressData, 'unlockedLevelIndex' | 'bestStars'>,
  ): void {
    const veteran = progress.unlockedLevelIndex > 0 || progress.bestStars.some((n) => n > 0);
    if (!veteran) return;
    for (const id of inferSeenFromProgress(levels, progress)) {
      if (!this.seen.has(id)) {
        this.seen.add(id);
        this.viewed.add(id);
      }
    }
    this.saveSeen();
    if (this.status === 'pending') this.setOnboardingStatus('done');
  }

  seenIds(): readonly SeenId[] {
    return [...this.seen];
  }

  getOnboardingStatus(): OnboardingStatus {
    return this.status;
  }

  setOnboardingStatus(status: OnboardingStatus): void {
    this.status = status;
    this.statusKnown = true;
    this.saveStatus();
  }

  private saveSeen(): void {
    try {
      this.storage?.setItem(CODEX_KEY, JSON.stringify({ v: 1, seen: [...this.seen], viewed: [...this.viewed] } satisfies CodexSave));
    } catch {
      // quota / private mode
    }
  }

  private saveStatus(): void {
    try {
      this.storage?.setItem(ONBOARDING_KEY, JSON.stringify({ v: 1, status: this.status }));
    } catch {
      // quota / private mode
    }
  }
}
