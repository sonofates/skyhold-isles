import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i29.json';

const layout2d = parseLevel2D(json);

// The boathouses feed a hooked return road past the smoking sheds.
export const I29 = {
  id: 'i29',
  index: 28,
  name: 'Hearthsmoke Hamlet',
  subtitle: 'The last alder chips are still on the ice. Guard both landings while the fishers bring the fuel home.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1494,
  startingGold: 405,
  enemyHpScale: 2.904,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Cold Hearths', clearBonus: 25, groups: [
      group('bellrunner', 7, 0.55, 0, 1), group('grunt', 10, 0.59, 1.8),
    ] },
    // Rime Beetles first march here, a small file out of the east boathouse (lane 1).
    { name: 'First Basket', clearBonus: 27, groups: [
      group('mite', 14, 0.29), group('burrower', 5, 0.84, 0.75, 1),
      group('brute', 4, 1.08, 2.8), group('rimebeetle', 4, 0.9, 4.4, 1),
    ] },
    { name: 'Under the Nets', clearBonus: 29, groups: [
      group('reedpiper', 2, 1.42, 0, 1), group('kilnback', 5, 1.08, 0.75),
      group('runner', 8, 0.5, 2.8, 1),
    ] },
    { name: 'The Alder Sledge', clearBonus: 31, groups: [
      group('flyer', 5, 0.9), group('warden', 4, 1.21, 0.75, 1),
      group('splitter', 5, 0.79, 2.8),
    ] },
    { name: 'A Fork in the Ice', clearBonus: 32, groups: [
      group('blinker', 7, 0.69, 0, 1), group('healer', 2, 1.36, 0.75),
      group('brute', 6, 1.04, 2.8, 1),
    ] },
    { name: 'Fish Under Glass', clearBonus: 34, groups: [
      { ...group('kilnback', 5, 1.04), elite: true }, group('reedpiper', 3, 1.37, 2.8),
      group('rimebeetle', 6, 0.9, 4.4, 1),
    ] },
    { name: 'At the Hatch', clearBonus: 36, groups: [
      group('golem', 5, 1.16, 0, 1), group('hexer', 4, 1.3, 0.75),
      group('carrier', 2, 2.38, 2.8, 1),
    ] },
    { name: 'Cinders on Snow', clearBonus: 38, groups: [
      { ...group('splitter', 8, 0.76), elite: true }, group('runner', 13, 0.47, 0.75, 1),
      group('burrower', 8, 0.78, 2.8),
    ] },
    { name: 'The Racks Fill', clearBonus: 39, groups: [
      { ...group('warden', 6, 1.14, 0, 1), elite: true }, group('reedpiper', 4, 1.32, 2.8, 1),
      group('rimebeetle', 6, 0.9, 4.4),
    ] },
    { name: 'Borrowed Coals', clearBonus: 41, groups: [
      { ...group('bellrunner', 10, 0.5), elite: true }, group('golem', 6, 1.12, 0.75, 1),
      group('healer', 3, 1.28, 2.8), group('draftwing', 4, 0.89, 5, 1),
    ] },
    { name: 'Stoke the Fire', clearBonus: 43, groups: [
      { ...group('brute', 7, 0.97, 0, 1), elite: true }, group('blinker', 8, 0.64, 0.75),
      group('hexer', 4, 1.24, 2.8, 1),
    ] },
    { name: 'The Draught Changes', clearBonus: 46, groups: [
      { ...group('kilnback', 7, 0.97), elite: true }, group('reedpiper', 4, 1.27, 0.75, 1),
      { ...group('burrower', 7, 0.75, 2.8), elite: true }, group('mite', 16, 0.25, 5, 1),
      group('rimebeetle', 5, 0.9, 6.2),
    ] },
    { name: 'Smoke Above the Lake', clearBonus: 60, groups: [
      { ...group('golem', 8, 1.08, 0, 1), elite: true }, group('healer', 4, 1.23, 0.75),
      { ...group('splitter', 9, 0.71, 2.8, 1), elite: true }, group('bellrunner', 11, 0.48, 5),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 13, 'tesla'), build(0, 8, 'barracks'), build(0, 9, 'archer'),
    build(1, 15, 'frost'), build(1, 16, 'ballista'), upgrade(2, 13),
    build(2, 2, 'mortar'), upgrade(3, 9), build(3, 10, 'cannon'),
    upgrade(4, 16), build(4, 6, 'tesla'), upgrade(5, 8),
    build(5, 14, 'ballista'), upgrade(6, 10), build(6, 7, 'archer'),
    upgrade(7, 15), upgrade(7, 13), upgrade(7, 2),
    upgrade(7, 6), upgrade(8, 14), upgrade(8, 16),
    upgrade(8, 9), upgrade(9, 7), upgrade(9, 10),
    upgrade(9, 8), upgrade(10, 15), upgrade(10, 2),
    upgrade(10, 6), upgrade(11, 14), upgrade(11, 7),
  ],
  weakBuildOrder: [
    build(0, 13, 'tesla'), build(0, 8, 'barracks'), build(0, 9, 'archer'),
    build(1, 15, 'frost'), build(1, 16, 'ballista'), upgrade(2, 13),
    upgrade(3, 9), upgrade(4, 16), build(4, 6, 'tesla'),
    upgrade(5, 8), build(5, 14, 'ballista'), upgrade(7, 15),
    upgrade(7, 13), upgrade(7, 6), upgrade(8, 14),
    upgrade(8, 16), upgrade(8, 9), upgrade(9, 8),
    upgrade(10, 15), upgrade(10, 6), upgrade(11, 14),
  ],
} satisfies ChapterIsland;
