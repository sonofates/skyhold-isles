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
import { coachStep, coachText, type CoachObs } from '../../src/render2d/ui/coach2d.ts';
import { livesLow } from '../../src/render2d/ui/lowLives2d.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { abilityBarSpot, besideAnchorSpot, gateKeepOutsPx } from '../../src/render2d/uiLayout.ts';

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
  const keys = Object.keys(EN).filter((k) => /^(pause|confirm|replay|wave|foe|coach)\./.test(k) || k === 'end.replay');
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

describe('ability bar placement (backlog 3)', () => {
  const base = { w: 1920, h: 1080, insets: { top: 0, right: 0, bottom: 0, left: 0 }, pad: 19, long: 700, short: 110, gap: 22, plaque: { x: 19, y: 950, w: 400, h: 110 }, banner: { x: 1590, y: 970, w: 300, h: 90 }, soft: [] };
  it('a crowded bottom band and edges: the two-row block finds the clear corner', () => {
    // Plots along the whole bottom band and the top edge; only the space above the banner is free.
    const hard = [
      { x: 430, y: 850, w: 1150, h: 230 },
      { x: 0, y: 0, w: 1920, h: 200 },
      { x: 0, y: 200, w: 300, h: 740 },
      { x: 1700, y: 200, w: 220, h: 450 },
    ];
    const s = abilityBarSpot({ ...base, hard, block: { w: 260, h: 180 } });
    expect(s.layout).toBe('block');
    expect(s.score).toBe(0);
  });
  it('the castle weighs as a landmark: the bar slides off it when it can', () => {
    const castle = { rect: { x: 800, y: 900, w: 300, h: 180 }, weight: 400 };
    const s = abilityBarSpot({ ...base, hard: [], landmarks: [castle] });
    const box = { x: s.x, y: s.y, w: s.layout === 'column' ? base.short : base.long, h: s.layout === 'column' ? base.long : base.short };
    const overlap = box.x < 1100 && box.x + box.w > 800 && box.y < 1080 && box.y + box.h > 900;
    expect(overlap).toBe(false);
  });
  it('gate keep-outs grow behind the castle gate (facing W → to the east) and above it', () => {
    const [k] = gateKeepOutsPx([{ role: 'goal', lane: -1, prop: 'castle-w', facing: 'W', front: { art: 'x', rect: [100, 100, 100, 80], baseY: 180 } }]);
    expect(k.castle).toBe(true);
    expect(k.x).toBeLessThan(100);
    expect(k.x + k.w).toBeGreaterThan(200 + 30);
    expect(k.y).toBeLessThan(100 - 40);
  });
});

describe('first-play coach (l1c)', () => {
  const o0: CoachObs = { towers: 0, maxTier: 0, waves: 0, buildRingOpen: false, gold: 200, cheapestUpgrade: Infinity, hasHero: true, heroMoves: 0, meteorReady: false, meteors: 0 };
  it('walks build → pick → wave → upgrade → hero → meteor → done from what the player does', () => {
    let s = coachStep('build', o0);
    expect(s).toBe('build');
    s = coachStep(s, { ...o0, buildRingOpen: true });
    expect(s).toBe('pick');
    s = coachStep(s, { ...o0, towers: 1 });
    expect(s).toBe('wave');
    s = coachStep(s, { ...o0, towers: 1, waves: 1 });
    expect(s).toBe('upgrade');
    s = coachStep(s, { ...o0, towers: 1, waves: 1, maxTier: 2 });
    expect(s).toBe('hero');
    s = coachStep(s, { ...o0, towers: 1, waves: 1, maxTier: 2, heroMoves: 1 });
    expect(s).toBe('meteor');
    s = coachStep(s, { ...o0, towers: 1, waves: 2, maxTier: 2, heroMoves: 1, meteors: 1 });
    expect(s).toBe('done');
  });
  it('a veteran skips ahead; selling the only tower before wave 1 goes back to build; no hero skips its tip', () => {
    expect(coachStep('build', { ...o0, towers: 2, waves: 1, maxTier: 2, heroMoves: 3, meteors: 1 })).toBe('done');
    expect(coachStep('wave', o0)).toBe('build');
    expect(coachStep('upgrade', { ...o0, towers: 1, waves: 1, maxTier: 2, hasHero: false })).toBe('meteor');
  });
  it('upgrade tip waits for gold; meteor tip only when it is ready; mouse wording on desktop', () => {
    expect(coachText('upgrade', { ...o0, gold: 50, cheapestUpgrade: 90 }, true)?.text).toBe('coach.gold');
    expect(coachText('upgrade', { ...o0, gold: 90, cheapestUpgrade: 90 }, true)?.text).toBe('coach.upgrade');
    expect(coachText('meteor', o0, true)).toBeNull();
    expect(coachText('build', o0, false)?.text).toBe('coach.buildMouse');
  });
});
