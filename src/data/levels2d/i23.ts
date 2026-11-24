import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i23.json';

const layout2d = parseLevel2D(json);

// The cellar road circles the hives. The cider press leads directly to the packing yard.
export const I23 = {
  id: 'i23',
  index: 22,
  name: 'Waxlight Orchard',
  subtitle: 'The beacon needs a flame. Keep the orchard roads clear for the last cart of beeswax.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1229,
  startingGold: 380,
  enemyHpScale: 2.54,
  waveHpGrowth: 0.1035,
  waves: [
    { name: 'First Pickings', clearBonus: 25, groups: [
      group('bellrunner', 5, 0.74),
      group('grunt', 11, 0.53, 1.7, 1),
    ] },
    { name: 'The Cellar Door', clearBonus: 27, groups: [
      group('kilnback', 5, 1.08),
      group('mite', 15, 0.25, 0.8, 1),
      group('runner', 7, 0.49, 4.2, 1),
    ] },
    { name: 'Among the Pears', clearBonus: 29, groups: [
      group('draftwing', 5, 0.52),
      group('reedpiper', 2, 1.43, 0.7, 1),
      group('brute', 5, 1.02, 1.5, 1),
    ] },
    { name: 'A Broken Skep', clearBonus: 30, groups: [
      group('splitter', 8, 0.74, 0, 1),
      group('healer', 2, 1.54, 0.4, 1),
      group('bellrunner', 9, 0.52, 3.6),
    ] },
    { name: 'Through the Hedge', clearBonus: 32, groups: [
      group('warden', 3, 1.38),
      group('burrower', 6, 0.91, 0.4, 1),
      group('hexer', 3, 1.47, 1.7),
      group('blinker', 5, 0.72, 4.4, 1),
    ] },
    { name: 'Windfalls', clearBonus: 34, groups: [
      { ...group('kilnback', 5, 1.21, 0, 1), elite: true },
      group('reedpiper', 3, 1.54, 0.9, 1),
      group('draftwing', 6, 0.49, 2.2),
      group('grunt', 12, 0.42, 4.3),
      { ...group('golem', 9, 0.95, 0.45, 1), elite: true },
    ] },
    { name: 'The Honey Press', clearBonus: 35, groups: [
      group('carrier', 2, 2.21),
      { ...group('bellrunner', 9, 0.57, 0.5), elite: true },
      group('golem', 4, 1.12, 1.2, 1),
      group('healer', 2, 1.4, 2.1, 1),
    ] },
    { name: 'Long Shadows', clearBonus: 37, groups: [
      { ...group('splitter', 7, 0.82), elite: true },
      group('hexer', 4, 1.16, 0.6, 1),
      group('mite', 23, 0.24, 2.7, 1),
      group('blinker', 7, 0.61, 4.9),
    ] },
    { name: 'The Wax Melts', clearBonus: 39, groups: [
      { ...group('brute', 7, 0.93, 0, 1), elite: true },
      group('reedpiper', 4, 1.27, 0.5, 1),
      group('burrower', 9, 0.71, 2.3),
      group('draftwing', 6, 0.52, 4.1),
    ] },
    { name: 'Dipping Wicks', clearBonus: 40, groups: [
      { ...group('golem', 5, 1.24), elite: true },
      group('healer', 3, 1.27, 0.4),
      { ...group('bellrunner', 11, 0.49, 2.3, 1), elite: true },
      group('carrier', 2, 2.27, 5.1),
    ] },
    { name: 'Swarming Time', clearBonus: 43, groups: [
      { ...group('draftwing', 7, 0.55), elite: true },
      { ...group('kilnback', 7, 1.05, 0.9, 1), elite: true },
      group('warden', 4, 1.32, 1.5, 1),
      group('runner', 13, 0.35, 5.7),
    ] },
    { name: 'Under the Boughs', clearBonus: 46, groups: [
      { ...group('burrower', 9, 0.72, 0, 1), elite: true },
      group('splitter', 10, 0.62, 1.1),
      group('reedpiper', 4, 1.16, 1.6),
      { ...group('blinker', 7, 0.63, 4.3, 1), elite: true },
    ] },
    { name: 'The Candle Cart', clearBonus: 62, groups: [
      { ...group('kilnback', 8, 0.96), elite: true },
      group('healer', 4, 1.17, 0.5),
      { ...group('golem', 6, 1.07, 0.8, 1), elite: true },
      { ...group('bellrunner', 11, 0.47, 3.7, 1), elite: true },
      { ...group('draftwing', 7, 0.45, 11), elite: true },
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 17, 'tesla'), build(0, 16, 'barracks'), build(0, 4, 'archer'),
    build(1, 15, 'cannon'), build(1, 7, 'frost'), upgrade(2, 17),
    build(2, 1, 'archer'), build(3, 8, 'ballista', 'strongest'), upgrade(3, 15),
    build(4, 5, 'mortar'), upgrade(4, 4), build(5, 18, 'tesla'),
    upgrade(5, 8), upgrade(6, 17), build(6, 19, 'ballista'),
    upgrade(7, 7), upgrade(7, 16), upgrade(8, 15), upgrade(8, 18),
    upgrade(9, 19), upgrade(9, 8), upgrade(10, 1), upgrade(10, 5), upgrade(10, 4),
    upgrade(11, 18), upgrade(11, 7), upgrade(12, 19), upgrade(12, 5), upgrade(12, 16),
  ],
  weakBuildOrder: [
    build(0, 17, 'tesla'), build(0, 15, 'cannon'), build(0, 18, 'barracks'),
    build(1, 11, 'frost'), build(2, 14, 'cannon'), build(3, 1, 'archer'),
    build(4, 20, 'ballista'), upgrade(4, 17), upgrade(5, 15), upgrade(6, 18),
    upgrade(7, 11), upgrade(8, 14),
  ],
} satisfies ChapterIsland;
