import { describe, expect, it } from 'vitest';
import {
  CODEX_KEY,
  ContentStore,
  ELITE_SEEN_ID,
  ONBOARDING_KEY,
  enemySeenId,
  inferSeenFromProgress,
  towerSeenId,
  type StorageLike,
} from '../../src/platform/contentStorage.ts';
import { LEVELS } from '../../src/data/levels/index.ts';

function memStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const freshProgress = { unlockedLevelIndex: 0, bestStars: new Array<number>(LEVELS.length).fill(0) };

describe('ContentStore', () => {
  it('starts empty and persists seen ids under its own versioned key', () => {
    const s = memStorage();
    const store = new ContentStore(s);
    expect(store.hasSeen(enemySeenId('grunt'))).toBe(false);
    expect(store.markSeen(enemySeenId('grunt'))).toBe(true);
    expect(store.markSeen(enemySeenId('grunt'))).toBe(false);
    const raw = JSON.parse(s.data.get(CODEX_KEY) ?? 'null') as { v: number; seen: string[] };
    expect(raw).toEqual({ v: 1, seen: ['enemy:grunt'], viewed: [] });
    // A second instance (page reload) sees the same state.
    expect(new ContentStore(s).hasSeen('enemy:grunt')).toBe(true);
  });

  it('never touches the progress or settings keys', () => {
    const s = memStorage({ skyhold_isles_progress_v1: '{"keep":1}', skyhold_isles_settings_v1: '{"keep":2}' });
    const store = new ContentStore(s);
    store.migrate(LEVELS, freshProgress);
    store.markSeen(ELITE_SEEN_ID);
    store.setOnboardingStatus('done');
    expect(s.data.get('skyhold_isles_progress_v1')).toBe('{"keep":1}');
    expect(s.data.get('skyhold_isles_settings_v1')).toBe('{"keep":2}');
  });

  it('survives corrupt JSON and missing storage', () => {
    const bad = memStorage({ [CODEX_KEY]: '{not json', [ONBOARDING_KEY]: '[]' });
    const store = new ContentStore(bad);
    expect(store.seenIds()).toEqual([]);
    expect(store.getOnboardingStatus()).toBe('pending');
    const none = new ContentStore(null);
    expect(none.markSeen('x')).toBe(true);
    expect(none.hasSeen('x')).toBe(true);
  });

  it('keeps onboarding status across reloads', () => {
    const s = memStorage();
    new ContentStore(s).setOnboardingStatus('skipped');
    expect(new ContentStore(s).getOnboardingStatus()).toBe('skipped');
    const raw = JSON.parse(s.data.get(ONBOARDING_KEY) ?? 'null') as { v: number; status: string };
    expect(raw).toEqual({ v: 1, status: 'skipped' });
  });

  it('migration: a brand-new player gets the tour and nothing pre-seen', () => {
    const store = new ContentStore(memStorage());
    store.migrate(LEVELS, freshProgress);
    expect(store.getOnboardingStatus()).toBe('pending');
    expect(store.seenIds()).toEqual([]);
  });

  it('migration: a returning player skips the tour and has already "met" the foes they fought', () => {
    const stars = new Array<number>(LEVELS.length).fill(0);
    stars[0] = 3;
    stars[1] = 2;
    stars[2] = 1;
    const store = new ContentStore(memStorage());
    store.migrate(LEVELS, { unlockedLevelIndex: 3, bestStars: stars }, (t) => t === 'hexer');
    expect(store.getOnboardingStatus()).toBe('done');
    expect(store.hasSeen('enemy:grunt')).toBe(true);
    expect(store.hasSeen('enemy:hexer')).toBe(true); // via the legacy toast key
    // Never-played end-game foes still get their card.
    expect(store.hasSeen('enemy:tempest')).toBe(false);
    expect(store.hasSeen(towerSeenId('beacon'))).toBe(false);
  });

  it('migration runs once: later launches keep what the player has since seen', () => {
    const s = memStorage();
    const first = new ContentStore(s);
    first.migrate(LEVELS, freshProgress);
    first.markSeen('enemy:grunt');
    const later = new ContentStore(s);
    later.migrate(LEVELS, { unlockedLevelIndex: 5, bestStars: [3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(later.getOnboardingStatus()).toBe('pending');
    expect(later.seenIds()).toEqual(['enemy:grunt']);
  });

  it('inferSeenFromProgress counts elite groups on cleared islands', () => {
    const withElite = LEVELS.findIndex((l) => l.waves.some((w) => w.groups.some((g) => g.elite)));
    expect(withElite).toBeGreaterThanOrEqual(0);
    const stars = new Array<number>(LEVELS.length).fill(0);
    stars[withElite] = 1;
    expect(inferSeenFromProgress(LEVELS, { unlockedLevelIndex: 0, bestStars: stars })).toContain(ELITE_SEEN_ID);
  });

  it('tracks which seen entries were opened in the codex ("new" dots)', () => {
    const st = memStorage();
    const store = new ContentStore(st);
    store.markSeen('enemy:golem');
    expect(store.isNew('enemy:golem')).toBe(true);
    expect(store.isNew('enemy:mite')).toBe(false); // not seen: silhouette, not new
    store.markViewed('enemy:mite'); // unseen entries cannot be "viewed"
    expect(store.isNew('enemy:mite')).toBe(false);
    store.markViewed('enemy:golem');
    expect(store.isNew('enemy:golem')).toBe(false);
    expect(new ContentStore(st).isNew('enemy:golem')).toBe(false);
  });

  it('saves from before "viewed" existed treat everything as already viewed; veterans get no backlog dots', () => {
    const old = memStorage({ [CODEX_KEY]: JSON.stringify({ v: 1, seen: ['enemy:grunt', 'enemy:runner'] }) });
    const store = new ContentStore(old);
    expect(store.isNew('enemy:grunt')).toBe(false);
    store.markSeen('enemy:brute');
    expect(store.isNew('enemy:brute')).toBe(true);

    const vet = new ContentStore(memStorage());
    vet.migrate(LEVELS, { unlockedLevelIndex: 3, bestStars: [3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(vet.seenIds().length).toBeGreaterThan(3);
    for (const id of vet.seenIds()) expect(vet.isNew(id)).toBe(false);
  });

  it('resetAll forgets sightings and brings the tour back', () => {
    const s = memStorage();
    const store = new ContentStore(s);
    store.migrate(LEVELS, { unlockedLevelIndex: 5, bestStars: [3, 3, 3, 3, 3, ...new Array<number>(LEVELS.length - 5).fill(0)] });
    expect(store.getOnboardingStatus()).toBe('done');
    store.resetAll();
    expect(store.seenIds().length).toBe(0);
    expect(store.getOnboardingStatus()).toBe('pending');
    const reloaded = new ContentStore(s);
    reloaded.migrate(LEVELS, freshProgress);
    expect(reloaded.seenIds().length).toBe(0);
    expect(reloaded.getOnboardingStatus()).toBe('pending');
  });

  it('adoptProgress after a save-code load skips the tour for a player with progress, not for an empty code', () => {
    const store = new ContentStore(memStorage());
    store.migrate(LEVELS, freshProgress);
    store.adoptProgress(LEVELS, freshProgress);
    expect(store.getOnboardingStatus()).toBe('pending');
    store.adoptProgress(LEVELS, { unlockedLevelIndex: 4, bestStars: [3, 2, 2, 1, ...new Array<number>(LEVELS.length - 4).fill(0)] });
    expect(store.getOnboardingStatus()).toBe('done');
    expect(store.seenIds().length).toBeGreaterThan(3);
    for (const id of store.seenIds()) expect(store.isNew(id)).toBe(false);
  });
});
