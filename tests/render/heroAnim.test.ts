import { Container, type Sprite, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/index.ts';
import { parseLevel2D, type Level2DJson } from '../../src/data/levels2d/loader.ts';
import type { HeroArtRuntime, HeroSeqRuntime, LoadedArt } from '../../src/render2d/assets2d.ts';
import type { FxLayer } from '../../src/render2d/fxLayer.ts';
import {
  createHeroAnimState,
  createHeroPoseOut,
  onHeroCastAnim,
  stepHeroAnim,
  type HeroArtDesc,
} from '../../src/render2d/heroAnim.ts';
import { HeroLayer } from '../../src/render2d/heroLayer.ts';
import type { WorldLayers } from '../../src/render2d/layers.ts';
import type { MapView } from '../../src/render2d/mapView.ts';
import type { ProcTextures } from '../../src/render2d/procTextures.ts';
import { SimWorld } from '../../src/sim/world.ts';

const DT = BALANCE.fixedDt;

const CROSSROAD_JSON: Level2DJson = {
  id: 'render-hero-anim',
  image: 'road',
  imageSize: [1000, 1000],
  safeArea: [0, 0, 1000, 1000],
  entrances: [
    { id: 'A', x: 100, y: 500 },
    { id: 'B', x: 500, y: 100 },
  ],
  goal: [900, 500],
  paths: [
    [
      [100, 500],
      [900, 500],
    ],
    [
      [500, 100],
      [500, 900],
      [900, 500],
    ],
  ],
  plots: [[300, 620]],
  flightPath: [
    [100, 500],
    [900, 500],
  ],
};

function makeLevel(): LevelDef {
  return {
    ...LEVEL_L1C,
    id: CROSSROAD_JSON.id,
    startingGold: 1000,
    layout2d: parseLevel2D(CROSSROAD_JSON),
    waves: [
      {
        clearBonus: 10,
        groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 1, startDelay: 0, lane: 0 }],
      },
    ],
  };
}

function makeSeq(count: number, fps: number, impact: number | null = null): HeroSeqRuntime {
  return {
    frames: Array.from({ length: count }, () => Texture.WHITE),
    fps,
    anchor: [0.5, 0.9765625],
    impact,
  };
}

function createTestHeroScene(heroId: 'bran' | 'wren' = 'bran') {
  const events = new EventBus();
  const level = makeLevel();
  const world = new SimWorld(level, events, { heroId, heroLevel: 1 });
  const heroArt: HeroArtRuntime = {
    id: heroId,
    spec: {
      portrait: null,
      select: null,
      skills: {},
      branches: {},
      file: null,
      height: 1.5,
      idle: 'idle.json',
      walk: { down: 'walk-down.json', up: 'walk-up.json', side: 'walk-side.json' },
      attack: 'attack.json',
      death: 'death.json',
    },
    idle: makeSeq(4, 5),
    down: makeSeq(6, 9),
    up: makeSeq(6, 9),
    side: makeSeq(6, 9),
    attack: makeSeq(4, 7, 2),
    death: makeSeq(4, 6),
    figurePx: 100,
  };
  const actors = new Container();
  const layers = {
    groundFx: new Container(),
    shadows: new Container(),
    actors,
    fx: new Container(),
    bars: new Container(),
    projectiles: new Container(),
  } as unknown as WorldLayers;
  const map = {
    layout: level.layout2d!,
    pxX: (x: number) => 500 + x * 50,
    pxY: (z: number) => 500 + z * 50,
  } as unknown as MapView;
  const tex = {
    shadow: Texture.WHITE,
    wring: Texture.WHITE,
    orb: Texture.WHITE,
    ball: Texture.WHITE,
    arrow: Texture.WHITE,
  } as unknown as ProcTextures;
  const fx = {
    spawn() {},
    puffs() {},
    burst() {},
    random: () => 0.5,
  } as unknown as FxLayer;
  const art = {
    hero: heroArt,
    baseUrl: '/',
  } as unknown as LoadedArt;

  const layer = new HeroLayer(art, map, layers, tex, fx);
  layer.wire(events);
  const body = actors.children[0] as Sprite;

  return { events, world, layer, body };
}

function stepFrames(world: SimWorld, layer: HeroLayer, count: number, ticksPerFrame = 1): void {
  for (let i = 0; i < count; i++) {
    for (let s = 0; s < ticksPerFrame; s++) world.fixedTick(DT);
    layer.sync(world, 1, DT * ticksPerFrame, DT);
  }
}

