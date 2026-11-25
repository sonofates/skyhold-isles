import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i44.json';

const layout2d = parseLevel2D(json);

export const I44 = {
  id: 'i44',
  index: 43,
  name: 'Lumen Archive',
  subtitle: 'The book lifts open at opposite ends of the stacks. Guard the west vault while the index finds the lost chart.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1829,
  startingGold: 425,
  enemyHpScale: 1.8,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Night Reading', clearBonus: 25, groups: [
      group('veilcaster', 2, 1.5), group('duskhound', 5, 0.44, 2, 1),
    ] },
    { name: 'The Book Lift', clearBonus: 27, groups: [
      group('warden', 4, 1.22, 0, 1), group('mite', 12, 0.31, 2),
    ] },
    { name: 'Loose Leaves', clearBonus: 29, groups: [
      group('draftwing', 4, 0.94), group('splitter', 5, 0.88, 2, 1),
    ] },
    { name: 'Copper Clasps', clearBonus: 31, groups: [
      group('kilnback', 5, 1.16), group('healer', 2, 1.4, 2), group('runner', 8, 0.49, 4, 1),
    ] },
    { name: 'The Narrow Aisle', clearBonus: 33, groups: [
      group('duskhound', 5, 0.4, 0, 1), group('burrower', 6, 0.84), group('duskhound', 5, 0.4, 5),
    ] },
    { name: 'Inkblot', clearBonus: 35, groups: [
      group('veilcaster', 3, 1.47, 0, 1), group('brute', 6, 1.12), group('blinker', 6, 0.7, 4),
    ] },
    { name: 'Lending Desk', clearBonus: 37, groups: [
      group('carrier', 2, 2.23), group('reedpiper', 3, 1.43, 2, 1), group('bellrunner', 8, 0.54, 4),
    ] },
    { name: 'The Gilt Edge', clearBonus: 39, groups: [
      group('sledguard', 5, 1.42), group('duskhound', 6, 0.41, 1, 1), group('hexer', 3, 1.3, 4),
    ] },
    { name: 'Wandering Folios', clearBonus: 41, groups: [
      group('splitter', 6, 0.85, 0, 1), group('draftwing', 5, 0.91, 3), group('veilcaster', 2, 1.41, 4),
    ] },
    { name: 'The Counterweight', clearBonus: 43, groups: [
      group('golem', 4, 1.3), group('warden', 5, 1.16, 2, 1), group('healer', 3, 1.4, 4),
    ] },
    { name: 'A Missing Leaf', clearBonus: 45, groups: [
      group('burrower', 8, 0.78), group('veilcaster', 4, 1.4, 2, 1), group('duskhound', 6, 0.39, 5, 1),
    ] },
    { name: 'Unbound', clearBonus: 47, groups: [
      { ...group('duskhound', 6, 0.42, 0, 1), elite: true, hpScale: 3.4 }, group('blinker', 7, 0.7, 3),
      group('reedpiper', 3, 1.4, 4),
    ] },
    { name: 'The Second Register', clearBonus: 49, groups: [
      group('sledguard', 5, 1.36), group('draftwing', 6, 0.91, 2), group('duskhound', 5, 0.41, 5, 1),
    ] },
    { name: 'Locked Stacks', clearBonus: 51, groups: [
      { ...group('golem', 2, 1.24, 0, 1), elite: true, hpScale: 7.04 }, group('veilcaster', 4, 1.35, 3),
      group('splitter', 6, 0.84, 5),
    ] },
    { name: 'Index of Shadows', clearBonus: 53, groups: [
      group('warden', 6, 1.13, 0, 1), group('kilnback', 6, 1.1), group('bellrunner', 10, 0.52, 4),
    ] },
    { name: 'The Lost Chart', clearBonus: 60, groups: [
      { ...group('sledguard', 4, 1.38, 0, 1), elite: true, hpScale: 6.12 }, group('duskhound', 5, 0.41, 3),
      group('veilcaster', 4, 1.35, 6),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 13, 'tesla'), build(0, 15, 'barracks'), build(0, 2, 'archer'),
    build(1, 11, 'frost'), build(1, 7, 'ballista'), upgrade(2, 13),
    build(2, 14, 'mortar'), upgrade(3, 2), build(3, 9, 'cannon'),
    upgrade(4, 7), build(4, 0, 'tesla'), upgrade(5, 15),
    build(5, 6, 'ballista'), upgrade(6, 9), build(6, 3, 'archer'),
    upgrade(7, 11), upgrade(7, 13), upgrade(7, 14),
    upgrade(7, 0), upgrade(8, 6), upgrade(8, 7),
    upgrade(8, 2), upgrade(9, 3), upgrade(9, 9),
    upgrade(9, 15), upgrade(10, 11), upgrade(10, 14),
    upgrade(10, 0), upgrade(11, 6), upgrade(11, 3),
  ],
  // Concentrating on the long upper aisle leaves the western vault approach exposed.
  weakBuildOrder: [
    build(0, 1, 'tesla'), build(0, 7, 'barracks'), build(0, 4, 'archer'),
    build(1, 5, 'frost'), build(1, 3, 'ballista'), upgrade(2, 1),
    upgrade(3, 4), upgrade(4, 3), build(4, 2, 'tesla'),
    upgrade(5, 7), build(5, 0, 'ballista'), upgrade(7, 5),
    upgrade(7, 1), upgrade(7, 2), upgrade(8, 0),
    upgrade(8, 3), upgrade(8, 4), upgrade(9, 7),
    upgrade(10, 5), upgrade(10, 2), upgrade(11, 0),
  ],
} satisfies ChapterIsland;
