import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/index.ts';
import { EN } from '../../src/i18n/en.ts';
import { setLocale, t } from '../../src/i18n/index.ts';
import { TR } from '../../src/i18n/tr.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { nextSpeed, REPLAY_SPEEDS } from '../../src/render2d/game2d.ts';
import { waveChips } from '../../src/render2d/ui/wavePreview2d.ts';
import { foeFacts } from '../../src/render2d/ui/enemyCard2d.ts';
import { livesLow } from '../../src/render2d/ui/lowLives2d.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { besideAnchorSpot } from '../../src/render2d/uiLayout.ts';

afterEach(() => setLocale('en'));

describe('speed cycles', () => {
  it('live 1→2→3→1, replay 1→2→4→1, unknown restarts', () => {
    expect([1, 2, 3].map((s) => nextSpeed([1, 2, 3], s))).toEqual([2, 3, 1]);
    expect(REPLAY_SPEEDS.map((s) => nextSpeed(REPLAY_SPEEDS, s))).toEqual([2, 4, 1]);
    expect(nextSpeed(REPLAY_SPEEDS, 3)).toBe(1);
  });
});

describe('next-wave card', () => {
  it('chips come from the sim preview: counts, elites, bosses first', () => {
    const chips = waveChips({
      waveOneBased: 5,
      items: [
        { enemyType: 'grunt', count: 10 },
        { enemyType: 'flyer', count: 4, eliteCount: 1 },
        { enemyType: 'boss', count: 1 },
      ],
    });
    expect(chips.map((c) => c.type)).toEqual(['boss', 'grunt', 'flyer']);
    expect(chips.find((c) => c.type === 'flyer')).toMatchObject({ count: 4, elite: 1, flying: true, boss: false });
    expect(chips[0].boss).toBe(true);
    expect(waveChips(null)).toEqual([]);
  });

  it('every wave of l1c has a preview with at least one foe', () => {
    const w = new SimWorld(LEVEL_L1C, new EventBus());
    const p = w.waveSystem.getNextWavePreview();
    expect(p?.waveOneBased).toBe(1);
    expect(waveChips(p).length).toBeGreaterThan(0);
  });

  it('beside the horn: right when clear, else the least covered spot, always on screen', () => {
    const screen = { w: 1000, h: 600, bottomLimit: 560 };
    const horn = { x: 200, y: 300, r: 40 };
    const card = { w: 220, h: 90 };
    const clear = besideAnchorSpot(horn, card, screen, []);
    expect(clear.side).toBe('right');
    expect(clear.covered).toBe(0);
    // A plot right of the horn pushes the card to the other side.
    const blocked = besideAnchorSpot(horn, card, screen, [{ x: 240, y: 200, w: 300, h: 200 }]);
    expect(blocked.covered).toBe(0);
    expect(blocked.side).not.toBe('right');
    // Horn at the right edge: never off screen, never over the horn itself.
    const edge = besideAnchorSpot({ x: 980, y: 40, r: 40 }, card, screen, []);
    expect(edge.x).toBeGreaterThanOrEqual(8);
    expect(edge.x + card.w).toBeLessThanOrEqual(screen.w - 8);
    expect(edge.y).toBeGreaterThanOrEqual(8);
    const overHorn = edge.x < 1020 && edge.x + card.w > 940 && edge.y < 80 && edge.y + card.h > 0;
    expect(overHorn).toBe(false);
  });
});

describe('foe card + lives warning', () => {
  it('every foe type has a name, speed word and stats in both languages', () => {
    for (const lang of ['en', 'tr'] as const) {
      setLocale(lang);
      for (const type of ENEMY_TYPES) {
        const d = ENEMY_DEFS[type];
        const f = foeFacts({ type, flying: d.flying, elite: false, armor: d.armor, speed: d.speed });
        expect(f.name, type).toBeTruthy();
        expect(f.speed, type).not.toMatch(/^codex\./);
        expect(f.lives).toBe(d.livesCost);
        expect(f.bounty).toBe(d.reward);
      }
    }
  });
  it('tags: boss, flyer, empowered', () => {
    const f = foeFacts({ type: 'flyer', flying: true, elite: true, armor: 0, speed: 3 });
    expect(f.tags).toEqual(['Flyer', 'Empowered']);
    expect(foeFacts({ type: 'boss', flying: false, elite: false, armor: 5, speed: 1 }).tags).toContain('Boss');
  });
  it('lives are low at a quarter of the start or 3, never at 0', () => {
    expect(livesLow(5, 20)).toBe(true);
    expect(livesLow(6, 20)).toBe(false);
    expect(livesLow(3, 5)).toBe(true);
    expect(livesLow(0, 20)).toBe(false);
  });
});

describe('flow texts', () => {
  const keys = Object.keys(EN).filter((k) => /^(pause|confirm|replay|wave|foe)\./.test(k) || k === 'end.replay');
  it('every pause / confirm / replay / wave string exists in EN and TR, and differs', () => {
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      expect(TR[k as keyof typeof TR], k).toBeTruthy();
      if (!['wave.chip'].includes(k)) expect(TR[k as keyof typeof TR], k).not.toBe(EN[k as keyof typeof EN]);
    }
  });
  it('placeholders format in both languages', () => {
    setLocale('tr');
    expect(t('wave.next', { n: 3 })).toBe('Sıradaki: 3. dalga');
    expect(t('wave.inSecs', { n: 7 })).toContain('7');
    setLocale('en');
    expect(t('wave.earlyBonus', { n: 15 })).toBe('Call early: +15');
  });
});
