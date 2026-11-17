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
}

export class ContentStore {
  private seen = new Set<SeenId>();
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
        const parsed = JSON.parse(raw) as Partial<CodexSave>;
        if (parsed && Array.isArray(parsed.seen)) {
          for (const v of parsed.seen) if (typeof v === 'string') this.seen.add(v);
          this.codexKnown = true;
        }
      }
    } catch {
      // corrupt: treat as empty
    }
    try {
      const raw = s.getItem(ONBOARDING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { v?: number; status?: unknown };
        if (parsed.status === 'pending' || parsed.status === 'done' || parsed.status === 'skipped') {
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
      for (const id of inferSeenFromProgress(levels, progress, legacyEnemyIntroSeen)) this.seen.add(id);
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
      this.storage?.setItem(CODEX_KEY, JSON.stringify({ v: 1, seen: [...this.seen] } satisfies CodexSave));
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
