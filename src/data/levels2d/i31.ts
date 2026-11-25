import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i31.json';

const layout2d = parseLevel2D(json);

export const I31 = {
  id: 'i31',
  index: 30,
  name: 'Crevasse Span',
  subtitle: 'Two rope bridges carry the freight across a moving glacier. Hold the western anchorage until the last sledge is over.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1540,
  startingGold: 440,
  enemyHpScale: 1.75,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Iron on the Planks', clearBonus: 25, groups: [
      group('sledguard', 2, 1.47), group('runner', 6, 0.52, 1.8, 1),
    ] },
    { name: 'Lower Hawser', clearBonus: 27, groups: [
      group('rimebeetle', 5, 0.91, 0, 1), group('bellrunner', 8, 0.53, 1),
    ] },
    { name: 'Frost on the Lashings', clearBonus: 29, groups: [
      group('kilnback', 5, 1.05), group('reedpiper', 2, 1.37, 1, 1),
      group('draftwing', 3, 0.92, 3.2),
    ] },
    { name: 'Keeper’s Knot', clearBonus: 31, groups: [
      group('sledguard', 4, 1.47, 0, 1), group('mite', 12, 0.29, 1),
      group('healer', 2, 1.35, 3.2, 1),
    ] },
    { name: 'Twin Spans', clearBonus: 32, groups: [
      group('burrower', 6, 0.82), group('rimebeetle', 6, 0.91, 1, 1),
      group('blinker', 7, 0.71, 3.2),
    ] },
    { name: 'Loose Piton', clearBonus: 34, groups: [
      { ...group('brute', 6, 1.01, 0, 1), elite: true }, group('reedpiper', 3, 1.37, 1),
      group('runner', 10, 0.52, 3.2, 1),
    ] },
    { name: 'Counterweight', clearBonus: 36, groups: [
      group('golem', 4, 1.16), group('sledguard', 4, 1.46, 1, 1),
      group('carrier', 2, 2.29, 3.2),
    ] },
    { name: 'Narrow Footing', clearBonus: 38, groups: [
      { ...group('rimebeetle', 7, 0.9, 0, 1), elite: true }, group('warden', 5, 1.12, 1),
      group('bellrunner', 11, 0.52, 3.2, 1),
    ] },
    { name: 'Drum and Ratchet', clearBonus: 39, groups: [
      { ...group('kilnback', 6, 1.02), elite: true }, group('healer', 3, 1.32, 1, 1),
      group('burrower', 7, 0.8, 3.2),
    ] },
    { name: 'The Bow in the Rope', clearBonus: 41, groups: [
      group('sledguard', 6, 1.42, 0, 1), group('hexer', 4, 1.27, 1),
      group('draftwing', 4, 0.89, 3.2, 1),
    ] },
    { name: 'Under Strain', clearBonus: 43, groups: [
      { ...group('splitter', 7, 0.75), elite: true }, group('rimebeetle', 8, 0.87, 1, 1),
      group('bellrunner', 10, 0.51, 3.2),
    ] },
    { name: 'High Anchor', clearBonus: 45, groups: [
      { ...group('sledguard', 5, 1.4, 0, 1), elite: true }, group('golem', 5, 1.11, 1),
      group('mite', 16, 0.28, 3.2, 1),
    ] },
    { name: 'Last Freight', clearBonus: 46, groups: [
      { ...group('brute', 8, 0.95), elite: true }, group('reedpiper', 4, 1.29, 1, 1),
      group('kilnback', 7, 0.99, 3.2),
    ] },
    { name: 'Mirror Signal', clearBonus: 60, groups: [
      { ...group('sledguard', 7, 1.38, 0, 1), elite: true, hpScale: 1.5 }, group('rimebeetle', 7, 0.85, 8),
      group('kilnback', 5, 0.98, 10.2, 1), group('bellrunner', 8, 0.5, 12.4),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 10, 'tesla'), build(0, 11, 'barracks'), build(0, 14, 'archer'),
    build(1, 8, 'frost'), build(1, 13, 'ballista'), upgrade(2, 10),
    build(2, 2, 'mortar'), upgrade(3, 14), build(3, 0, 'cannon'),
    upgrade(4, 13), build(4, 7, 'tesla'), upgrade(5, 11),
    build(5, 16, 'ballista'), upgrade(6, 0), build(6, 5, 'archer'),
    upgrade(7, 8), upgrade(7, 10), upgrade(7, 2),
    upgrade(7, 7), upgrade(8, 16), upgrade(8, 13),
    upgrade(8, 14), upgrade(9, 5), upgrade(9, 0),
    upgrade(9, 11), upgrade(10, 8), upgrade(10, 2),
    upgrade(10, 7), upgrade(11, 16), upgrade(11, 5),
  ],
  weakBuildOrder: [
    build(0, 2, 'cannon'), build(0, 4, 'barracks'), build(0, 14, 'archer'),
    build(1, 8, 'frost'), build(1, 1, 'ballista'), upgrade(2, 2),
    upgrade(3, 14), upgrade(4, 1), build(4, 0, 'archer'),
    upgrade(5, 4), build(5, 16, 'ballista'), upgrade(7, 8),
    upgrade(7, 2), upgrade(7, 0), upgrade(8, 16),
    upgrade(8, 1), upgrade(8, 14), upgrade(9, 4),
    upgrade(10, 8), upgrade(10, 0), upgrade(11, 16),
  ],
} satisfies ChapterIsland;
