/**
 * DOM checks of the decluttered island briefing (render2d/ui/briefing.ts): the island and Play come
 * first, the flavour line is the medallion's tooltip, hero + belt share one loadout row in the
 * island's column, the difficulty rule line only shows off Normal, and Endless / challenges still
 * turn the belt off. Uses happy-dom when it is installed (dev-only) and skips otherwise.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import type { DifficultyId } from '../../src/data/difficulty.ts';
import type { IslandState } from '../../src/render2d/ui/progress2d.ts';

let WindowCtor: (new () => unknown) | undefined;
try {
  const moduleName = 'happy-dom'; // variable specifier: not a declared dependency
  WindowCtor = ((await import(/* @vite-ignore */ moduleName)) as { Window: new () => unknown }).Window;
} catch {
  WindowCtor = undefined;
}

function island(over: Partial<IslandState> = {}): IslandState {
  return {
    index: 3,
    level: LEVELS_2D[3],
    unlocked: true,
    stars: 2,
    clears: 0,
    bestLives: 0,
    bestEndlessWave: 0,
    challengeClears: [],
    mastered: false,
    frontier: true,
    diffStars: { easy: 0, normal: 0, hard: 0 },
    hardWon: false,
    ...over,
  };
}

describe.skipIf(!WindowCtor)('island briefing (DOM)', () => {
  beforeAll(async () => {
    const win = new WindowCtor!() as unknown as Window & typeof globalThis;
    const g = globalThis as unknown as Record<string, unknown>;
    for (const k of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'localStorage']) {
      g[k] = k === 'window' ? win : (win as unknown as Record<string, unknown>)[k];
    }
    g.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
    const { setLocale } = await import('../../src/i18n/index.ts');
    setLocale('en');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const fakeBelt = () => {
    const update = vi.fn<(d: DifficultyId, off: boolean) => void>();
    const el = document.createElement('div');
    el.dataset.testid = 'brief2d-belt';
    return { el, update };
  };
  const fakeHero = () => {
    const el = document.createElement('div');
    el.dataset.testid = 'brief2d-hero';
    return el;
  };
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it('first visit: island facts, a short lock note, one loadout row, compact difficulty, big Play', async () => {
    const { showBriefing } = await import('../../src/render2d/ui/briefing.ts');
    const { islandSubtitle } = await import('../../src/i18n/data.ts');
    const belt = fakeBelt();
    const st = island();
    showBriefing(st, LEVELS_2D[2], null, { challenges: [], endless: false }, () => undefined, fakeHero(), belt);
    const card = q('brief2d')!;
    // No visible flavour sentence: it is the medallion's tooltip.
    expect(card.textContent).not.toContain(islandSubtitle(st.level));
    expect(card.querySelector<HTMLElement>('.pu-brief-medal')!.title).toBe(islandSubtitle(st.level));
    // Lock note: short text, the long one as tooltip.
    const hint = q('brief2d-modes-hint')!;
    expect(hint.textContent).toBe('Win it to open challenges & Endless');
    expect(hint.title).toContain('Win this isle once');
    // Hero and belt on one loadout row inside the island's column.
    const loadout = q('brief2d-loadout')!;
    expect(loadout.closest('.pu-brief-info')).not.toBeNull();
    expect([...loadout.children].map((c) => (c as HTMLElement).dataset.testid)).toEqual(['brief2d-hero', 'brief2d-belt']);
    // Difficulty: no heading, no rule line on Normal.
    expect(card.querySelector('.pu-diff-head')).toBeNull();
    expect(q('brief2d-diff-desc')!.hidden).toBe(true);
    expect(q('brief2d-diff-normal')!.title).toContain('as it was built');
    // Play is the loud one.
    expect(q('brief2d-play')!.classList.contains('pu-brief-play')).toBe(true);
    expect(belt.update).toHaveBeenLastCalledWith('normal', false);
  });

  it('Hard shows its rule line; Normal hides it again', async () => {
    const { showBriefing } = await import('../../src/render2d/ui/briefing.ts');
    const belt = fakeBelt();
    showBriefing(island(), null, null, { challenges: [], endless: false }, () => undefined, fakeHero(), belt);
    q('brief2d-diff-hard')!.click();
    const desc = q('brief2d-diff-desc')!;
    expect(desc.hidden).toBe(false);
    expect(desc.textContent).not.toBe('');
    expect(belt.update).toHaveBeenLastCalledWith('hard', false);
    q('brief2d-diff-normal')!.click();
    expect(desc.hidden).toBe(true);
  });

  it('won isle: records instead of the lock note; Endless turns the belt off and says Normal only', async () => {
    const { showBriefing } = await import('../../src/render2d/ui/briefing.ts');
    const belt = fakeBelt();
    const onPlay = vi.fn();
    showBriefing(island({ clears: 2, bestLives: 14 }), null, null, { challenges: [], endless: true, difficulty: 'hard' }, onPlay, fakeHero(), belt);
    expect(q('brief2d-modes-hint')).toBeNull();
    expect(q('brief2d-loadout')).not.toBeNull();
    q('brief2d-endless')!.click();
    expect(belt.update).toHaveBeenLastCalledWith('normal', true);
    expect(q('brief2d-diff-desc')!.hidden).toBe(false);
    q('brief2d-play')!.click();
    expect(onPlay).toHaveBeenCalledWith({ challenges: [], endless: true, difficulty: 'normal' });
  });

  it('locked isle: no loadout, Play disabled', async () => {
    const { showBriefing } = await import('../../src/render2d/ui/briefing.ts');
    showBriefing(island({ unlocked: false }), LEVELS_2D[2], null, { challenges: [], endless: false }, () => undefined, fakeHero(), undefined);
    expect(q('brief2d-loadout')).toBeNull();
    expect((q('brief2d-play') as HTMLButtonElement).disabled).toBe(true);
  });
});
