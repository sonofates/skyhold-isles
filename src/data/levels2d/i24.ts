import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i24.json';

const layout2d = parseLevel2D(json);

// The Colossus takes the long fort road. The quay joins it first, then the boat road at the lower fork.
export const I24 = {
  id: 'i24',
  index: 23,
  name: 'Lastlight Head',
  subtitle: 'The beacon has gone dark. Hold the sea fort and both landings while the keeper lights the lens.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1291,
  startingGold: 410,
  enemyHpScale: 1.1,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'A Light Goes Out', clearBonus: 25, groups: [
      group('grunt', 12, 0.55),
      group('bellrunner', 5, 0.63, 1.4, 1),
    ] },
    { name: 'The Boat Slips', clearBonus: 27, groups: [
      group('kilnback', 4, 1.29),
      group('runner', 9, 0.51, 0.9, 2),
      group('mite', 12, 0.29, 3.2, 1),
    ] },
    { name: 'Foam on the Steps', clearBonus: 29, groups: [
      group('draftwing', 5, 0.53),
      group('brute', 5, 1.03, 0.8, 1),
      group('reedpiper', 2, 1.67, 1.5, 1),
    ] },
    { name: 'Two Landings', clearBonus: 31, groups: [
      group('splitter', 7, 0.75, 0, 1),
      group('healer', 2, 1.37, 0.5, 1),
      group('burrower', 5, 0.86, 1.8, 2),
      group('bellrunner', 8, 0.59, 3.8),
    ] },
    { name: 'Flood Tide', clearBonus: 32, groups: [
      group('warden', 4, 1.32),
      group('kilnback', 6, 1.05, 0.6),
      group('hexer', 3, 1.39, 1.1, 2),
      group('blinker', 6, 0.64, 3.4, 1),
    ] },
    { name: 'Sound the Bell', clearBonus: 34, groups: [
      { ...group('bellrunner', 8, 0.55, 0, 2), elite: true },
      group('reedpiper', 3, 1.5, 0.5, 2),
      group('carrier', 2, 2.34),
      group('golem', 4, 1.23, 2.7, 1),
    ] },
    { name: 'The Outer Wall', clearBonus: 36, groups: [
      { ...group('kilnback', 6, 1.13), elite: true },
      group('healer', 3, 1.3, 0.3),
      { ...group('splitter', 6, 0.77, 1.8, 1), elite: true },
      group('mite', 21, 0.24, 4.3, 2),
    ] },
    { name: 'Torn Sails', clearBonus: 38, groups: [
      { ...group('draftwing', 6, 0.51), elite: true },
      group('burrower', 9, 0.75, 0.6, 1),
      group('reedpiper', 3, 1.28, 1.1, 1),
      group('bellrunner', 12, 0.5, 4.8, 2),
    ] },
    { name: 'The Rising Gale', clearBonus: 40, groups: [
      { ...group('golem', 5, 1.15, 0, 2), elite: true },
      group('warden', 3, 1.3, 0.5, 2),
      group('blinker', 8, 0.61, 2.3, 1),
      group('carrier', 2, 2.13, 4.5),
    ] },
    { name: 'Brass Shutters', clearBonus: 41, groups: [
      { ...group('kilnback', 7, 1.06, 0, 1), elite: true },
      group('reedpiper', 4, 1.3, 0.5, 1),
      group('hexer', 4, 1.17, 1.5),
      { ...group('bellrunner', 9, 0.52, 4.9, 2), elite: true },
    ] },
    { name: 'The Quay Breaks', clearBonus: 43, groups: [
      { ...group('brute', 8, 0.99, 0, 1), elite: true },
      group('healer', 3, 1.23, 0.6, 1),
      { ...group('burrower', 5, 0.77, 2.1, 2), elite: true },
      group('draftwing', 7, 0.5, 4.6),
    ] },
    { name: 'The Wick Catches', clearBonus: 45, groups: [
      { ...group('golem', 6, 1.21), elite: true },
      group('warden', 4, 1.22, 0.5),
      { ...group('splitter', 8, 0.79, 1.3, 2), elite: true },
      group('bellrunner', 13, 0.43, 4.5, 1),
    ] },
    { name: 'One Turn of the Lens', clearBonus: 48, groups: [
      { ...group('kilnback', 8, 0.98, 0, 2), elite: true },
      group('reedpiper', 4, 1.22, 0.7, 2),
      { ...group('draftwing', 7, 0.48, 2.9), elite: true },
      { ...group('blinker', 8, 0.64, 5.6, 1), elite: true },
    ] },
    { name: 'First Light', clearBonus: 70, groups: [
      { ...group('tempest', 1, 1), elite: true },
      { ...group('kilnback', 8, 1.06, 8, 2), elite: true },
      group('reedpiper', 4, 1.25, 9.5, 2),
      { ...group('bellrunner', 13, 0.53, 12, 1), elite: true },
      group('draftwing', 6, 0.5, 17),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 12, 'tesla'), build(0, 9, 'barracks'), build(0, 14, 'archer'),
    build(1, 15, 'cannon'), build(1, 10, 'frost'), upgrade(2, 12),
    build(2, 11, 'archer'), build(3, 17, 'ballista', 'strongest'), upgrade(3, 15),
    build(4, 4, 'mortar'), upgrade(4, 14), build(5, 21, 'tesla'),
    upgrade(5, 17), upgrade(6, 12), build(6, 13, 'ballista', 'strongest'),
    upgrade(7, 10), upgrade(7, 9), upgrade(8, 15), upgrade(8, 21),
    upgrade(9, 13), upgrade(9, 17), upgrade(10, 11), upgrade(10, 4), upgrade(10, 14),
    upgrade(11, 21), upgrade(11, 10), upgrade(12, 13), upgrade(12, 4), upgrade(13, 9),
  ],
  weakBuildOrder: [
    build(0, 1, 'archer'), build(0, 6, 'cannon'), build(0, 17, 'archer'),
    build(1, 14, 'frost'), build(2, 13, 'cannon'), build(3, 21, 'archer'),
    build(4, 16, 'ballista'), upgrade(4, 1), upgrade(5, 6), upgrade(6, 17),
    upgrade(7, 14), upgrade(8, 13),
  ],
} satisfies ChapterIsland;
