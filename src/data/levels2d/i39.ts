import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i39.json';

const layout2d = parseLevel2D(json);

export const I39 = {
  id: 'i39',
  index: 38,
  name: 'Umbral Grove',
  subtitle: 'Two root cellars open on opposite sides of the grove. Keep the southern nursery lit until dawn.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1624,
  startingGold: 415,
  enemyHpScale: 2.325,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Leaf Litter', clearBonus: 25, groups: [
      group('warden', 4, 1.2), group('runner', 8, 0.55, 1.5, 1),
    ] },
    { name: 'Opposite Banks', clearBonus: 27, groups: [
      group('rimebeetle', 6, 0.85, 0, 1), group('grunt', 8, 0.7, 2),
    ] },
    { name: 'Honeycaps', clearBonus: 29, groups: [
      group('reedpiper', 3, 1.42), group('bellrunner', 9, 0.51, 2, 1), group('draftwing', 4, 0.94, 4),
    ] },
    { name: 'Cellar Steps', clearBonus: 30, groups: [
      group('kilnback', 5, 1.12, 0, 1), group('burrower', 6, 0.82, 2), group('healer', 2, 1.44, 4, 1),
    ] },
    { name: 'Sap Rising', clearBonus: 32, groups: [
      group('splitter', 6, 0.84), group('rimebeetle', 6, 0.82, 2, 1), group('mite', 12, 0.3, 4),
    ] },
    { name: 'Black Canopy', clearBonus: 34, groups: [
      { ...group('brute', 5, 1.03, 0, 1), elite: true }, group('warden', 5, 1.13, 2),
      group('hexer', 3, 1.3, 5, 1),
    ] },
    { name: 'Wicker Creels', clearBonus: 36, groups: [
      group('sledguard', 5, 1.42), group('blinker', 9, 0.68, 2, 1), group('carrier', 2, 2.24, 5),
    ] },
    { name: 'Puff of Spores', clearBonus: 38, groups: [
      group('rimebeetle', 7, 0.84, 0, 1), group('burrower', 8, 0.77, 2), group('healer', 3, 1.37, 4, 1),
    ] },
    { name: 'Shadow Harvest', clearBonus: 39, groups: [
      group('kilnback', 6, 1.05), group('draftwing', 5, 0.89, 1.8), group('reedpiper', 4, 1.35, 4, 1),
    ] },
    { name: 'Root Knot', clearBonus: 41, groups: [
      { ...group('splitter', 7, 0.8, 0, 1), elite: true }, group('sledguard', 5, 1.4, 2),
      group('bellrunner', 12, 0.5, 4, 1),
    ] },
    { name: 'Lantern Beds', clearBonus: 43, groups: [
      group('rimebeetle', 8, 0.81), group('hexer', 4, 1.28, 2, 1), group('brute', 7, 1.02, 5, 1),
    ] },
    { name: 'Twin Harvest', clearBonus: 45, groups: [
      { ...group('sledguard', 4, 1.35, 0, 1), elite: true, hpScale: 2.7 }, group('kilnback', 5, 1.03, 3),
      group('blinker', 8, 0.65, 5, 1),
    ] },
    { name: 'Falling Ash', clearBonus: 47, groups: [
      group('golem', 5, 1.15), group('rimebeetle', 8, 0.81, 2, 1), group('burrower', 8, 0.77, 5),
    ] },
    { name: 'The Last Ember', clearBonus: 60, groups: [
      { ...group('kilnback', 4, 1.02, 0, 1), elite: true, hpScale: 2.8 }, group('bellrunner', 13, 0.5, 2),
      group('sledguard', 6, 1.38, 4),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 13, 'tesla'), build(0, 14, 'barracks'), build(0, 8, 'archer'),
    build(1, 10, 'frost'), build(1, 9, 'ballista'), upgrade(2, 13),
    build(2, 15, 'mortar'), upgrade(3, 8), build(3, 3, 'cannon'),
    upgrade(4, 9), build(4, 7, 'tesla'), upgrade(5, 14),
    build(5, 1, 'ballista'), upgrade(6, 3), build(6, 16, 'archer'),
    upgrade(7, 10), upgrade(7, 13), upgrade(7, 15),
    upgrade(7, 7), upgrade(8, 1), upgrade(8, 9),
    upgrade(8, 8), upgrade(9, 16), upgrade(9, 3),
    upgrade(9, 14), upgrade(10, 10), upgrade(10, 15),
    upgrade(10, 7), upgrade(11, 1), upgrade(11, 16),
  ],
  weakBuildOrder: [
    build(0, 2, 'tesla'), build(0, 0, 'barracks'), build(0, 5, 'archer'),
    build(1, 10, 'frost'), build(1, 9, 'ballista'), upgrade(2, 2),
    upgrade(3, 5), upgrade(4, 9), build(4, 7, 'tesla'),
    upgrade(5, 0), build(5, 1, 'ballista'), upgrade(7, 10),
    upgrade(7, 2), upgrade(7, 7), upgrade(8, 1),
    upgrade(8, 9), upgrade(8, 5), upgrade(9, 0),
    upgrade(10, 10), upgrade(10, 7), upgrade(11, 1),
  ],
} satisfies ChapterIsland;
