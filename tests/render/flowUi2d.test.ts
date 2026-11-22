import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { LEVEL_L1C, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { EN } from '../../src/i18n/en.ts';
import { setLocale, t } from '../../src/i18n/index.ts';
import { TR } from '../../src/i18n/tr.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { nextSpeed, REPLAY_SPEEDS } from '../../src/render2d/game2d.ts';
import { waveCardSlot, waveCardTier, waveChips } from '../../src/render2d/ui/wavePreview2d.ts';
import { foeFacts } from '../../src/render2d/ui/enemyCard2d.ts';
import { hudTipText } from '../../src/render2d/ui/hudTips2d.ts';
import { seenFromCleared, waveTypes } from '../../src/render2d/ui/newFoes2d.ts';
import { coachCardSpot, coachStep, coachText, type CoachObs } from '../../src/render2d/ui/coach2d.ts';
import { waveCallout } from '../../src/render2d/ui/waveBanner2d.ts';
import {
  kitUnit,
  LANE_MARK_MARGIN,
  laneMarkBox,
  laneMarkPlaceKey,
  laneMarkSpot,
  pathLength,
  pointAlong,
  primaryWaveEntrance,
  shouldShowEntranceMarks,
  waveEntranceCounts,
  waveLaneCounts,
  type LaneMarkPlaceInputs,
} from '../../src/render2d/ui/laneMarks2d.ts';
import { addHudKeepOut, hudKeepOutsVersion, invalidateSafeInsets, readSafeInsets } from '../../src/render2d/uiKit.ts';
import { fullBleedFitItems, hardShapes } from '../../src/render2d/fullBleed.ts';
import { hudDock } from '../../src/render2d/hudDock.ts';
import { buildEndlessWaveDef } from '../../src/sim/waveSystem.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { livesLow } from '../../src/render2d/ui/lowLives2d.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { gateKeepOutsPx, NO_INSETS, plateCentreY } from '../../src/render2d/uiLayout.ts';

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

  it('insets roomy desktop slots cleanly without ever leaving the dock slot, and leaves short slots untouched', () => {
    const desk = { x: 14, y: 7, w: 289, h: 128 };
    const inset = waveCardSlot(desk);
    expect(inset.x).toBe(desk.x);
    expect(inset.y).toBeGreaterThan(desk.y);
    expect(inset.y + inset.h).toBe(desk.y + desk.h);
    expect(inset.w).toBe(desk.w);

    const smallDesk = { x: 8, y: 6, w: 216, h: 100 };
    expect(waveCardSlot(smallDesk)).toEqual(smallDesk);

    const phone = { x: 8, y: 6, w: 177, h: 64 };
    expect(waveCardSlot(phone)).toEqual(phone);
  });

  it('picks responsive wave-card density tiers for roomy, small desktop (snug), multi-foe and narrow slots', () => {
    expect(waveCardTier(1, 289)).toEqual({ many: false, snug: false, compact: false, tiny: false });
    expect(waveCardTier(5, 289)).toEqual({ many: true, snug: false, compact: false, tiny: false });
    expect(waveCardTier(1, 216)).toEqual({ many: false, snug: true, compact: false, tiny: false });
    expect(waveCardTier(4, 216)).toEqual({ many: true, snug: true, compact: false, tiny: false });
    // Below 175 px switches to chip-only compact instead of collapsing into a narrow wrapped column.
    expect(waveCardTier(2, 160)).toEqual({ many: false, snug: false, compact: true, tiny: false });
    expect(waveCardTier(2, 120)).toEqual({ many: false, snug: false, compact: true, tiny: false });
    expect(waveCardTier(1, 50)).toEqual({ many: false, snug: false, compact: true, tiny: true });
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
  it('a mark slides along its road off the next-wave card with clearance and stays inside the viewport', () => {
    const path = [
      { x: 0, z: 0 },
      { x: 20, z: 0 },
    ];
    const toScreen = (p: { x: number; z: number }): { x: number; y: number } => ({ x: 100 + p.x * 40, y: 300 });
    expect(laneMarkSpot(path, toScreen, [], 10)?.x).toBe(164);
    // A card over the first two spots: the mark moves on to the third (3.6 units out).
    const at = laneMarkSpot(path, toScreen, [{ x: 140, y: 200, w: 70, h: 120 }], 10);
    expect(at?.x).toBe(244);
    // At small --s (8.5 px, 800x600), laneMarkBox accounts for the 12 px pill floor + outline,
    // and laneMarkSpot keeps LANE_MARK_MARGIN clear of a wide top-left wave card.
    const smallBox = laneMarkBox(200, 100, 8.5);
    expect(smallBox.w).toBeGreaterThanOrEqual(40);
    expect(smallBox.h).toBeGreaterThanOrEqual(48);
    const wideCard = { x: 8, y: 6, w: 216, h: 100 };
    const topRoad = (p: { x: number; z: number }): { x: number; y: number } => ({ x: -40 + p.x * 24, y: 95 });
    const cleared = laneMarkSpot(path, topRoad, [wideCard], 8.5, { w: 800, h: 600 });
    expect(cleared).not.toBeNull();
    const cb = laneMarkBox(cleared!.x, cleared!.y, 8.5);
    expect(cb.x).toBeGreaterThanOrEqual(wideCard.x + wideCard.w + LANE_MARK_MARGIN - 0.01);
    // Cave mouth off the left edge of the viewport: mark slides into view.
    const toOffLeft = (p: { x: number; z: number }): { x: number; y: number } => ({ x: -100 + p.x * 40, y: 300 });
    const inView = laneMarkSpot(path, toOffLeft, [], 10, { w: 800, h: 600 });
    expect(inView?.x).toBeGreaterThan(20);
    // Fractional screen coords inside the viewport must pick the very first clear spot (no fp drift skipping).
    const toFrac = (p: { x: number; z: number }): { x: number; y: number } => ({ x: 135.1302816901408 + p.x * 36.97183, y: 390.1234567 });
    const firstFrac = laneMarkSpot(path, toFrac, [], 8.55, { w: 900, h: 600 });
    expect(firstFrac?.x).toBeCloseTo(toFrac({ x: 1.6, z: 0 }).x, 4);
  });

  it('per-entrance counts include only active entrances and split flyers when flightPath has its own entry', () => {
    const isFlying = (ty: string): boolean => Boolean(ENEMY_DEFS[ty as EnemyType]?.flying);
    // i16 has 3 ground caves and a separate flight entry on the eastern rim.
    const i16 = LEVELS_2D.find((l) => l.id === 'i16' || l.id === 'emberglass-sanctum')!;
    const lay16 = i16.layout2d!;
    // Wave 1: 10 grunts lane 0, 10 grunts lane 1 (lane 2 and flight entry unused -> omitted).
    const w1 = waveEntranceCounts(i16.waves[0].groups, lay16.paths, lay16.flightPath, isFlying);
    expect(w1.map((e) => ({ lane: e.lane, flying: e.flying, count: e.count }))).toEqual([
      { lane: 0, flying: false, count: 10 },
      { lane: 1, flying: false, count: 10 },
    ]);
    // Wave 4 (Cinder Fall): 6 splitters lane 0, 7 flyers (own flight entry), 10 grunts lane 1.
    const w4 = waveEntranceCounts(i16.waves[3].groups, lay16.paths, lay16.flightPath, isFlying);
    expect(w4.map((e) => ({ lane: e.lane, flying: e.flying, count: e.count }))).toEqual([
      { lane: 0, flying: false, count: 6 },
      { lane: 1, flying: false, count: 10 },
      { lane: -1, flying: true, count: 7 },
    ]);
    // Endless wave on i16: flyers always count on the dedicated flight entry regardless of round-robin lane.
    const endlessDef = buildEndlessWaveDef(i16.waves.length + 2, i16);
    const endlessEntries = waveEntranceCounts(endlessDef.groups, lay16.paths, lay16.flightPath, isFlying);
    const totalGroups = endlessDef.groups.reduce((s, g) => s + g.count, 0);
    const totalEntries = endlessEntries.reduce((s, e) => s + e.count, 0);
    const totalFlyers = endlessDef.groups.filter((g) => isFlying(g.enemyType)).reduce((s, g) => s + g.count, 0);
    expect(totalEntries).toBe(totalGroups);
    expect(endlessEntries.find((e) => e.flying)?.count).toBe(totalFlyers);
    // i10: flightPath[0] coincides with lane 1 -> flyers merge into lane 1 (no duplicate air entry).
    const i10 = LEVELS_2D.find((l) => l.id === 'i10' || l.index === 9)!;
    const lay10 = i10.layout2d!;
    const m10 = waveEntranceCounts(
      [
        { enemyType: 'grunt', count: 5, lane: 0 },
        { enemyType: 'flyer', count: 6, lane: 0 },
      ],
      lay10.paths,
      lay10.flightPath,
      isFlying,
    );
    expect(m10.map((e) => ({ lane: e.lane, flying: e.flying, count: e.count }))).toEqual([
      { lane: 0, flying: false, count: 5 },
      { lane: 1, flying: false, count: 6 },
    ]);
    // Single-cave island (i01): flightPath shares lane 0 -> flyers merge into lane 0.
    const i01 = LEVELS_2D.find((l) => l.id === 'i01' || l.index === 0)!;
    const lay01 = i01.layout2d!;
    const m01 = waveEntranceCounts(
      [
        { enemyType: 'grunt', count: 4 },
        { enemyType: 'flyer', count: 3 },
      ],
      lay01.paths,
      lay01.flightPath,
      isFlying,
    );
    expect(m01.map((e) => ({ lane: e.lane, flying: e.flying, count: e.count }))).toEqual([{ lane: 0, flying: false, count: 7 }]);
    // Flyer-only wave on a dedicated flight entry returns only the air marker.
    const airOnly = waveEntranceCounts([{ enemyType: 'flyer', count: 9 }], lay16.paths, lay16.flightPath, isFlying);
    expect(airOnly.map((e) => ({ lane: e.lane, flying: e.flying, count: e.count }))).toEqual([{ lane: -1, flying: true, count: 9 }]);
  });

  it('entrance marker gate shows before every callable wave and hides on wave start or overlays', () => {
    expect(shouldShowEntranceMarks({ waveState: 'preFirstWave', canStartNextWave: true, ongoing: true, overlayOpen: false })).toBe(true);
    expect(shouldShowEntranceMarks({ waveState: 'betweenWaves', canStartNextWave: true, ongoing: true, overlayOpen: false })).toBe(true);
    expect(shouldShowEntranceMarks({ waveState: 'clearing', canStartNextWave: true, ongoing: true, overlayOpen: false })).toBe(true);
    // Endless mode after wave N finishes spawning -> callable -> shown.
    expect(shouldShowEntranceMarks({ waveState: 'allSpawned', canStartNextWave: true, ongoing: true, overlayOpen: false })).toBe(true);
    // Story mode final wave after spawning -> not callable -> hidden.
    expect(shouldShowEntranceMarks({ waveState: 'allSpawned', canStartNextWave: false, ongoing: true, overlayOpen: false })).toBe(false);
    // Wave started (normal or early call) -> spawning -> hidden.
    expect(shouldShowEntranceMarks({ waveState: 'spawning', canStartNextWave: false, ongoing: true, overlayOpen: false })).toBe(false);
    // Overlay / run ended -> hidden.
    expect(shouldShowEntranceMarks({ waveState: 'betweenWaves', canStartNextWave: true, ongoing: true, overlayOpen: true })).toBe(false);
    expect(shouldShowEntranceMarks({ waveState: 'betweenWaves', canStartNextWave: true, ongoing: false, overlayOpen: false })).toBe(false);
  });

  it('laneMarkSpot finds visible road past 18 world units on panned i04 and never vanishes on any legal pan', () => {
    const i04 = LEVELS_2D.find((l) => l.id === 'i04')!;
    const lay04 = i04.layout2d!;
    const fit04 = fullBleedFitItems(
      800,
      600,
      lay04,
      (itemMode) =>
        hudDock(800, 600, NO_INSETS, {
          plaqueAspect: 3.5,
          plaqueSlots: { lives: [0.268, 0.455], gold: [0.688, 0.898], midY: 0.514 },
          bannerAspect: 3.4,
          hero: true,
          items: 3,
          itemMode,
        }),
      hardShapes(lay04),
    );
    const toPan04 = (p: { x: number; z: number }): { x: number; y: number } => ({
      x: fit04.pan.minX + (p.x * lay04.pxPerUnit + lay04.imageSize[0] / 2) * fit04.fit.scale,
      y: fit04.pan.minY + (p.z * lay04.pxPerUnit + lay04.imageSize[1] / 2) * fit04.fit.scale,
    });
    const s04 = kitUnit(800, 600);
    const spot04 = laneMarkSpot(lay04.paths[0], toPan04, [], s04, { w: 800, h: 600 });
    expect(spot04).not.toBeNull();
    expect(spot04!.angle).toBeUndefined();
    const b04 = laneMarkBox(spot04!.x, spot04!.y, s04);
    expect(b04.x).toBeGreaterThanOrEqual(4);
    expect(b04.x + b04.w).toBeLessThanOrEqual(796);
    expect(b04.y).toBeGreaterThanOrEqual(4);
    expect(b04.y + b04.h).toBeLessThanOrEqual(596);
    expect(pathLength(lay04.paths[0])).toBeGreaterThan(22);

    // Completely off-screen path (i07 flight path panned fully right/down at 800x600):
    // clamps inside the viewport edge, dodges a top-left HUD card, and points left toward the off-screen entry.
    const i07 = LEVELS_2D.find((l) => l.id === 'i07')!;
    const lay07 = i07.layout2d!;
    const fit07 = fullBleedFitItems(
      800,
      600,
      lay07,
      (itemMode) =>
        hudDock(800, 600, NO_INSETS, {
          plaqueAspect: 3.5,
          plaqueSlots: { lives: [0.268, 0.455], gold: [0.688, 0.898], midY: 0.514 },
          bannerAspect: 3.4,
          hero: true,
          items: 3,
          itemMode,
        }),
      hardShapes(lay07),
    );
    const toPan07 = (p: { x: number; z: number }): { x: number; y: number } => ({
      x: fit07.pan.minX + (p.x * lay07.pxPerUnit + lay07.imageSize[0] / 2) * fit07.fit.scale,
      y: fit07.pan.minY + (p.z * lay07.pxPerUnit + lay07.imageSize[1] / 2) * fit07.fit.scale,
    });
    const topLeftCard = { x: 8, y: 8, w: 220, h: 100 };
    const clamped = laneMarkSpot(lay07.flightPath, toPan07, [topLeftCard], s04, { w: 800, h: 600 });
    expect(clamped).not.toBeNull();
    expect(clamped!.angle).toBeDefined();
    // Pointing left: chevron default direction is +π/2 (down), so direction vector is (cos(angle + π/2), sin(angle + π/2)).
    expect(Math.cos(clamped!.angle! + Math.PI / 2)).toBeLessThan(-0.5);
    const bc = laneMarkBox(clamped!.x, clamped!.y, s04);
    expect(bc.x).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(bc.x + bc.w).toBeLessThanOrEqual(796 + 1e-6);
    expect(bc.y).toBeGreaterThanOrEqual(topLeftCard.y + topLeftCard.h + LANE_MARK_MARGIN - 1e-6);

    // Every island & path stays inside the viewport under extreme legal pans at 800x600 and 390x844.
    for (const [w, h] of [
      [800, 600],
      [390, 844],
    ] as const) {
      const s = kitUnit(w, h);
      for (const lv of LEVELS_2D) {
        const lay = lv.layout2d!;
        const placed = fullBleedFitItems(
          w,
          h,
          lay,
          (itemMode) =>
            hudDock(w, h, NO_INSETS, {
              plaqueAspect: 3.5,
              plaqueSlots: { lives: [0.268, 0.455], gold: [0.688, 0.898], midY: 0.514 },
              bannerAspect: 3.4,
              hero: true,
              items: 3,
              itemMode,
            }),
          hardShapes(lay),
        );
        const corners = [
          [placed.pan.minX, placed.pan.minY],
          [placed.pan.maxX, placed.pan.maxY],
        ] as const;
        for (const path of [...lay.paths, ...(lay.flightPath.length > 0 ? [lay.flightPath] : [])]) {
          for (const [ox, oy] of corners) {
            const toScr = (p: { x: number; z: number }): { x: number; y: number } => ({
              x: ox + (p.x * lay.pxPerUnit + lay.imageSize[0] / 2) * placed.fit.scale,
              y: oy + (p.z * lay.pxPerUnit + lay.imageSize[1] / 2) * placed.fit.scale,
            });
            const spot = laneMarkSpot(path, toScr, [], s, { w, h });
            expect(spot, `${lv.id} ${w}x${h}`).not.toBeNull();
            const box = laneMarkBox(spot!.x, spot!.y, s);
            expect(box.x, `${lv.id} ${w}x${h} left`).toBeGreaterThanOrEqual(4 - 1e-6);
            expect(box.x + box.w, `${lv.id} ${w}x${h} right`).toBeLessThanOrEqual(w - 4 + 1e-6);
            expect(box.y, `${lv.id} ${w}x${h} top`).toBeGreaterThanOrEqual(4 - 1e-6);
            expect(box.y + box.h, `${lv.id} ${w}x${h} bottom`).toBeLessThanOrEqual(h - 4 + 1e-6);
          }
        }
      }
    }
  });

  it('primaryWaveEntrance agrees with waveEntranceCounts on i20 wave 10 and i16 dedicated air waves', () => {
    const isFlying = (ty: string): boolean => Boolean(ENEMY_DEFS[ty as EnemyType]?.flying);
    // i20 wave 10: all 19 enemies (9 ground + 10 flyers whose flightPath shares lane 1) enter via lane 1.
    const i20 = LEVELS_2D.find((l) => l.id === 'i20')!;
    const lay20 = i20.layout2d!;
    const w10 = waveEntranceCounts(i20.waves[9].groups, lay20.paths, lay20.flightPath, isFlying);
    const chosen20 = primaryWaveEntrance(w10);
    expect(chosen20).not.toBeNull();
    expect(chosen20!.lane).toBe(1);
    expect(chosen20!.flying).toBe(false);
    expect(chosen20!.count).toBe(19);
    expect(chosen20!.path).toBe(lay20.paths[1]);

    // i16 wave 7: 13 flyers on dedicated air entry outnumber 5 on lane 0 and 5 on lane 1.
    const i16 = LEVELS_2D.find((l) => l.id === 'i16')!;
    const lay16 = i16.layout2d!;
    const w7 = waveEntranceCounts(i16.waves[6].groups, lay16.paths, lay16.flightPath, isFlying);
    const chosen16 = primaryWaveEntrance(w7);
    expect(chosen16).not.toBeNull();
    expect(chosen16!.lane).toBe(-1);
    expect(chosen16!.flying).toBe(true);
    expect(chosen16!.count).toBe(13);
    expect(chosen16!.path).toBe(lay16.flightPath);

    // Ties prefer ground over dedicated air, and lowest lane index among ground lanes.
    const pA = [{ x: 0, z: 0 }, { x: 1, z: 0 }];
    const pB = [{ x: 2, z: 0 }, { x: 3, z: 0 }];
    const pAir = [{ x: 4, z: 0 }, { x: 5, z: 0 }];
    expect(
      primaryWaveEntrance([
        { lane: -1, flying: true, count: 10, path: pAir },
        { lane: 2, flying: false, count: 10, path: pB },
        { lane: 1, flying: false, count: 10, path: pA },
      ])?.lane,
    ).toBe(1);
    expect(primaryWaveEntrance([])).toBeNull();
  });

  it('laneMarkPlaceKey and uiKit safe-inset/keepOut measurement caching invalidate only on geometry changes', () => {
    const base: LaneMarkPlaceInputs = {
      waveKey: 'i20|0|9',
      viewW: 1366,
      viewH: 768,
      unit: 12.977,
      fitScale: 0.9465,
      fitOffsetX: -183,
      fitOffsetY: -19,
      card: { x: 8, y: 8, w: 220, h: 100 },
      foe: null,
      toast: null,
      hornBox: { x: 1100, y: 120, w: 90, h: 90 },
      plaque: { x: 8, y: 700, w: 240, h: 60 },
      banner: { x: 1100, y: 700, w: 240, h: 60 },
      tray: { x: 480, y: 700, w: 400, h: 60 },
      hasDiffBadge: true,
      coachKey: '',
      specHintShown: false,
      keepOutsVersion: 2,
      layoutGen: 0,
    };
    const k0 = laneMarkPlaceKey(base);
    expect(laneMarkPlaceKey({ ...base })).toBe(k0);
    expect(laneMarkPlaceKey({ ...base, waveKey: 'i20|0|10' })).not.toBe(k0);
    expect(laneMarkPlaceKey({ ...base, fitOffsetX: -200 })).not.toBe(k0);
    expect(laneMarkPlaceKey({ ...base, viewW: 800 })).not.toBe(k0);
    expect(laneMarkPlaceKey({ ...base, hornBox: { x: 1050, y: 120, w: 90, h: 90 } })).not.toBe(k0);
    expect(laneMarkPlaceKey({ ...base, card: null })).not.toBe(k0);
    expect(laneMarkPlaceKey({ ...base, coachKey: 'build' })).not.toBe(k0);
    expect(laneMarkPlaceKey({ ...base, specHintShown: true })).not.toBe(k0);
    expect(laneMarkPlaceKey({ ...base, keepOutsVersion: 3 })).not.toBe(k0);
    expect(laneMarkPlaceKey({ ...base, layoutGen: 1 })).not.toBe(k0);

    // hudKeepOutsVersion bumps on register and unregister.
    const v0 = hudKeepOutsVersion();
    const drop = addHudKeepOut(() => null);
    expect(hudKeepOutsVersion()).toBe(v0 + 1);
    drop();
    expect(hudKeepOutsVersion()).toBe(v0 + 2);
    drop(); // idempotent
    expect(hudKeepOutsVersion()).toBe(v0 + 2);

    // readSafeInsets caches getComputedStyle across calls until resize or invalidateSafeInsets().
    const g = globalThis as unknown as Record<string, unknown>;
    const origDoc = g.document;
    const origWin = g.window;
    const origGcs = g.getComputedStyle;
    const listeners = new Map<string, Set<() => void>>();
    let gcsCalls = 0;
    let padTop = '12px';
    const fakeEl = { style: { cssText: '' }, isConnected: false };
    g.document = {
      body: {
        appendChild: (el: typeof fakeEl) => {
          el.isConnected = true;
          return el;
        },
      },
      createElement: () => fakeEl,
    };
    g.window = {
      addEventListener: (ev: string, fn: () => void) => {
        if (!listeners.has(ev)) listeners.set(ev, new Set());
        listeners.get(ev)!.add(fn);
      },
    };
    g.getComputedStyle = () => {
      gcsCalls++;
      return { paddingTop: padTop, paddingRight: '0px', paddingBottom: '8px', paddingLeft: '0px' };
    };
    try {
      invalidateSafeInsets();
      expect(readSafeInsets()).toEqual({ top: 12, right: 0, bottom: 8, left: 0 });
      expect(readSafeInsets()).toEqual({ top: 12, right: 0, bottom: 8, left: 0 });
      expect(readSafeInsets()).toEqual({ top: 12, right: 0, bottom: 8, left: 0 });
      expect(gcsCalls).toBe(1);
      padTop = '24px';
      for (const fn of listeners.get('resize') ?? []) fn();
      expect(readSafeInsets()).toEqual({ top: 24, right: 0, bottom: 8, left: 0 });
      expect(gcsCalls).toBe(2);
    } finally {
      invalidateSafeInsets();
      if (origDoc === undefined) delete g.document;
      else g.document = origDoc;
      if (origWin === undefined) delete g.window;
      else g.window = origWin;
      if (origGcs === undefined) delete g.getComputedStyle;
      else g.getComputedStyle = origGcs;
    }
  });
});
