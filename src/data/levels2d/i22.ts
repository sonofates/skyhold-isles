import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i22.json';

const layout2d = parseLevel2D(json);

// The mine convoy circles the pool. Porters from the lower landing have a short run to the freight road.
export const I22 = {
  id: 'i22',
  index: 21,
  name: 'Brineglass Ferry',
  subtitle: 'The ferry cable has snapped. Guard the two salt roads until the last load crosses the pool.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1171,
  startingGold: 380,
  enemyHpScale: 1.88,
  waveHpGrowth: 0.095,
  waves: [
    { name: 'A Parted Cable', clearBonus: 25, groups: [
      group('kilnback', 3, 1.28),
      group('grunt', 10, 0.57, 1.2, 1),
    ] },
    { name: 'Empty Salt Sacks', clearBonus: 26, groups: [
      group('bellrunner', 7, 0.55),
      group('splitter', 4, 0.89, 1.1, 1),
      group('mite', 12, 0.31, 3.4, 1),
    ] },
    { name: 'Lights in the Shaft', clearBonus: 28, groups: [
      group('burrower', 4, 0.86, 0, 1),
      group('draftwing', 5, 0.54),
      group('brute', 5, 1.01, 2.2),
    ] },
    { name: 'The Shallow Landing', clearBonus: 30, groups: [
      group('reedpiper', 2, 1.75, 0, 1),
      group('kilnback', 4, 1.07, 0.5, 1),
      group('bellrunner', 9, 0.48, 2.1),
    ] },
    { name: 'Freight Manifest', clearBonus: 32, groups: [
      group('warden', 3, 1.49),
      group('golem', 4, 1.32, 0.5),
      group('hexer', 3, 1.37, 1.2, 1),
      group('runner', 15, 0.36, 3.2, 1),
    ] },
    { name: 'Wings over Brine', clearBonus: 34, groups: [
      group('carrier', 2, 2.9),
      group('draftwing', 7, 0.53, 0.9),
      group('splitter', 8, 0.65, 2.5, 1),
    ] },
    { name: 'Down the Mine Road', clearBonus: 36, groups: [
      { ...group('kilnback', 6, 1.27), elite: true },
      group('healer', 3, 1.35, 0.5),
      group('reedpiper', 3, 1.64, 1.7),
      group('blinker', 6, 0.72, 3.7, 1),
    ] },
    { name: 'Haul on the Rope', clearBonus: 38, groups: [
      { ...group('bellrunner', 10, 0.54, 0, 1), elite: true },
      group('warden', 3, 1.43, 0.4, 1),
      group('mite', 21, 0.24),
      group('burrower', 8, 0.79, 2.5),
    ] },
    { name: 'White Gold', clearBonus: 40, groups: [
      { ...group('golem', 5, 1.24), elite: true },
      group('reedpiper', 3, 1.44, 0.9),
      group('brute', 8, 0.83, 1.7, 1),
      group('draftwing', 7, 0.48, 4.9),
    ] },
    { name: 'Counterweight', clearBonus: 41, groups: [
      { ...group('splitter', 8, 0.82, 0, 1), elite: true },
      group('hexer', 4, 1.09, 0.8, 1),
      group('carrier', 2, 2.15),
      group('bellrunner', 12, 0.48, 4.8),
    ] },
    { name: 'The Deep Landing', clearBonus: 43, groups: [
      { ...group('kilnback', 6, 1.17, 0, 1), elite: true },
      group('reedpiper', 3, 1.29, 0.6, 1),
      group('golem', 5, 1.11),
      group('burrower', 7, 0.71, 4.6),
    ] },
    { name: 'Lamplight on the Water', clearBonus: 45, groups: [
      { ...group('brute', 8, 1.08), elite: true },
      group('healer', 3, 1.2, 0.7),
      { ...group('bellrunner', 10, 0.49, 2.1, 1), elite: true },
      group('draftwing', 7, 0.51, 4.2),
    ] },
    { name: 'The Last Crossing', clearBonus: 62, groups: [
      group('boss', 1, 1),
      group('warden', 3, 1.53, 0.7),
      { ...group('kilnback', 9, 1.08, 0.3, 1), elite: true },
      group('reedpiper', 4, 1.28, 1.1, 1),
      group('blinker', 9, 0.59, 5.1),
      { ...group('golem', 3, 0.8, 6, 1), elite: true, hpScale: 1.8 },
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 9, 'tesla'), build(0, 10, 'barracks'), build(0, 18, 'archer'),
    build(1, 14, 'cannon'), build(1, 15, 'frost'), upgrade(2, 9),
    build(2, 0, 'archer'), build(3, 4, 'ballista', 'strongest'), upgrade(3, 14),
    build(4, 12, 'mortar'), upgrade(4, 18), build(5, 8, 'tesla'),
    upgrade(5, 4), upgrade(6, 9), build(6, 7, 'ballista'),
    upgrade(7, 15), upgrade(7, 10), upgrade(8, 14), upgrade(8, 8),
    upgrade(9, 7), upgrade(9, 4), upgrade(10, 0), upgrade(10, 12), upgrade(10, 18),
    upgrade(11, 8), upgrade(11, 15), upgrade(11, 7), upgrade(12, 12), upgrade(12, 10),
  ],
  weakBuildOrder: [
    build(0, 11, 'archer'), build(0, 13, 'cannon'), build(0, 2, 'archer'),
    build(1, 8, 'frost'), build(2, 9, 'cannon'), build(3, 15, 'archer'),
    build(4, 16, 'ballista'), upgrade(4, 11), upgrade(5, 13), upgrade(6, 2),
    upgrade(7, 8), upgrade(8, 9),
  ],
} satisfies ChapterIsland;
