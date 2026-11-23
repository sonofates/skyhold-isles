import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i17.json';

const layout2d = parseLevel2D(json);

// The west road curls around the fallen belfry. The east road takes a shorter loop
// beneath the cloister. Both descend the same last switchback to the blue-roofed keep.
export const I17 = {
  id: 'i17',
  index: 16,
  name: 'Cloudbell Cloister',
  subtitle: 'Two roads meet below the broken belfry. The hares have stolen its clappers.',
  difficulty: 'Heroic',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 887,
  startingGold: 320,
  enemyHpScale: 2.0128,
  waveHpGrowth: 0.095,
  waves: [
    { name: 'The Stolen Clappers', clearBonus: 24, groups: [
      group('bellrunner', 4, 1.35), group('grunt', 7, 0.65, 2.4, 1),
    ] },
    { name: 'East Arcade', clearBonus: 25, groups: [
      group('brute', 3, 1.5, 0, 1), group('bellrunner', 7, 0.58, 2.1),
    ] },
    { name: 'Above the Clouds', clearBonus: 28, groups: [
      group('draftwing', 3, 0.72), group('draftwing', 4, 0.58, 5.4),
      group('grunt', 12, 0.55, 0.8, 1),
    ] },
    { name: 'Copper Procession', clearBonus: 30, groups: [
      group('warden', 2, 2.5, 0, 1), group('brute', 6, 1.05, 0.8, 1),
      group('bellrunner', 8, 0.45, 3),
    ] },
    { name: 'Loose Chimes', clearBonus: 32, groups: [
      group('splitter', 7, 0.8), group('draftwing', 8, 0.55, 1.4),
      group('runner', 9, 0.44, 4, 1),
    ] },
    { name: 'At the Bend', clearBonus: 35, groups: [
      group('golem', 5, 1.8, 0, 1), group('healer', 2, 1.3, 1.2, 1),
      group('bellrunner', 11, 0.42, 3.6),
    ] },
    { name: 'A Break in the Clouds', clearBonus: 38, groups: [
      group('carrier', 2, 3.4), group('draftwing', 12, 0.5, 1),
      group('brute', 6, 0.85, 1.8, 1), group('mite', 15, 0.2, 5.6),
    ] },
    { name: 'The Bell Rope', clearBonus: 40, groups: [
      group('blinker', 6, 0.8), group('hexer', 3, 1.5, 0.5, 1),
      { ...group('bellrunner', 12, 0.38, 2.3, 1), elite: true }, group('warden', 3, 1.2, 5.3),
    ] },
    { name: 'Two Choirs', clearBonus: 44, groups: [
      { ...group('brute', 6, 0.7), elite: true }, group('brute', 5, 0.7, 0.4, 1),
      group('draftwing', 12, 0.42, 2.4), group('healer', 3, 1.3, 3.3, 1),
    ] },
    { name: 'The Cloister Rings', clearBonus: 60, groups: [
      group('boss', 1, 1, 0, 1), group('warden', 3, 1.7, 1.2, 1),
      group('bellrunner', 15, 0.45, 1.6), group('draftwing', 5, 0.5, 6.2),
      group('golem', 4, 1.3, 8),
      { ...group('golem', 8, 0.85, 4, 1), elite: true, hpScale: 0.8 },
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 14, 'tesla'), build(0, 6, 'barracks'), build(0, 13, 'archer'),
    build(1, 18, 'frost'), build(1, 15, 'cannon'), upgrade(2, 14),
    build(2, 7, 'archer'), build(3, 12, 'ballista', 'strongest'), upgrade(3, 15),
    build(4, 5, 'mortar'), upgrade(4, 13), build(5, 20, 'tesla'),
    upgrade(5, 14), upgrade(6, 12), build(6, 16, 'ballista'),
    upgrade(7, 6), upgrade(7, 18), upgrade(8, 15), upgrade(8, 20),
    upgrade(9, 16), upgrade(9, 12), upgrade(9, 5), upgrade(9, 13),
  ],
  weakBuildOrder: [
    build(0, 14, 'archer'), build(0, 9, 'archer'), build(0, 6, 'cannon'),
    build(1, 10, 'cannon'), build(2, 4, 'frost'), build(3, 19, 'archer'),
    build(4, 17, 'ballista'), upgrade(4, 14), upgrade(5, 9), upgrade(6, 6),
    upgrade(7, 10), upgrade(8, 19),
  ],
} satisfies ChapterIsland;
