import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i27.json';

const layout2d = parseLevel2D(json);

// The long towpath doubles back along the ropewalk. The ferry landing joins its third strand.
export const I27 = {
  id: 'i27',
  index: 26,
  name: 'Wickweavers’ Strand',
  subtitle: 'The orchard wax is aboard. Hold the towpaths while the weavers braid a wick long enough for Lastlight.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1427,
  startingGold: 400,
  enemyHpScale: 1.62,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'First Twist', clearBonus: 25, groups: [
      group('bellrunner', 6, 0.7), group('grunt', 10, 0.55, 2, 1),
    ] },
    { name: 'Flax Dust', clearBonus: 27, groups: [
      group('kilnback', 5, 1.11, 0, 1), group('mite', 16, 0.28),
      group('bellrunner', 6, 0.66, 4),
    ] },
    { name: 'Three Ply', clearBonus: 29, groups: [
      group('reedpiper', 3, 1.34, 0, 1), group('brute', 6, 1, 0.5, 1),
      { ...group('draftwing', 5, 1.092, 3), hpScale: 0.78 },
    ] },
    { name: 'Along the Spindle', clearBonus: 31, groups: [
      group('splitter', 8, 0.77), group('bellrunner', 11, 0.5, 0, 1),
      group('healer', 2, 1.5, 1),
    ] },
    { name: 'The Slack Strand', clearBonus: 32, groups: [
      group('warden', 4, 1.25), group('burrower', 7, 0.89, 0, 1),
      group('hexer', 3, 1.46, 1),
    ] },
    { name: 'Copper Hooks', clearBonus: 34, groups: [
      { ...group('kilnback', 6, 1.04, 0, 1), elite: true }, group('reedpiper', 3, 1.35, 1, 1),
      { ...group('draftwing', 6, 1.05, 3), hpScale: 0.78 }, group('golem', 5, 1.18),
    ] },
    { name: 'Winding On', clearBonus: 36, groups: [
      group('carrier', 2, 2.7), { ...group('bellrunner', 10, 0.5, 1, 1), elite: true },
      group('splitter', 9, 0.72), group('healer', 3, 1.26, 4),
    ] },
    { name: 'Tarred Posts', clearBonus: 37, groups: [
      { ...group('golem', 6, 1.1), elite: true }, group('warden', 5, 1.21, 0, 1),
      group('blinker', 8, 0.69, 2, 1),
    ] },
    { name: 'Against the Twist', clearBonus: 39, groups: [
      group('reedpiper', 4, 1.3), { ...group('bellrunner', 12, 0.48, 1), elite: true },
      { ...group('burrower', 8, 0.74, 1, 1), elite: true }, { ...group('draftwing', 5, 0.98, 4), hpScale: 0.78 },
    ] },
    { name: 'The Splice', clearBonus: 41, groups: [
      group('kilnback', 8, 0.96), group('healer', 3, 1.26, 0.5),
      { ...group('splitter', 8, 0.72, 1, 1), elite: true }, group('mite', 22, 0.24, 4, 1),
    ] },
    { name: 'Ferry Wash', clearBonus: 43, groups: [
      { ...group('draftwing', 7, 0.91), elite: true, hpScale: 0.78 }, group('golem', 7, 1.05, 0, 1),
      group('hexer', 4, 1.23, 1, 1), group('bellrunner', 12, 0.46, 3),
    ] },
    { name: 'Pay Out the Coil', clearBonus: 46, groups: [
      { ...group('burrower', 9, 0.72), elite: true }, group('reedpiper', 4, 1.23, 0, 1),
      { ...group('kilnback', 7, 1.02, 1, 1), elite: true }, group('carrier', 2, 2.6, 5),
    ] },
    { name: 'Cast Off for Lastlight', clearBonus: 60, groups: [
      { ...group('golem', 8, 1.03, 0, 1), elite: true, hpScale: 2 }, group('reedpiper', 4, 1.2, 0.6, 1),
      { ...group('kilnback', 7, 0.96), elite: true }, { ...group('bellrunner', 12, 0.5, 3, 1), elite: true },
      { ...group('draftwing', 6, 0.966, 9), hpScale: 0.78 },
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 8, 'tesla'), build(0, 13, 'barracks'), build(0, 9, 'archer'),
    build(1, 17, 'frost'), build(1, 14, 'ballista'), upgrade(2, 8),
    build(2, 2, 'mortar'), upgrade(3, 9), build(3, 7, 'cannon'),
    upgrade(4, 14), build(4, 10, 'tesla'), upgrade(5, 13),
    build(5, 4, 'ballista'), upgrade(6, 7), build(6, 16, 'archer'),
    upgrade(7, 17), upgrade(7, 8), upgrade(7, 2),
    upgrade(7, 10), upgrade(8, 4), upgrade(8, 14),
    upgrade(8, 9), upgrade(9, 16), upgrade(9, 7),
    upgrade(9, 13), upgrade(10, 17), upgrade(10, 2),
    upgrade(10, 10), upgrade(11, 4), upgrade(11, 16),
  ],
  weakBuildOrder: [
    build(0, 0, 'archer'), build(0, 11, 'cannon'), build(0, 2, 'tesla'),
    build(1, 12, 'frost'), build(2, 6, 'archer'), build(3, 15, 'cannon'),
    build(4, 3, 'ballista'), upgrade(5, 0), upgrade(6, 11),
    upgrade(7, 2), upgrade(8, 12), upgrade(9, 6),
    upgrade(10, 15),
  ],
} satisfies ChapterIsland;
