import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { HERO_DEFS, HERO_IDS } from '../../src/data/heroes.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/index.ts';
import { NEUTRAL_RUN_MODIFIERS } from '../../src/data/runModifiers.ts';
import { heroName, heroNodeName, heroRole, heroSkillName } from '../../src/i18n/data.ts';
import { HERO_ROLE_EN, HEROES_TR } from '../../src/i18n/heroesTr.ts';
import { setLocale } from '../../src/i18n/index.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { clampToReach, HERO_TAP_SLACK, heroAimShape, heroHitBox, inBox, overhaulPicks, resolveHeroTap, type HeroTapInput } from '../../src/render2d/heroInput.ts';
import { parseHeroArt, parseManifest } from '../../src/render2d/manifest.ts';
import { heroGroupLong, heroSkillState } from '../../src/render2d/ui/heroHud2d.ts';
import { HERO_KEYS } from '../../src/render2d/ui/heroKeys.ts';
import { ABILITY_KEYS } from '../../src/render2d/ui/abilities2d.ts';

afterEach(() => setLocale('en'));

const base: HeroTapInput = { hasHero: true, heroAlive: true, selected: false, onHero: false, onPlot: false, offRoad: 0.2, maxOffRoad: 1.2 };

describe('hero tap priority (heroInput.ts)', () => {
  it('no hero / hero down: taps pass through to plots', () => {
    expect(resolveHeroTap({ ...base, hasHero: false, onHero: true })).toBe('pass');
    expect(resolveHeroTap({ ...base, heroAlive: false, selected: true, onHero: true })).toBe('pass');
  });

  it('a tap on the hero selects it, a second one drops it', () => {
    expect(resolveHeroTap({ ...base, onHero: true })).toBe('select');
    expect(resolveHeroTap({ ...base, onHero: true, selected: true })).toBe('deselect');
    // The hero wins over a plot under it.
    expect(resolveHeroTap({ ...base, onHero: true, onPlot: true })).toBe('select');
  });

  it('not selected: everything else is a normal tap', () => {
    expect(resolveHeroTap({ ...base, onPlot: true })).toBe('pass');
    expect(resolveHeroTap({ ...base, offRoad: 0 })).toBe('pass');
  });

  it('selected: plots drop the hero and open, roads move it, far grass is invalid', () => {
    const sel = { ...base, selected: true };
    expect(resolveHeroTap({ ...sel, onPlot: true })).toBe('deselectPass');
    expect(resolveHeroTap({ ...sel, offRoad: 0.1 })).toBe('move');
    expect(resolveHeroTap({ ...sel, offRoad: 1.2 + HERO_TAP_SLACK })).toBe('move');
    expect(resolveHeroTap({ ...sel, offRoad: 1.2 + HERO_TAP_SLACK + 0.01 })).toBe('invalid');
  });

  it('hit box grows to a touch-sized target around the feet', () => {
    const b = heroHitBox({ x: 100, y: 50, w: 20, h: 30 }, 44);
    expect(b.w).toBe(44);
    expect(b.h).toBe(44);
    expect(b.x + b.w / 2).toBe(110);
    expect(b.y + b.h).toBe(80);
    expect(inBox(b, 110, 79)).toBe(true);
    expect(inBox(b, 140, 79)).toBe(false);
  });
});

describe('hero skill aiming helpers', () => {
  it('aim shape per skill kind', () => {
    expect(heroAimShape('shieldBash')).toBe('cone');
    expect(heroAimShape('wispBurst')).toBe('line');
    expect(heroAimShape('overhaul')).toBe('towers');
    expect(heroAimShape('volley')).toBe('circle');
  });

  it('clampToReach pulls the point back to the skill range like the sim', () => {
    expect(clampToReach(0, 0, 3, 4, 10)).toEqual({ x: 3, z: 4 });
    const c = clampToReach(0, 0, 3, 4, 2.5);
    expect(Math.hypot(c.x, c.z)).toBeCloseTo(2.5);
    expect(c.x / c.z).toBeCloseTo(0.75);
  });

  it('overhaulPicks: towers near the hero, nearest the aim first, beacons skipped', () => {
    const towers = [
      { id: 1, x: 1, z: 0, type: 'archer' },
      { id: 2, x: 3, z: 0, type: 'cannon' },
      { id: 3, x: 2, z: 0, type: 'beacon' },
      { id: 4, x: 9, z: 0, type: 'archer' },
    ];
    const r = overhaulPicks(towers, 3, 0, 0, 0, 5, 1);
    expect(r.candidates.map((t) => t.id)).toEqual([1, 2]);
    expect(r.picked.map((t) => t.id)).toEqual([2]);
  });

  it('a Tobb Overhaul cast from the sim hits the tower the preview picked', () => {
    const w = new SimWorld(LEVEL_L1C, new EventBus(), NEUTRAL_RUN_MODIFIERS, { heroId: 'tobb', heroLevel: 1, heroSkills: [] });
    const h = w.hero!;
    const plots = LEVEL_L1C.layout2d!.plots;
    const near = plots.map((p, i) => ({ i, d: Math.hypot(p.x - h.x, p.z - h.z) })).sort((a, b) => a.d - b.d).slice(0, 2);
    w.gold = 9999;
    for (const n of near) expect(w.placeTowerOnPlot(n.i, 'archer')).toBeTruthy();
    const act = h.stats.actives[1];
    const target = w.towers[1];
    const preview = overhaulPicks(w.towers, target.x, target.z, h.x, h.z, act.range, act.count);
    w.startNextWave();
    expect(w.castHeroSkill(1, target.x, target.z)).toBe(true);
    const boosted = w.towers.filter((t) => (t.overhaulTimer ?? 0) > 0).map((t) => t.id);
    expect(boosted).toEqual(preview.picked.map((t) => t.id));
  });
});

