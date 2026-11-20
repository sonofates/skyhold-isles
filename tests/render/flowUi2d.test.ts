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
import { hudTipText } from '../../src/render2d/ui/hudTips2d.ts';
import { seenFromCleared, waveTypes } from '../../src/render2d/ui/newFoes2d.ts';
import { coachCardSpot, coachStep, coachText, type CoachObs } from '../../src/render2d/ui/coach2d.ts';
import { waveCallout } from '../../src/render2d/ui/waveBanner2d.ts';
import { laneMarkSpot, pointAlong, waveLaneCounts } from '../../src/render2d/ui/laneMarks2d.ts';
import { livesLow } from '../../src/render2d/ui/lowLives2d.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { gateKeepOutsPx, plateCentreY } from '../../src/render2d/uiLayout.ts';

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
  const keys = Object.keys(EN).filter((k) => /^(pause|confirm|replay|wave|foe|coach|tip)\./.test(k) || k === 'end.replay');
  it('every pause / confirm / replay / wave string exists in EN and TR, and differs', () => {
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      expect(TR[k as keyof typeof TR], k).toBeTruthy();
      if (!['wave.chip', 'wave.laneCount'].includes(k)) expect(TR[k as keyof typeof TR], k).not.toBe(EN[k as keyof typeof EN]);
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

describe('gate keep-outs', () => {
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

describe('HUD hover tooltips', () => {
  const s = { paused: false, speed: 2, canCall: true, earlyBonus: 0, first: true };
  it('horn: first wave, bonus, waiting; pause / resume; speed', () => {
    expect(hudTipText('horn', s).desc).toBe('The raiders march as soon as the horn sounds.');
    expect(hudTipText('horn', { ...s, first: false, earlyBonus: 30 }).desc).toBe('Call it now for +30 bonus gold.');
    expect(hudTipText('horn', { ...s, canCall: false }).desc).toMatch(/between waves/);
    expect(hudTipText('pause', s).head).toBe('Pause');
    // Pad mode reads the controller button (X calls the wave, Start pauses).
    expect(hudTipText('horn', s).pad).toBe('X');
    expect(hudTipText('pause', s).pad).toBe('Start');
    expect(hudTipText('speed', s).pad).toBeUndefined();
    expect(hudTipText('pause', { ...s, paused: true }).head).toBe('Resume');
    expect(hudTipText('speed', s).head).toBe('Game speed 2×');
  });
  it('the plaque: lives and gold explain themselves, without a key chip', () => {
    expect(hudTipText('lives', s)).toMatchObject({ head: 'Lives', key: '' });
    expect(hudTipText('gold', s).desc).toMatch(/early wave/);
  });
});

describe('new-foe heads-up', () => {
  it('wave types come from the groups (no repeats); cleared islands seed the seen set', () => {
    const lvl = { waves: [{ groups: [{ enemyType: 'grunt' }, { enemyType: 'runner' }, { enemyType: 'grunt' }] }, { groups: [{ enemyType: 'brute' }] }] } as never;
    expect(waveTypes(lvl, 0)).toEqual(['grunt', 'runner']);
    expect(waveTypes(lvl, 5)).toEqual([]);
    expect([...seenFromCleared([lvl], () => true)].sort()).toEqual(['brute', 'grunt', 'runner']);
    expect(seenFromCleared([lvl], () => false).size).toBe(0);
  });
});

describe('coach card and wave call-out', () => {
  it('the coach card keeps its home spot when clear, else slides beside the bar it would cover', () => {
    const home = { x: 490, y: 12, w: 385, h: 96 };
    const screen = { w: 1366, h: 768 };
    expect(coachCardSpot(home, [{ x: 1030, y: 0, w: 336, h: 100 }], screen)).toEqual({ x: 490, y: 12 });
    const bar = { x: 405, y: 8, w: 357, h: 81 };
    const at = coachCardSpot(home, [bar, { x: 1030, y: 0, w: 336, h: 100 }], screen);
    const box = { x: at.x, y: at.y, w: home.w, h: home.h };
    const hits = box.x < bar.x + bar.w && box.x + box.w > bar.x && box.y < bar.y + bar.h && box.y + box.h > bar.y;
    expect(hits).toBe(false);
    expect(box.x).toBeGreaterThanOrEqual(10);
    expect(box.x + box.w).toBeLessThanOrEqual(1366 - 10);
  });
  it('call-out: a boss wave names the boss; the last story wave is "final"; ordinary and Endless waves get none', () => {
    setLocale('en');
    expect(waveCallout(['grunt'], 9, 10, false)).toEqual({ kind: 'final' });
    expect(waveCallout(['grunt'], 3, 10, false)).toBeNull();
    expect(waveCallout(['grunt'], 9, 10, true)).toBeNull();
    const boss = waveCallout(['grunt', 'boss'], 4, 10, false);
    expect(boss?.kind).toBe('boss');
    // The last wave stays "final" and names the boss leading it.
    const last = waveCallout(['grunt', 'boss'], 9, 10, false);
    expect(last?.kind).toBe('final');
    expect(last && last.kind === 'final' ? last.boss : '').toBeTruthy();
    expect(t('callout.finalBoss', { name: 'X' })).toBe('X leads the charge');
    expect(t('callout.boss')).toBe('Boss incoming!');
    setLocale('tr');
    expect(t('callout.final')).toBe('Son dalga!');
  });
});

describe('centre plate', () => {
  it('stays at 42 % unless it would cover the rally circle; then the band further from it', () => {
    const plate = { x: 760, w: 400, h: 120 };
    expect(plateCentreY(1080, plate, null)).toBeCloseTo(1080 * 0.42);
    expect(plateCentreY(1080, plate, { x: 100, y: 100, w: 200, h: 200 })).toBeCloseTo(1080 * 0.42);
    // A circle round the middle-top: the plate drops to the bottom band.
    expect(plateCentreY(1080, plate, { x: 670, y: 110, w: 400, h: 400 })).toBeCloseTo(1080 * 0.8);
    // A circle low on the screen: the top band.
    expect(plateCentreY(1080, plate, { x: 700, y: 380, w: 500, h: 600 })).toBeCloseTo(1080 * 0.17);
  });
});

describe('next-wave caves', () => {
  it('counts foes per lane (no lane = lane 0) and walks a point along a road', () => {
    const c = waveLaneCounts([{ count: 6, lane: 0 }, { count: 6, lane: 1 }, { count: 4 }]);
    expect([...c.entries()].sort()).toEqual([
      [0, 10],
      [1, 6],
    ]);
    const path = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 4 },
    ];
    expect(pointAlong(path, 1)).toEqual({ x: 1, z: 0 });
    expect(pointAlong(path, 3)).toEqual({ x: 2, z: 1 });
    expect(pointAlong(path, 99)).toEqual({ x: 2, z: 4 });
  });
  it('a mark slides along its road off the next-wave card', () => {
    const path = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ];
    const toScreen = (p: { x: number; z: number }): { x: number; y: number } => ({ x: 100 + p.x * 40, y: 300 });
    expect(laneMarkSpot(path, toScreen, [], 10)?.x).toBe(164);
    // A card over the first two spots: the mark moves on to the third (3.6 units out).
    const at = laneMarkSpot(path, toScreen, [{ x: 140, y: 200, w: 70, h: 120 }], 10);
    expect(at?.x).toBe(244);
  });
});