describe('HeroLayer walk animation, attack cancellation & facing stability', () => {
  it('immediately cancels mid-swing attack pose and plays walk facing destination when ordered to move', () => {
    const { world, layer, body } = createTestHeroScene('bran');
    world.commandHeroMove(0, 0);
    while (world.hero!.state === 'moving') stepFrames(world, layer, 1);

    // Spawn an enemy right to Bran's right (+0.5, 0) and step until Bran swings ('heroAttack').
    const e = world.enemySystem.spawnEnemy('grunt', 1, false, 0)!;
    e.hp = 5000;
    e.dist = world.groundPath.nearestDist(0.5, 0);
    e.x = e.prevX = 0.5;
    e.z = e.prevZ = 0;
    world.spatialHash.clear();
    world.spatialHash.insert(e.poolIndex, e.x, e.z);

    for (let i = 0; i < 60 && !layer.stats.frame.startsWith('attack:'); i++) {
      stepFrames(world, layer, 1);
    }
    expect(layer.stats.frame.startsWith('attack:')).toBe(true);
    expect(body.scale.x).toBeGreaterThan(0);

    // Order Bran to walk west to (-4, 0) while mid-swing: must NOT slide in 'attack:' pose!
    expect(world.commandHeroMove(-4, 0)).toBe(true);
    stepFrames(world, layer, 1);
    expect(layer.stats.frame.startsWith('side:')).toBe(true);
    expect(body.scale.x).toBeLessThan(0);
  });

  it('plays walk animation (never slides in idle pose) while returning to guard post after combat', () => {
    const { world, layer } = createTestHeroScene('bran');
    world.commandHeroMove(0, 0);
    while (world.hero!.state === 'moving') stepFrames(world, layer, 1);

    // Spawn a weak enemy 1.7u west of post so Bran walks out to (-1.0, 0), kills it, and walks back in state === 'idle'.
    const e = world.enemySystem.spawnEnemy('grunt', 1, false, 0)!;
    e.hp = 1;
    e.speed = 0;
    e.dist = world.groundPath.nearestDist(-1.7, 0);
    e.x = e.prevX = -1.7;
    e.z = e.prevZ = 0;
    world.spatialHash.clear();
    world.spatialHash.insert(e.poolIndex, e.x, e.z);

    for (let i = 0; i < 90 && e.active; i++) {
      stepFrames(world, layer, 1);
    }
    expect(e.active).toBe(false);
    expect(Math.abs(world.hero!.x - world.hero!.postX)).toBeGreaterThan(0.5);

    // Every frame while Bran is walking back to (postX, postZ) in state === 'idle' must play walk, never 'idle:'!
    let returnWalkFrames = 0;
    for (let i = 0; i < 90 && Math.hypot(world.hero!.x - world.hero!.postX, world.hero!.z - world.hero!.postZ) > 1e-3; i++) {
      stepFrames(world, layer, 1);
      if (Math.hypot(world.hero!.x - world.hero!.prevX, world.hero!.z - world.hero!.prevZ) > 1e-4) {
        expect(world.hero!.state).toBe('idle');
        expect(layer.stats.frame.startsWith('side:')).toBe(true);
        returnWalkFrames++;
      }
    }
    expect(returnWalkFrames).toBeGreaterThan(8);

    // Once stationary at post, transitions cleanly back to idle.
    stepFrames(world, layer, 1);
    expect(layer.stats.frame.startsWith('idle:')).toBe(true);
  });

  it('starts walking on the first 120Hz sub-tick frame and reverses facing immediately with zero moonwalk or idle blip', () => {
    const { world, layer, body } = createTestHeroScene('wren');
    world.commandHeroMove(0, 0);
    while (world.hero!.state === 'moving') stepFrames(world, layer, 1);
    stepFrames(world, layer, 1);
    expect(layer.stats.frame.startsWith('idle:')).toBe(true);

    // 120Hz sub-tick right after commandHeroMove (before fixedTick runs): immediately shows walk right!
    expect(world.commandHeroMove(4, 0)).toBe(true);
    layer.sync(world, 0.5, DT * 0.5, DT * 0.5);
    expect(layer.stats.frame.startsWith('side:')).toBe(true);
    expect(body.scale.x).toBeGreaterThan(0);

    // Walk 12 ticks right (+x), then abruptly reverse left (-4, 0).
    stepFrames(world, layer, 12);
    expect(body.scale.x).toBeGreaterThan(0);

    expect(world.commandHeroMove(-4, 0)).toBe(true);
    for (let i = 0; i < 10; i++) {
      stepFrames(world, layer, 1);
      // Every single frame from frame 1 onward plays walk facing left (scale.x < 0) — no moonwalk, no idle blip!
      expect(layer.stats.frame.startsWith('side:')).toBe(true);
      expect(body.scale.x).toBeLessThan(0);
    }
  });

  it('keeps horizontal facing rock-steady on slightly bevelled vertical walks (1x & 3x) and mirrors up-sheet properly', () => {
    const { world, layer, body } = createTestHeroScene('wren');
    // Face right at (0.1, -3).
    world.commandHeroMove(-0.5, -3);
    while (world.hero!.state === 'moving') stepFrames(world, layer, 1);
    world.commandHeroMove(0.1, -3);
    while (world.hero!.state === 'moving') stepFrames(world, layer, 1);
    expect(body.scale.x).toBeGreaterThan(0);

    // Walk down along a slight leftward bevel (0.1, -3) -> (-0.1, +3) (|dx/dz| = 0.033 <= 0.2) at 3x speed:
    // must play 'down:' and NEVER flip facing left!
    expect(world.commandHeroMove(-0.1, 3)).toBe(true);
    while (world.hero!.state === 'moving') {
      stepFrames(world, layer, 1, 3);
      if (world.hero!.state === 'moving') {
        expect(layer.stats.frame.startsWith('down:')).toBe(true);
        expect(body.scale.x).toBeGreaterThan(0);
      }
    }

    // Now walk back up (-0.1, +3) -> (+0.05, -3) while facing remains +1 (right):
    // 'up' sheet faces left in art, so facing right requires flip = true (body.scale.x < 0),
    // and upon stopping in idle (art faces right), body.scale.x is > 0!
    expect(world.commandHeroMove(0.05, -3)).toBe(true);
    while (world.hero!.state === 'moving') {
      stepFrames(world, layer, 1, 1);
      if (world.hero!.state === 'moving') {
        expect(layer.stats.frame.startsWith('up:')).toBe(true);
        expect(body.scale.x).toBeLessThan(0);
      }
    }
    stepFrames(world, layer, 1);
    expect(layer.stats.frame.startsWith('idle:')).toBe(true);
    expect(body.scale.x).toBeGreaterThan(0);
  });

  it('preserves current facing on near-vertical attacks (|targetX - x| <= 0.08) instead of snapping right', () => {
    const { world, layer, body } = createTestHeroScene('wren');
    // Face left at (0, 0).
    world.commandHeroMove(1, 0);
    while (world.hero!.state === 'moving') stepFrames(world, layer, 1);
    world.commandHeroMove(-0.02, 0);
    while (world.hero!.state === 'moving') stepFrames(world, layer, 1);
    expect(body.scale.x).toBeLessThan(0);

    // Spawn an enemy nearly straight south at (0, +2.0) (dx = +0.02 within deadzone):
    // Wren's attack must NOT flip her facing from left to right!
    const lane1 = world.enemySystem.getPath(false, 1);
    const e = world.enemySystem.spawnEnemy('grunt', 1, false, 1)!;
    e.hp = 5000;
    e.speed = 0;
    e.dist = lane1.nearestDist(0, 2.0);
    e.x = e.prevX = 0;
    e.z = e.prevZ = 2.0;
    world.spatialHash.clear();
    world.spatialHash.insert(e.poolIndex, e.x, e.z);

    for (let i = 0; i < 60 && layer.stats.attacksPlayed === 0; i++) {
      stepFrames(world, layer, 1);
    }
    expect(layer.stats.attacksPlayed).toBeGreaterThan(0);
    expect(body.scale.x).toBeLessThan(0);
  });

  it('guards teleports, freezes walk frame cleanly while paused, and prevents cast-pose skating while moving', () => {
    const art: HeroArtDesc = {
      idle: { frames: { length: 4 }, fps: 5, impact: null },
      down: { frames: { length: 6 }, fps: 9, impact: null },
      up: { frames: { length: 6 }, fps: 9, impact: null },
      side: { frames: { length: 6 }, fps: 9, impact: null },
      attack: { frames: { length: 4 }, fps: 7, impact: 2 },
      death: { frames: { length: 4 }, fps: 6, impact: null },
    };
    const st = createHeroAnimState();
    const out = createHeroPoseOut();

    // 1. Large single-tick jump (> 1.5u, e.g. replay seek) renders idle rather than fake walk.
    stepHeroAnim(
      st,
      art,
      {
        heroState: 'idle',
        x: 5,
        z: 0,
        prevX: 0,
        prevZ: 0,
        yaw: Math.PI / 2,
        moveSpeed: 3,
        attackTimer: 0,
        expectsAttack: false,
        targetX: null,
        nextWaypointX: null,
        nextWaypointZ: null,
        simDt: DT,
        dt: DT,
      },
      out,
    );
    expect(out.kind).toBe('idle');

    // 2. Casting a skill while actively moving keeps walk animation (no frozen-cast skating).
    onHeroCastAnim(st, 0, 2, art.attack);
    expect(st.attackT).toBe(0);
    stepHeroAnim(
      st,
      art,
      {
        heroState: 'moving',
        x: 0.05,
        z: 0,
        prevX: 0,
        prevZ: 0,
        yaw: Math.PI / 2,
        moveSpeed: 3,
        attackTimer: 0,
        expectsAttack: false,
        targetX: null,
        nextWaypointX: 3,
        nextWaypointZ: 0,
        simDt: DT * 4,
        dt: DT,
      },
      out,
    );
    expect(out.kind).toBe('side');
    expect(st.attackT).toBe(-1);

    // 3. Pausing (`simDt === 0`) mid-walk holds the exact walk frame without snapping to idle.
    const heldFrame = out.frame;
    stepHeroAnim(
      st,
      art,
      {
        heroState: 'moving',
        x: 0.05,
        z: 0,
        prevX: 0,
        prevZ: 0,
        yaw: Math.PI / 2,
        moveSpeed: 3,
        attackTimer: 0,
        expectsAttack: false,
        targetX: null,
        nextWaypointX: 3,
        nextWaypointZ: 0,
        simDt: 0,
        dt: DT * 10,
      },
      out,
    );
    expect(out.kind).toBe('side');
    expect(out.frame).toBe(heldFrame);
  });
});