describe('hero HUD state + layout', () => {
  it('skill button state from the sim snapshot', () => {
    expect(heroSkillState({ alive: true }, { ready: true, usable: true }, true)).toBe('ready');
    expect(heroSkillState({ alive: true }, { ready: false, usable: false }, true)).toBe('cooldown');
    expect(heroSkillState({ alive: false }, { ready: true, usable: false }, true)).toBe('down');
    expect(heroSkillState({ alive: true }, { ready: true, usable: false }, false)).toBe('over');
  });

  it('hero group length grows with the button size', () => {
    expect(heroGroupLong(54, 10)).toBeGreaterThan(54 * 3.5);
    expect(heroGroupLong(76, 16)).toBeGreaterThan(heroGroupLong(54, 10));
  });

  it('hero keys do not clash with the game / ability keys', () => {
    const taken = new Set([' ', '1', '2', 'N', ABILITY_KEYS.meteor, ABILITY_KEYS.overcharge]);
    for (const k of Object.values(HERO_KEYS)) expect(taken.has(k), k).toBe(false);
    expect(new Set(Object.values(HERO_KEYS)).size).toBe(3);
  });
});

describe('hero art manifest section', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../public/art2d/manifest.json'), 'utf8')) as Record<string, unknown>;
  it('parseManifest keeps the heroes section; every hero has portrait, select, sheets and icons for its data kinds', () => {
    const m = parseManifest(raw);
    for (const id of HERO_IDS) {
      const h = m.heroes?.[id];
      expect(h, id).toBeDefined();
      expect(h!.portrait && h!.select && h!.idle && h!.attack && h!.death, id).toBeTruthy();
      expect(h!.walk?.side, id).toBeTruthy();
      const d = HERO_DEFS[id];
      for (const k of [d.passive.kind, d.actives[0].kind, d.actives[1].kind]) expect(h!.skills[k], `${id}.${k}`).toBeTruthy();
      expect(Object.keys(h!.branches).sort()).toEqual(['active1', 'active2', 'passive']);
    }
  });

  it('junk entries are skipped, never thrown', () => {
    expect(parseHeroArt(null)).toEqual({});
    expect(parseHeroArt({ bran: 3, wren: { portrait: 7 } }).wren?.portrait).toBeNull();
  });
});

describe('hero text (EN + TR)', () => {
  it('Turkish table covers every hero, skill, branch and node and has no stale ids', () => {
    for (const id of HERO_IDS) {
      const tr = HEROES_TR[id];
      const d = HERO_DEFS[id];
      expect(tr, id).toBeDefined();
      expect(HERO_ROLE_EN[id], id).toBeTruthy();
      for (const b of d.branches) expect(tr.branches[b.id]?.name, `${id}.${b.id}`).toBeTruthy();
      for (const n of d.skillTree) expect(tr.nodes[n.id]?.desc, `${id}.${n.id}`).toBeTruthy();
      expect(Object.keys(tr.nodes).filter((k) => !d.skillTree.some((n) => n.id === k))).toEqual([]);
      expect(Object.keys(tr.branches).filter((k) => !d.branches.some((b) => b.id === k))).toEqual([]);
    }
    expect(Object.keys(HEROES_TR).sort()).toEqual([...HERO_IDS].sort());
  });

  it('lookups return the data text in English and the table in Turkish', () => {
    expect(heroName('bran')).toBe(HERO_DEFS.bran.name);
    expect(heroSkillName('wren', 0)).toBe(HERO_DEFS.wren.actives[0].name);
    expect(heroRole('mira')).toBe(HERO_ROLE_EN.mira);
    setLocale('tr');
    expect(heroName('bran')).toBe(HEROES_TR.bran.name);
    expect(heroNodeName('sela', 'sela_cap')).toBe(HEROES_TR.sela.nodes.sela_cap.name);
    expect(heroNodeName('sela', 'nope')).toBe('nope');
  });
});
